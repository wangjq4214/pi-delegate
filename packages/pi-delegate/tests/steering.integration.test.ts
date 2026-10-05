import { expect, test } from "bun:test";
import {
	eventually,
	tool,
	withSteeringHost,
} from "./fixtures/steering-host.ts";

const turnPressure = {
	warning: { afterSeconds: 60, afterTurns: 1 },
	urgent: { afterSeconds: 120, afterTurns: 10 },
};

for (const mode of ["all", "one-at-a-time"] as const) {
	test(`real Pi 1.0.0 steering: queued/handled/transformed slash text, provider/tool boundary and ${mode} mode`, async () => {
		await withSteeringHost(
			async (host) => {
				const id = await host.start({
					id: "slash",
					finishAt: 5,
					holdToolsAt: [0],
					batch: true,
				});
				const child = await host.child("slash");
				await host.model(child, 0);
				const initial = host.trace(child).find((e) => e.type === "model");
				expect(initial?.tools?.map((t) => t.name)).not.toContain(
					"delegate_steer",
				);
				const handled = await host.steer(id, "HANDLED");
				expect(handled.details).toMatchObject({
					status: "accepted",
					disposition: "handled",
				});
				for (const message of [
					"/steering-sentinel",
					"/skill:steering-skill",
					"/sentinel-template",
					"TRANSFORM narrower scope",
				]) {
					const receipt = await host.steer(id, message);
					expect(receipt.details).toMatchObject({
						taskId: id,
						status: "accepted",
						disposition: "queued",
					});
					expect(receipt.content[0].text).toContain(
						"not a provider/model-consumption",
					);
				}
				expect(
					host.trace(child).filter((e) => e.type === "model"),
				).toHaveLength(1); // ACK while provider held.
				await host.advance(child, 0);
				await host.event(child, "tool-start", (e) => e.call === 0);
				expect(
					host.trace(child).filter((e) => e.type === "model"),
				).toHaveLength(1); // Associated tools are not skipped.
				await host.release(child, "tool-0");
				const next = await host.model(child, 1);
				const boundary = host.trace(child);
				expect(boundary.find((e) => e.type === "turn-end")?.toolResults).toBe(
					3,
				);
				expect(boundary.findIndex((e) => e.type === "turn-end")).toBeLessThan(
					boundary.findIndex((e) => e.type === "model" && e.call === 1),
				);
				const firstUsers =
					next?.users?.filter((t) =>
						t.startsWith("[pi-delegate instruction]"),
					) ?? [];
				expect(firstUsers).toHaveLength(mode === "all" ? 4 : 1);
				expect(firstUsers[0]).toBe(
					"[pi-delegate instruction]\n/steering-sentinel\nrequest-context-processed",
				);
				await host.finish(child, 1, 5);
				await host.cleaned(child);
				const lastUsers =
					host
						.trace(child)
						.filter((e) => e.type === "model")
						.at(-1)
						?.users?.join("\n") ?? "";
				expect(lastUsers).toContain("/skill:steering-skill");
				expect(lastUsers).toContain("/sentinel-template");
				expect(lastUsers).toContain(
					"handler-transformed\nrequest-context-processed",
				);
				expect(lastUsers).not.toContain("HANDLED");
				expect(lastUsers).not.toContain("SKILL_EXPANDED_SENTINEL");
				expect(lastUsers).not.toContain("TEMPLATE_EXPANDED_SENTINEL");
				expect(
					host.trace(child).some((e) => e.type === "command-executed"),
				).toBe(false);
				expect((await host.query(id)).status).toBe("completed");
				expect((await host.steer(id, "after completion")).details.status).toBe(
					"terminal",
				);
			},
			{},
			mode,
		);
	}, 30_000);
}

for (const [env, gate] of [
	["PRESSURE_HOLD_INIT", "init"],
	["STEERING_HOLD_START", "original-start"],
] as const) {
	test(`real steering not_ready during ${gate}: no readiness wait or delayed instruction`, async () => {
		await withSteeringHost(
			async (host) => {
				const id = await host.start();
				const child = await host.child();
				await host.event(child, "gate-ready", (e) => e.text === gate);
				expect(
					(await host.steer(id, "rejected early context")).details.status,
				).toBe("not_ready");
				await host.release(child, gate);
				await host.model(child, 0);
				expect(
					(await host.steer(id, "explicit ready context")).details.status,
				).toBe("accepted");
				await host.finish(child);
				await host.cleaned(child);
				expect(JSON.stringify(host.trace(child))).not.toContain(
					"rejected early context",
				);
			},
			{ [env]: "1" },
		);
	}, 30_000);
}

for (const env of ["STEERING_FAIL_INIT", "STEERING_FAIL_START"]) {
	test(`real ${env} cannot enable steering and follows task failure/cleanup`, async () => {
		await withSteeringHost(
			async (host) => {
				const id = await host.start();
				const child = await host.child();
				await host.cleaned(child);
				expect((await host.query(id)).status).toBe("failed");
				expect((await host.steer(id, "cannot reopen")).details.status).toBe(
					"terminal",
				);
				expect(host.trace(child).some((e) => e.type === "input-enter")).toBe(
					false,
				);
			},
			{ [env]: "1" },
		);
	}, 30_000);
}

for (const first of ["manual", "pressure"] as const) {
	test(`real async preprocessing: ${first} first shares RPC outcome boundary with pressure/manual`, async () => {
		await withSteeringHost(
			async (host) => {
				const id = await host.start(
					{ id: "ordering", finishAt: 2 },
					turnPressure,
				);
				const child = await host.child("ordering");
				await host.model(child, 0);
				let manual: Promise<void>;
				if (first === "manual") {
					manual = host.beginSteers([
						{ taskId: id, message: "HOLD first" },
						{ taskId: id, message: "second manual" },
					]);
					await host.event(child, "input-enter");
					await host.advance(child, 0);
				} else {
					await host.advance(child, 0);
					await host.event(child, "input-enter");
					manual = host.beginSteers([{ taskId: id, message: "second manual" }]);
				}
				await host.model(child, 1); // turn threshold is due, but first input RPC is held.
				await eventually(
					() => host.parent.request<{ isStreaming: boolean }>("get_state"),
					(s) => s.isStreaming,
					"parent executing steer",
				);
				expect(
					host.trace(child).filter((e) => e.type === "input-enter"),
				).toHaveLength(1);
				await host.release(
					child,
					first === "manual" ? "manual-input" : "pressure-input",
				);
				await manual;
				await host.event(child, "input-enter", (e) =>
					first === "manual"
						? e.text?.startsWith("[pi-delegate pressure:") === true
						: e.text?.includes("second manual") === true,
				);
				const events = host
					.trace(child)
					.filter(
						(e) => e.type === "input-enter" || e.type === "input-outcome",
					);
				expect(events.slice(0, 4).map((e) => e.type)).toEqual([
					"input-enter",
					"input-outcome",
					"input-enter",
					"input-outcome",
				]);
				await host.finish(child, 1);
				await host.cleaned(child);
				expect(
					host.trace(child).filter((e) => e.type === "pressure-receipt"),
				).toHaveLength(1);
			},
			first === "pressure" ? { STEERING_HOLD_PRESSURE: "1" } : {},
		);
	}, 30_000);
}

test("real low-level agent_end continuation retains control; settlement race closes without restarting", async () => {
	await withSteeringHost(
		async (host) => {
			const id = await host.start({ id: "continuation", finishAt: 0 });
			const child = await host.child("continuation");
			await host.advance(child, 0);
			await host.event(child, "gate-ready", (e) => e.text === "before-settle");
			expect(
				(await host.steer(id, "continue report context")).details.status,
			).toBe("accepted");
			await host.release(child, "before-settle");
			await host.model(child, 1);
			const pending = host.beginSteers([
				{ taskId: id, message: "HOLD late input" },
				{ taskId: id, message: "unsent after settlement" },
			]);
			await host.event(
				child,
				"input-enter",
				(e) => e.text?.includes("late input") === true,
			);
			await host.advance(child, 1);
			await host.cleaned(child);
			await pending; // Closure may fail a still-processing host request; this is allowed.
			expect(
				host
					.trace(child)
					.some(
						(e) =>
							e.type === "input-enter" &&
							e.text?.includes("unsent after settlement"),
					),
			).toBe(false);
			expect(host.trace(child).filter((e) => e.type === "model")).toHaveLength(
				2,
			);
			expect((await host.query(id)).status).toBe("completed");
			expect((await host.steer(id, "after settled")).details.status).toBe(
				"terminal",
			);
		},
		{ STEERING_HOLD_SETTLE: "1" },
	);
}, 30_000);

test("real rejected manual RPC does not fail a healthy task or suppress result/usage", async () => {
	await withSteeringHost(async (host) => {
		const id = await host.start();
		const child = await host.child("child");
		await host.model(child, 0);
		expect((await host.steer(id, "REJECT")).details.status).toBe("failed");
		expect((await host.query(id)).status).toBe("running");
		expect((await host.steer(id, "healthy later context")).details.status).toBe(
			"accepted",
		);
		await host.finish(child);
		await host.cleaned(child);
		expect(await host.query(id)).toMatchObject({
			status: "completed",
			usage: { totalTokens: 9 },
		});
	});
}, 30_000);

test("real 40-second manual RPC timeout is uncertain, never retried; explicit later input and ordinary result still work", async () => {
	await withSteeringHost(async (host) => {
		const id = await host.start();
		const child = await host.child("child");
		await host.model(child, 0);
		const receipt = await host.steer(id, "HOLD timed-out input");
		expect(receipt.details.status).toBe("uncertain");
		expect(receipt.content[0].text).toContain("Do not automatically retry");
		expect(
			host.trace(child).filter((e) => e.type === "input-enter"),
		).toHaveLength(1);
		expect(
			(await host.steer(id, "explicit later submission")).details.status,
		).toBe("accepted");
		await host.release(child, "manual-input");
		await host.event(
			child,
			"input-outcome",
			(e) => e.text?.includes("timed-out") === true,
		);
		await host.finish(child);
		await host.cleaned(child);
		expect(await host.query(id)).toMatchObject({
			status: "completed",
			usage: { totalTokens: 9 },
		});
		expect(
			host.trace(child).filter((e) => e.type === "input-enter"),
		).toHaveLength(2);
	});
}, 65_000);
for (const handling of ["HANDLE", "TRANSFORM"] as const) {
	test(`real automatic pressure retains trusted ${handling} processing and both once-only stages`, async () => {
		await withSteeringHost(
			async (host) => {
				const id = await host.start(
					{ id: "pressure-handling", finishAt: 3 },
					{
						warning: { afterSeconds: 60, afterTurns: 1 },
						urgent: { afterSeconds: 120, afterTurns: 2 },
					},
				);
				const child = await host.child("pressure-handling");
				await host.advance(child, 0);
				await host.event(
					child,
					"input-outcome",
					(e) => e.text?.includes("pressure: warning") === true,
				);
				await host.advance(child, 1);
				await host.event(
					child,
					"input-outcome",
					(e) => e.text?.includes("pressure: urgent") === true,
				);
				await host.finish(child, 2, 3);
				await host.cleaned(child);
				const events = host.trace(child);
				expect(
					events.filter((e) => e.type === "pressure-receipt"),
				).toHaveLength(2);
				const users =
					events
						.filter((e) => e.type === "model")
						.at(-1)
						?.users?.join("\n") ?? "";
				if (handling === "HANDLE")
					expect(users).not.toContain("[pi-delegate pressure:");
				else {
					expect(users).toContain("pressure: warning");
					expect(users).toContain("pressure: urgent");
					expect(users).toContain(
						"handler-transformed\nrequest-context-processed",
					);
				}
				expect((await host.query(id)).status).toBe("completed");
			},
			{ [`STEERING_${handling}_PRESSURE`]: "1" },
		);
	}, 30_000);
}

test("real concurrent tasks: steering and pressure stay task-local and survive ordinary parent abort", async () => {
	await withSteeringHost(async (host) => {
		const id = await host.start({ id: "first", finishAt: 2 }, turnPressure);
		const first = await host.child("first");
		await host.parent.request("prompt", {
			message: `RUN ${JSON.stringify({ calls: [{ task: { id: "second", finishAt: 2 }, background: true }], holdAfterAck: true })}`,
		});
		await host.event(
			{ pid: host.parent.child.pid ?? 0, snapshot: "", child: false },
			"gate-ready",
			(e) => e.text === "parent-after-ack",
		);
		const secondId = (
			tool(await host.messages(), "delegate").details as unknown as {
				taskId: string;
			}
		).taskId;
		const second = await host.child("second");
		await host.parent.request("abort");
		expect((await host.steer(id, "only first task")).details.status).toBe(
			"accepted",
		);
		await host.advance(first, 0);
		await host.event(first, "pressure-receipt");
		expect(
			host
				.trace(second)
				.some((e) => e.type === "input-enter" || e.type === "pressure-receipt"),
		).toBe(false);
		await host.finish(first, 1);
		await host.finish(second);
		await host.cleaned(first);
		await host.cleaned(second);
		expect((await host.query(id)).status).toBe("completed");
		expect((await host.query(secondId)).status).toBe("completed");
	});
}, 30_000);

for (const background of [true, false]) {
	test(`real ${background ? "background" : "synchronous"} child cannot declare, discover or invoke delegate_steer via nested/codemode`, async () => {
		await withSteeringHost(async (host) => {
			const started = host.prompt(
				`RUN ${JSON.stringify({ calls: [{ task: { id: "reachability", finishAt: 3, reachability: true }, background }] })}`,
			);
			void started.catch(() => {});
			const child = await host.child("reachability");
			await host.advance(child, 0);
			await host.advance(child, 1);
			const probe = await host.model(child, 2);
			expect(
				probe?.probeResults?.find((r) => r.name === "tool_search")?.isError,
			).toBe(false);
			expect(
				JSON.stringify(
					probe?.probeResults?.find((r) => r.name === "tool_search"),
				),
			).toContain("No matching tools found");
			expect(
				probe?.probeResults?.find((r) => r.name === "codemode")?.isError,
			).toBe(true);
			await host.advance(child, 2);
			const observed = await host.event(child, "reachability");
			const evidence = JSON.parse(observed?.text ?? "{}");
			expect(evidence.all).not.toContain("delegate_steer");
			expect(evidence.callable).not.toContain("delegate_steer");
			expect(evidence.nested.isError).toBe(true);
			expect(
				host
					.trace(child)
					.find((e) => e.type === "model")
					?.tools?.map((t) => t.name),
			).not.toContain("delegate_steer");
			await host.advance(child, 3);
			await started;
			await host.cleaned(child);
		});
	}, 30_000);
}
