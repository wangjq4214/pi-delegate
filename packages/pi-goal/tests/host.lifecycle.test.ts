import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	eventually,
	type Host,
	type HostRecord,
	required,
	withHost,
} from "./fixtures/host.ts";

async function launchGoal(host: Host, allowance = 5) {
	await host.start(allowance, false);
}
async function held(host: Host, reviewer = false) {
	return required(
		await eventually(
			() =>
				host
					.children()
					.find(
						(c) =>
							host.trace(c.pid).some((e) => e.type === "held") &&
							host
								.trace(c.pid)
								.some(
									(e) =>
										e.type === "child-task" &&
										e.reviewer === reviewer &&
										!e.task.includes("ORDINARY"),
								),
					),
			(v) => Boolean(v),
			`${reviewer ? "reviewer" : "worker"} running in actual held child`,
		),
	);
}
async function waitIdle(host: Host) {
	await eventually(
		() => host.parent.request<{ isStreaming: boolean }>("get_state"),
		(s) => !s.isStreaming,
		"parent settled",
	);
}

for (const scenario of ["hold", "review-hold"] as const) {
	test(`SOURCE pause cancels actual ${scenario === "hold" ? "worker" : "reviewer"} only, awaits cleanup and preserves ordinary background work`, async () => {
		await withHost({ scenario, goalFirst: true }, async (host) => {
			const ordinary = await host.call("delegate", {
				task: "ORDINARY HOLD unrelated background",
				background: true,
			});
			const ordinaryId = ordinary.details.taskId;
			const unrelated = await eventually(
				() =>
					host
						.children()
						.find((c) => host.trace(c.pid).some((e) => e.type === "held")),
				(v) => Boolean(v),
				"ordinary background running",
			);
			await launchGoal(host);
			const owned = await held(host, scenario === "review-hold");
			if (!unrelated) throw new Error("Missing ordinary child");
			expect(owned.pid).not.toBe(unrelated.pid);
			await host.prompt("/goal pause", false);
			await waitIdle(host);
			expect(existsSync(dirname(owned.snapshot))).toBe(false); // command returned only after delegate cleanup
			expect(() => process.kill(owned.pid, 0)).toThrow();
			expect(() => process.kill(unrelated.pid, 0)).not.toThrow();
			expect(host.state().status).toBe("paused");
			expect(host.state().attempts.at(-1)?.status).toBe("cancelled");
			expect(host.state().review?.approved ?? false).toBe(false);
			const attempts = host.state().attempts.length;
			const status = await host.call("delegate_status", { taskId: ordinaryId });
			expect(status.details.status).toBe("running");
			const before = host
				.trace()
				.filter((e) => e.type === "model" && !e.draft).length;
			await writeFile(join(host.logs, `${unrelated.pid}.release`), "release");
			await eventually(
				() => host.trace(unrelated.pid).some((e) => e.type === "shutdown"),
				Boolean,
				"ordinary background cleanup",
			);
			await Bun.sleep(100);
			expect(
				host.trace().filter((e) => e.type === "model" && !e.draft),
			).toHaveLength(before); // no unsolicited ordinary-result wake
			expect(host.state().attempts).toHaveLength(attempts);
			const wait = await host.call("delegate_wait", {
				taskIds: [ordinaryId],
				condition: "all",
				timeoutSeconds: 1,
			});
			expect(JSON.stringify(wait.details)).not.toContain("ordinary result");
			expect(wait.usage).toBeUndefined();
			const final = await host.call("delegate_status", { taskId: ordinaryId });
			expect(final.details.status).toBe("completed");
			expect(JSON.stringify(final.content)).toContain("ordinary result");
			if (scenario === "review-hold")
				expect(readFileSync(join(host.cwd, "artifact.txt"), "utf8")).toBe(
					"goal artifact verified\n",
				);
		});
	}, 120000);
}

test("SOURCE pinned host refuses busy tree navigation; abort then native navigation cannot revive goal", async () => {
	await withHost({ scenario: "hold", goalFirst: true }, async (host) => {
		await host.prompt("anchor before goal");
		const entries = await host.parent.request<{ entries: HostRecord[] }>(
			"get_entries",
		);
		const anchor = required(
			entries.entries.find(
				(e) => e.type === "message" && e.message.role === "assistant",
			),
			"branch anchor",
		).id;
		await launchGoal(host);
		const child = await held(host);
		await host.prompt(`/host-tree ${anchor}`, false);
		expect(
			required(
				host.trace().find((e) => e.type === "navigation-rejected"),
				"busy navigation rejection",
			).error,
		).toContain("Wait for the current response to finish");
		expect(host.state().status).toBe("active");
		// Pi 1.1.0 cannot emit session_before_tree during a foreground goal tool.
		// Abort is the real host's prerequisite; do not fake a tree lifecycle event.
		await host.parent.request("abort");
		await host.prompt(`/host-tree ${anchor}`, false);
		expect(host.trace().some((e) => e.type === "navigated")).toBe(true);
		expect(host.state().status).toBe("paused");
		expect(host.state().attempts.at(-1)?.status).toBe("cancelled");
		expect(existsSync(dirname(child.snapshot))).toBe(false);
		const count = host.children().length;
		await Bun.sleep(100);
		expect(host.children()).toHaveLength(count);
		const status = await host.call("goal_status");
		expect(status.details.runtimeActive).toBe(false);
	});
}, 120000);

test("SOURCE orderly host shutdown cancels actual work; fresh host only inspects persisted state", async () => {
	await withHost({ scenario: "hold", goalFirst: true }, async (host) => {
		await launchGoal(host);
		const child = await held(host);
		await host.stop();
		await host.cleaned();
		expect(existsSync(dirname(child.snapshot))).toBe(false);
		const saved = host.state();
		expect(saved.status).toBe("paused");
		expect(saved.attempts.at(-1)?.status).toBe("cancelled");
		const count = host.children().length;
		await host.launch();
		await Bun.sleep(100);
		expect(
			host.trace().filter((e) => e.type === "model" && !e.draft),
		).toHaveLength(0);
		expect(host.children()).toHaveLength(count);
		const result = await host.call("goal_status", { id: saved.id });
		expect(result.details.runtimeActive).toBe(false);
		expect(result.details.state).toEqual(saved);
	});
}, 120000);

for (const built of [false, true]) {
	test(`${built ? "BUILT" : "SOURCE"} pause revokes an already-returned native boundary continuation before a later handler releases`, async () => {
		await withHost(
			{ built, scenario: "boundary-pause", goalFirst: true },
			async (host) => {
				await launchGoal(host, 5);
				const proposal = required(
					await eventually(
						() => host.trace().find((e) => e.type === "boundary-held"),
						Boolean,
						"later native handler holds goal continuation",
					),
				);
				expect(proposal.continue).toBe(true);
				expect(
					proposal.entries.some(
						(e: HostRecord) => e.customType === "pi-goal:continue",
					),
				).toBe(true);
				await host.cleaned();
				const calls = host
					.trace()
					.filter((e) => e.type === "model" && !e.draft).length;
				const attempts = host.state().attempts.length;
				expect(host.state().run?.used).toBe(3); // initial coordinator, worker, proposed coordinator
				expect(host.children()).toHaveLength(1);
				await host.prompt("/goal pause", false);
				expect(host.state().status).toBe("paused");
				await writeFile(join(host.logs, "boundary.release"), "release");
				await waitIdle(host);
				await eventually(
					() => host.trace().filter((e) => e.type === "settled" && !e.draft),
					(e) => e.length === 1,
					"single final settlement",
				);
				await Bun.sleep(150);
				expect(
					host.trace().filter((e) => e.type === "model" && !e.draft),
				).toHaveLength(calls);
				expect(
					host.trace().filter((e) => e.type === "settled" && !e.draft)[0]
						?.aborted,
				).toBe(true);
				expect(host.state().attempts).toHaveLength(attempts);
				expect(host.state().run?.used).toBe(3);
				expect(host.state().status).toBe("paused");
				expect(host.children()).toHaveLength(1); // no reviewer or replacement worker
				expect(readFileSync(join(host.cwd, "artifact.txt"), "utf8")).toBe(
					"goal artifact verified\n",
				);
				await host.cleaned();
			},
		);
	}, 120000);
}
