import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	eventually,
	type Host,
	type HostRecord,
	names,
	required,
	withHost,
} from "./fixtures/host.ts";

function text(result: HostRecord): string {
	return result.content
		.filter((b: HostRecord) => b.type === "text")
		.map((b: HostRecord) => b.text)
		.join("\n");
}
function assertChildIsolation(host: Host) {
	const children = host.children();
	expect(children).toHaveLength(2);
	expect(new Set(children.map((c) => c.pid)).size).toBe(2);
	for (const child of children) {
		expect(child.mode).toBe("rpc");
		for (const name of names) {
			expect(child.all).not.toContain(name);
			expect(child.active).not.toContain(name);
		}
		expect(child.commands).not.toContain("goal");
		const models = host.trace(child.pid).filter((e) => e.type === "model");
		expect(models).toHaveLength(4);
		for (const m of models)
			for (const name of names) expect(m.tools).not.toContain(name);
		const results = required(models.at(-1), "last child model call").results;
		const search = results.find((r: HostRecord) => r.name === "tool_search");
		expect(search).toBeDefined();
		expect(search.error).toBe(false);
		// Tool names in the query do not count as availability; no matching declarations may load.
		expect(search.content.map((b: HostRecord) => b.text).join("\n")).toMatch(
			/No (matching )?tools/i,
		);
		const code = results.find((r: HostRecord) => r.name === "codemode");
		expect(code.error).toBe(false);
		const output = code.content.map((b: HostRecord) => b.text).join("\n");
		expect(output).toContain('"registered":[]');
		expect(output).not.toContain('"reachable":true');
		for (const name of names)
			expect(output).toContain(`"name":"${name}","reachable":false`);
		expect(
			host.trace(child.pid).filter((e) => e.type === "provider-error"),
		).toEqual([]);
	}
	const taskTraces = children.map((c) =>
		required(
			host.trace(c.pid).find((e) => e.type === "child-task"),
			"child task",
		),
	);
	expect(taskTraces.filter((e) => e.reviewer)).toHaveLength(1);
	expect(
		required(
			taskTraces.find((e) => e.reviewer),
			"reviewer task",
		).task,
	).toContain("artifact.txt contains goal artifact verified");
	expect(
		required(
			taskTraces.find((e) => e.reviewer),
			"reviewer task",
		).task,
	).toContain("Worker completed artifact.txt");
}

for (const built of [false, true])
	for (const goalFirst of [false, true]) {
		test(`${built ? "BUILT" : "SOURCE"} entries; ${goalFirst ? "goal" : "delegate"} first: real worker/reviewer share public runtime and mandatory review`, async () => {
			await withHost({ built, goalFirst }, async (host) => {
				await host.start(3); // initial coordinator + worker + independent reviewer
				const state = host.state();
				expect(state.status).toBe("complete");
				expect(state.run).toMatchObject({ allowance: 3, used: 3 });
				expect(state.attempts.map((a) => a.kind)).toEqual([
					"coordinator",
					"worker",
					"reviewer",
				]);
				expect(state.review).toMatchObject({
					approved: true,
					workRevision: state.workRevision,
				});
				const workerCheckpoint = required(
					host.journal().find((e) => e.reason === "worker-result"),
					"worker checkpoint",
				).state;
				expect(workerCheckpoint.status).toBe("active");
				expect(workerCheckpoint.items[0].status).toBe("pending");
				expect(workerCheckpoint.review).toBeUndefined();
				expect(readFileSync(join(host.cwd, "artifact.txt"), "utf8")).toBe(
					"goal artifact verified\n",
				);
				expect(host.journal()[0]).toMatchObject({
					type: "goal",
					version: 1,
					id: state.id,
					cwd: host.cwd,
				});
				expect(existsSync(join(host.temp, "sessions-override", "goals"))).toBe(
					false,
				);
				assertChildIsolation(host);
				const viaAPI = await host.call("host_api");
				const viaTool = await host.call("delegate_list");
				expect(viaAPI.details.details).toEqual(viaTool.details);
				expect(viaTool.details.total).toBe(2);
				const tasks = viaTool.details.tasks;
				expect(new Set(tasks.map((t: HostRecord) => t.taskId))).toEqual(
					new Set(state.attempts.filter((a) => a.taskId).map((a) => a.taskId)),
				);
				for (const task of tasks) {
					expect(task.status).toBe("completed");
					const status = await host.call("delegate_status", {
						taskId: task.taskId,
					});
					expect(status.details.usage.totalTokens).toBe(12); // four actual child responses, not two execution owners
					expect(status.usage).toBeUndefined(); // observations never charge usage again
					expect(
						state.attempts.find((a) => a.taskId === task.taskId)?.usage,
					).toEqual(status.details.usage);
					expect(text(status)).toContain(task.taskId);
				}
				expect((await host.call("delegate_list")).details).toEqual(
					viaTool.details,
				); // observation changes no accounting
				const ordinary = await host.call("delegate", {
					task: "ORDINARY synchronous tool",
				});
				expect(ordinary.details.status).toBe("completed");
				const apiExecution = await host.call("host_api", { execute: true });
				expect(apiExecution.details.status).toBe("completed");
				expect((await host.call("delegate_list")).details.total).toBe(4);
				await host.cleaned();
			});
		}, 120000);
	}

for (const built of [false, true]) {
	test(`${built ? "BUILT" : "SOURCE"} native agent_before_settle provides exactly one metered actionable continuation`, async () => {
		await withHost(
			{ built, scenario: "boundary", goalFirst: true },
			async (host) => {
				await host.start(4); // coordinator, worker, actionable-boundary coordinator, reviewer
				expect(
					host.state().stopReason,
					JSON.stringify(host.trace().filter((e) => e.type === "boundary")),
				).toBeUndefined();
				expect(host.state().status).toBe("complete");
				expect(host.state().run?.used).toBe(4);
				expect(host.state().attempts.map((a) => a.kind)).toEqual([
					"coordinator",
					"worker",
					"coordinator",
					"reviewer",
				]);
				const boundaries = host.trace().filter((e) => e.type === "boundary");
				expect(
					boundaries.filter((e) =>
						e.entries.some(
							(v: HostRecord) =>
								v.type === "custom_message" &&
								v.customType === "pi-goal:continue",
						),
					),
				).toHaveLength(1);
				expect(host.trace().filter((e) => e.type === "settled")).toHaveLength(
					1,
				);
			},
		);
	}, 120000);
}

test("SOURCE worker consumes last dispatch; no reviewer child, late wake or reload autorun", async () => {
	await withHost({ goalFirst: true }, async (host) => {
		await host.start(2);
		const saved = host.state();
		expect(saved.status).toBe("paused");
		expect(saved.stopReason).toMatch(/allowance exhausted/i);
		expect(saved.attempts.map((a) => a.kind)).toEqual([
			"coordinator",
			"worker",
		]);
		expect(saved.run?.used).toBe(2);
		expect(host.children()).toHaveLength(1);
		const calls = host.trace().filter((e) => e.type === "model").length;
		await Bun.sleep(150);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(calls);
		await host.prompt("/host-reload", false);
		await eventually(
			() => host.trace().filter((e) => e.type === "start").length,
			(n) => n === 2,
			"native reload completes",
		);
		expect(host.state()).toEqual(saved);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(calls);
		const status = await host.call("goal_status", { id: saved.id });
		expect(status.details.runtimeActive).toBe(false);
		expect(status.details.state.run.used).toBe(2);
		expect(host.children()).toHaveLength(1);
	});
}, 120000);

test("SOURCE independent rejection remains unfinished and exhausts the same allowance", async () => {
	await withHost({ reject: true }, async (host) => {
		await host.start(3);
		expect(host.state().status).toBe("paused");
		expect(host.state().review?.approved).toBe(false);
		expect(host.state().review?.summary).toContain("<disapproved/>");
		expect(host.state().run?.used).toBe(3);
		expect(host.children()).toHaveLength(2);
	});
}, 120000);

for (const built of [false, true]) {
	test(`${built ? "BUILT" : "SOURCE"} default global root uses isolated HOME; continuation exhausts without extra model call`, async () => {
		await withHost(
			{ built, defaultRoot: true, scenario: "idle", goalFirst: true },
			async (host) => {
				await host.start(2);
				expect(host.state().status).toBe("paused");
				expect(host.state().run).toMatchObject({ allowance: 2, used: 2 });
				expect(host.trace().filter((e) => e.type === "model")).toHaveLength(2);
				expect(host.children()).toHaveLength(0);
				expect(
					host
						.journalPath()
						.startsWith(join(host.temp, "home", ".pi", "agent", "goals")),
				).toBe(true);
			},
		);
	}, 60000);
}

test("SOURCE torn global journal inspection/resume fails closed with no new execution", async () => {
	await withHost({ scenario: "idle" }, async (host) => {
		await host.start(1);
		const saved = host.state();
		const before = readFileSync(host.journalPath(), "utf8");
		await appendFile(host.journalPath(), '{"type":"checkpoint"');
		const status = await host.call("goal_status", { id: saved.id });
		expect(status.isError).toBe(true);
		expect(text(status)).toMatch(
			/recover|journal|tail|incomplete|unterminated/i,
		);
		const calls = host.trace().filter((e) => e.type === "model").length;
		await host.prompt(`/goal resume ${saved.id} 2`, false);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(calls);
		expect(readFileSync(host.journalPath(), "utf8")).toBe(
			`${before}{"type":"checkpoint"`,
		);
		expect(host.children()).toHaveLength(0);
	});
}, 60000);

test("SOURCE missing integration, invalid initial JSON allowance and global storage failures never launch work", async () => {
	await withHost({ noDelegate: true, scenario: "idle" }, async (host) => {
		await host.prompt(
			'/goal {"objective":"fixture","criteria":["condition"],"allowance":2}',
			false,
		);
		expect(
			host.events.some(
				(e) =>
					e.type === "extension_ui_request" &&
					String(e.message).includes("Missing pi-delegate runtime"),
			),
		).toBe(true);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(0);
		expect(existsSync(join(host.agentDir, "goals"))).toBe(false);
	});
	await withHost({ scenario: "idle" }, async (host) => {
		await host.prompt(
			'/goal {"objective":"fixture","criteria":["condition"]}',
			false,
		);
		expect(
			host.events.some(
				(e) =>
					e.type === "extension_ui_request" &&
					String(e.message).includes("explicit positive safe integer"),
			),
		).toBe(true);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(0);
		expect(existsSync(join(host.agentDir, "goals"))).toBe(false);
		await writeFile(join(host.agentDir, "goals"), "blocked global namespace");
		await host.prompt(
			'/goal {"objective":"fixture","criteria":["condition"],"allowance":1}',
			false,
		);
		expect(
			host.events.some(
				(e) =>
					e.type === "extension_ui_request" &&
					/EEXIST|ENOTDIR|not a directory/i.test(String(e.message)),
			),
		).toBe(true);
		expect(host.trace().filter((e) => e.type === "model")).toHaveLength(0);
		expect(readFileSync(join(host.agentDir, "goals"), "utf8")).toBe(
			"blocked global namespace",
		);
	});
}, 60000);
