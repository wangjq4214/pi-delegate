import { expect, spyOn, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
	type BackgroundTaskResult,
	BackgroundTasks,
} from "../src/background.ts";
import {
	type DelegationOptions,
	type DelegationResult,
	registerDelegate,
} from "../src/delegate.ts";
import { safeText } from "../src/progress.ts";
import { AgentStatus } from "../src/status.ts";
import { TaskSteering } from "../src/steering.ts";
import { type TaskDetails, type TaskPage, TaskRecords } from "../src/tasks.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

import { taskInput, taskResult } from "./fixtures/task-record.ts";

test("headless records distinguish selected/confirmed inputs and share current progress", () => {
	let seconds = 0;
	const records = new TaskRecords({
		now: () => seconds,
		schedule: () => () => {},
	});
	const record = records.accept(taskInput);
	seconds = 20;
	expect(record.summary()).toMatchObject({
		label: 1,
		mode: "background",
		elapsedSeconds: 0,
		turns: 0,
		status: "queued",
		controls: { cancel: true, steer: false },
	});
	expect(record.details().cwd).not.toHaveProperty("effective");
	expect(record.details().configuration).not.toHaveProperty("effective");
	record.progress.phase("initializing");
	record.spawned(taskInput.cwd);
	record.progress.configured({
		...taskInput.configuration,
		thinkingLevel: "off",
	});
	record.progress.observe({ type: "agent_start" });
	seconds = 23;
	for (const id of ["a", "a/1", "b"])
		record.progress.observe({
			type: "tool_execution_start",
			toolCallId: id,
			toolName: id,
			args: "SECRET",
		});
	expect(record.details().currentTools).toEqual(["a", "a/1", "b"]);
	expect(record.summary().activity).toContain("(+2)");
	const status = new AgentStatus({
		now: () => seconds,
		schedule: () => () => {},
	});
	status.bind({ mode: "tui", ui: { setWidget() {} } as never });
	status.show(record.progress);
	expect(status.render(120).join("\n")).toContain("toolcall · b (+2)");
	status.close();
	expect(record.summary().turns).toBe(0);
	record.progress.observe({ type: "turn_end" });
	record.progress.accepted("warning");
	record.progress.accepted("urgent");
	record.progress.accepted("warning");
	record.progress.observe({ type: "agent_settled" });
	seconds = 40;
	record.complete(taskResult("failed"));
	expect(record.details()).toMatchObject({
		status: "failed",
		elapsedSeconds: 3,
		turns: 1,
		currentTools: [],
		pressure: { accepted: "urgent" },
		cwd: { effective: taskInput.cwd },
		configuration: {
			requested: { thinkingLevel: "high" },
			effective: { thinkingLevel: "off" },
		},
	});
	const copy = record.details();
	copy.configuration.requested.thinkingLevel = "low";
	expect(record.details().configuration.requested.thinkingLevel).toBe("high");
	expect(JSON.stringify(records.list())).not.toContain("PRIVATE");
});

test("details retain the full supplied title while summaries stay bounded and fallback uses only the first task line", () => {
	const records = new TaskRecords();
	const title = `First line\n${"宽".repeat(140)} END`;
	const record = records.accept({ ...taskInput, title });
	expect(record.details().title).toBe(safeText(title));
	expect(record.summary().title).not.toContain("END");
	expect(
		records
			.accept({ ...taskInput, title: " ", task: "Fallback\nPRIVATE" })
			.details().title,
	).toBe("Fallback");
});
test("actual steering state, cancellation and terminal closure are distinct from running", () => {
	const records = new TaskRecords();
	const record = records.accept(taskInput);
	const steering = new TaskSteering(async () => ({ disposition: "queued" }));
	record.controlled(steering.control);
	record.progress.observe({ type: "agent_start" });
	steering.observe({ type: "agent_start" });
	expect(record.summary().status).toBe("running");
	expect(record.summary().controls.steer).toBe(false);
	steering.confirmStart();
	expect(record.summary().controls.steer).toBe(true);
	steering.observe({ type: "agent_settled" });
	expect(record.summary().controls.steer).toBe(false);
	expect(record.summary().controls.reason).toContain("closed");
	record.cancelRequested();
	expect(record.summary()).toMatchObject({
		cancelling: true,
		controls: { cancel: false, steer: false },
	});
	record.complete(taskResult("cancelled"));
	expect(record.summary()).toMatchObject({
		cancelling: false,
		status: "cancelled",
	});
});

test("paging reaches all records, orders active first, preserves results and immutable summaries", () => {
	const records = new TaskRecords();
	for (let i = 0; i < 107; i++) {
		const task = records.accept({ ...taskInput, title: `Task ${i}` });
		if (i % 2) task.complete(taskResult());
	}
	let offset = 0;
	const ids: string[] = [];
	while (true) {
		const page = records.list({ offset, limit: 7 });
		ids.push(...page.tasks.map((task) => task.taskId));
		if (page.nextOffset === undefined) break;
		offset = page.nextOffset;
	}
	expect(new Set(ids).size).toBe(107);
	expect(records.summaries().map((task) => task.taskId)).toEqual(ids);
	expect(records.list().tasks).toHaveLength(20);
	expect(records.list({ group: "active", limit: 100 }).total).toBe(54);
	expect(records.list({ group: "finished", limit: 100 }).total).toBe(53);
	expect(records.list({ group: "finished" }).tasks[0].label).toBe(106);
	expect(records.list({ offset: 999 }).tasks).toEqual([]);
	for (const limit of [0, 101, 1.5, Infinity])
		expect(() => records.list({ limit })).toThrow();
	expect(() => records.list({ offset: -1 })).toThrow();
	const page = records.list();
	page.tasks[0].title = "changed";
	expect(records.list().tasks[0].title).not.toBe("changed");
});

test("visual expiry is not record expiry; invalidation blocks late progress/result/delivery", () => {
	let seconds = 0;
	const clock = { now: () => seconds, schedule: () => () => {} };
	const records = new TaskRecords(clock);
	const status = new AgentStatus(clock);
	status.bind({ mode: "tui", ui: { setWidget() {} } as never });
	records.subscribe(status.update);
	const record = records.accept(taskInput);
	status.show(record.progress);
	record.complete(taskResult());
	seconds = 5;
	status.update();
	expect(status.render(120)).toEqual([]);
	expect(records.get(record.taskId)?.result?.content[0].text).toBe(
		"available result",
	);
	record.delivered("completion delivery failed");
	expect(record.details()).toMatchObject({
		status: "completed",
		delivery: { status: "failed" },
	});
	const old = records.accept(taskInput);
	records.invalidate();
	status.clear();
	old.progress.observe({ type: "agent_start" });
	old.complete(taskResult());
	old.delivered();
	expect(records.list().total).toBe(0);
	expect(records.accept(taskInput).progress.id).toBe(3);
	records.invalidate(true);
	expect(records.accept(taskInput).progress.id).toBe(1);
	status.close();
});

function registration(
	run: (options: DelegationOptions) => Promise<DelegationResult>,
	deliveryThrows = false,
) {
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
	const messages: unknown[] = [];
	registerDelegate(
		{
			registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
				tools.set(tool.name, tool),
			registerCommand() {},
			on: (name: string, handler: (event: unknown) => unknown) => {
				hooks.set(name, handler);
				return () => {};
			},
			getAllTools: () => [],
			getActiveTools: () => [],
			getCommands: () => [],
			sendMessage(message: unknown) {
				if (deliveryThrows) throw new Error("delivery failed");
				messages.push(message);
			},
		} as unknown as ExtensionAPI,
		run,
	);
	const ctx = {
		...configurationContext,
		cwd: process.cwd(),
		mode: "rpc",
		isIdle: () => true,
		hasPendingMessages: () => false,
		isProjectTrusted: () => false,
	} as ExtensionToolContext;
	const invoke = async (
		name: string,
		args: object = {},
		signal?: AbortSignal,
	) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`Missing ${name}`);
		return tool.execute("test", args as never, signal, undefined, ctx);
	};
	return { invoke, hooks, messages };
}
async function until(predicate: () => boolean | Promise<boolean>) {
	const end = Date.now() + 3000;
	while (!(await predicate())) {
		if (Date.now() > end) throw new Error("Task fixture timeout");
		await Bun.sleep(2);
	}
}

test("public tools discover pending synchronous tasks but reject independent controls without abort", async () => {
	let release!: () => void;
	let childSignal: AbortSignal | undefined;
	const host = registration(async (options) => {
		childSignal = options.signal;
		options.status?.observe({ type: "agent_start" });
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return taskResult();
	});
	try {
		const call = host.invoke("delegate", {
			task: "pending",
			title: "Sync title",
		});
		await until(() => !!release);
		const list = await host.invoke("delegate_list");
		const item = (list.details as TaskPage).tasks[0];
		expect(item).toMatchObject({
			mode: "synchronous",
			label: 1,
			title: "Sync title",
			status: "running",
			controls: { cancel: false, steer: false },
		});
		const query = await host.invoke("delegate_status", { taskId: item.taskId });
		expect(query.details).toMatchObject({
			task: { mode: "synchronous", delivery: { status: "not_applicable" } },
		});
		expect(
			query.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join("\n"),
		).toContain("Task metadata:");
		expect(
			(await host.invoke("delegate_cancel", { taskId: item.taskId })).isError,
		).toBe(true);
		expect(
			(
				await host.invoke("delegate_steer", {
					taskId: item.taskId,
					message: "no",
				})
			).isError,
		).toBe(true);
		expect(childSignal?.aborted).toBe(false);
		release();
		const result = await call;
		expect(result.details).toMatchObject({
			taskId: item.taskId,
			status: "completed",
		});
		expect(result).toHaveProperty("usage");
		const final = await host.invoke("delegate_status", { taskId: item.taskId });
		expect(final).not.toHaveProperty("usage");
		expect(final.details).toMatchObject({
			result: { taskId: item.taskId, status: "completed" },
			task: { resultAvailable: true },
		});
		expect(host.messages).toHaveLength(0);
	} finally {
		release?.();
		await host.hooks.get("session_shutdown")?.({});
	}
});

test("background delivery failure remains completed/discoverable and does not duplicate query usage", async () => {
	const host = registration(async (options) => {
		options.onCwd?.(options.cwd);
		return taskResult();
	}, true);
	try {
		const start = await host.invoke("delegate", {
			task: "background",
			background: true,
		});
		const id = (start.details as { taskId: string }).taskId;
		await until(
			async () =>
				(
					(await host.invoke("delegate_status", { taskId: id })).details as {
						deliveryError?: string;
					}
				).deliveryError === "delivery failed",
		);
		for (let i = 0; i < 3; i++) {
			const query = await host.invoke("delegate_status", { taskId: id });
			expect(query).not.toHaveProperty("usage");
			expect(query.details).toMatchObject({
				status: "completed",
				deliveryError: "delivery failed",
				task: {
					cwd: { effective: process.cwd() },
					delivery: { status: "failed" },
				},
			});
		}
		expect(
			(await host.invoke("delegate_list", { group: "finished" })).details,
		).toMatchObject({ total: 1 });
		await host.hooks.get("session_before_tree")?.({
			preparation: { oldLeafId: "old", targetId: "new" },
		});
		expect((await host.invoke("delegate_status", { taskId: id })).isError).toBe(
			true,
		);
		expect((await host.invoke("delegate_list")).details).toMatchObject({
			total: 0,
		});
	} finally {
		await host.hooks.get("session_shutdown")?.({});
	}
});

test("pre-acceptance errors do not create records and list parameter errors are explicit", async () => {
	const host = registration(async () => taskResult());
	try {
		expect((await host.invoke("delegate", { task: " " })).isError).toBe(true);
		expect((await host.invoke("delegate_list")).details).toMatchObject({
			total: 0,
		});
		expect((await host.invoke("delegate_list", { limit: 101 })).isError).toBe(
			true,
		);
		expect(
			(await host.invoke("delegate_status", { taskId: "foreign" })).isError,
		).toBe(true);
	} finally {
		await host.hooks.get("session_shutdown")?.({});
	}
});

test("view listener failures cannot fail execution or stop other observers", () => {
	const error = spyOn(console, "error").mockImplementation(() => {});
	try {
		const records = new TaskRecords();
		let calls = 0;
		records.subscribe(() => {
			throw new Error("broken view");
		});
		records.subscribe(() => {
			calls++;
		});
		const record = records.accept(taskInput);
		record.progress.observe({ type: "agent_start" });
		record.complete(taskResult());
		expect(record.details().status).toBe("completed");
		expect(calls).toBeGreaterThan(1);
		expect(error).toHaveBeenCalled();
	} finally {
		error.mockRestore();
	}
});

test("compact view setup failure cannot stop accepted execution or consume admission", async () => {
	const error = spyOn(console, "error").mockImplementation(() => {});
	const previous = process.env.PI_DELEGATE_CONCURRENCY;
	process.env.PI_DELEGATE_CONCURRENCY = "1";
	let runs = 0;
	const host = registration(async () => {
		runs++;
		return taskResult();
	});
	try {
		await host.hooks.get("session_start")?.(
			{},
			{
				mode: "tui",
				ui: {
					setWidget(_name: string, factory: unknown) {
						if (factory) throw new Error("view setup failed");
					},
				},
			},
		);
		const start = await host.invoke("delegate", {
			task: "accepted setup",
			background: true,
		});
		expect(start.isError).toBe(false);
		const id = (start.details as { taskId: string }).taskId;
		await until(
			async () =>
				(
					(await host.invoke("delegate_list", { group: "finished" }))
						.details as TaskPage
				).total === 1,
		);
		expect(
			(await host.invoke("delegate_status", { taskId: id })).details,
		).toMatchObject({ status: "completed", task: { resultAvailable: true } });
		expect(
			(await host.invoke("delegate_cancel", { taskId: id })).details,
		).toMatchObject({ status: "completed", task: { resultAvailable: true } });
		expect(
			(await host.invoke("delegate_list", { group: "active" })).details,
		).toMatchObject({ total: 0 });
		const next = await host.invoke("delegate", { task: "next" });
		expect(next.isError).toBe(false);
		expect(runs).toBe(2);
		expect(error).toHaveBeenCalled();
	} finally {
		await host.hooks.get("session_shutdown")?.({});
		error.mockRestore();
		if (previous === undefined) delete process.env.PI_DELEGATE_CONCURRENCY;
		else process.env.PI_DELEGATE_CONCURRENCY = previous;
	}
});

test("an empty delivery error is failed delivery, not a successful submission", () => {
	const records = new TaskRecords();
	const record = records.accept(taskInput);
	record.complete(taskResult());
	record.delivered("");
	expect(record.details()).toMatchObject({
		status: "completed",
		resultAvailable: true,
		delivery: { status: "failed", error: "" },
	});
});

test("terminal publication is atomic and background queries share it before the owner promise settles", async () => {
	const records = new TaskRecords();
	const record = records.accept(taskInput);
	const snapshots: TaskDetails[] = [];
	records.subscribe(() => {
		if (record.result) snapshots.push(record.details());
	});
	const result = taskResult();
	result.usage.input = 4;
	result.usage.totalTokens = 4;
	result.details.configuration = {
		requested: taskInput.configuration,
		effective: { ...taskInput.configuration, thinkingLevel: "off" },
	};
	let early: BackgroundTaskResult | undefined;
	const tasks = new BackgroundTasks(
		async () => {
			const identified = record.complete(result);
			early = tasks.query(record.taskId);
			return identified;
		},
		(_error, cancelled) => taskResult(cancelled ? "cancelled" : "failed"),
		() => {},
	);
	try {
		tasks.start(
			{
				cwd: taskInput.cwd,
				args: [],
				snapshot: { version: 1, tools: [], active: [] },
				task: taskInput.task,
				taskRecord: record,
				status: record.progress,
			},
			{ isIdle: () => false, hasPendingMessages: () => false },
		);
		expect(early?.details).toMatchObject({
			status: "completed",
			result: { status: "completed" },
			usage: { totalTokens: 4 },
			task: { status: "completed", resultAvailable: true },
		});
		expect(early?.content[0].text).toContain("available result");
		expect(snapshots.length).toBeGreaterThan(0);
		for (const snapshot of snapshots)
			expect(snapshot).toMatchObject({
				status: "completed",
				controls: { cancel: false, steer: false },
				usage: { totalTokens: 4 },
				configuration: { effective: { thinkingLevel: "off" } },
				delivery: { status: "pending" },
			});
		if (early?.details.result) early.details.result.status = "failed";
		expect(tasks.query(record.taskId).details.status).toBe("completed");
	} finally {
		await tasks.invalidate(true);
		records.invalidate();
	}
});

test("safe result text strips OSC/CSI and keeps malformed repeated escapes as inert text", () => {
	expect(
		safeText("\x1b]8;;https://example.invalid\x1b\\caption\x1b]8;;\x1b\\"),
	).toBe("caption");
	expect(safeText("\x1b[2Jone\ntwo", true)).toBe("one\ntwo");
	expect(safeText("\x1b]x".repeat(16000))).toBe("x".repeat(16000));
});
