import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import {
	BACKGROUND_USAGE_NOTICE,
	type BackgroundTaskResult,
	BackgroundTasks,
} from "../src/background.ts";
import {
	type DelegationOptions,
	type DelegationResult,
	type DelegationStatus,
	registerDelegate,
} from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

function result(status: DelegationStatus = "completed"): DelegationResult {
	return {
		content: [{ type: "text", text: "child answer" }],
		details: { status, sessionId: "child-session" },
		isError: status === "failed" || status === "cancelled",
		usage: {
			input: 2,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 3,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}
const options: DelegationOptions = {
	cwd: process.cwd(),
	args: [],
	snapshot: { version: 1, tools: [], active: [] },
	task: "task",
};
const idle = { isIdle: () => true, hasPendingMessages: () => false };
const failure = (_error: unknown, cancelled: boolean) =>
	result(cancelled ? "cancelled" : "failed");
async function waitFor(predicate: () => boolean) {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > deadline)
			throw new Error("Timed out waiting for background state");
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

for (const status of [
	"completed",
	"incomplete",
	"failed",
	"cancelled",
] as const) {
	test(`background retains ${status}, bounded result metadata and separate usage`, async () => {
		const messages: BackgroundTaskResult[] = [];
		let calls = 0;
		const tasks = new BackgroundTasks(
			async () => {
				calls++;
				return {
					...result(status),
					details: {
						status,
						stopReason: status === "incomplete" ? "length" : "stop",
						fullOutputPath: "output.txt",
					},
				};
			},
			failure,
			(message) => messages.push(message),
		);
		const accepted = tasks.start(options, idle);
		expect(calls).toBe(1);
		expect(accepted.details.status).toBe("queued");
		await waitFor(() => messages.length === 1);
		const final = tasks.query(accepted.details.taskId);
		expect(final.details.status).toBe(status);
		expect(final.isError).toBe(status === "failed" || status === "cancelled");
		expect(final.details.result?.fullOutputPath).toBe("output.txt");
		expect(final.details.usage?.totalTokens).toBe(3);
		expect(final.content[0].text).toContain(BACKGROUND_USAGE_NOTICE);
		expect(final).not.toHaveProperty("usage");
		expect(messages[0]).toEqual(final);
		await tasks.cancel(accepted.details.taskId);
		expect(tasks.query(accepted.details.taskId).details.status).toBe(status);
		tasks.scheduleDelivery();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(messages).toHaveLength(1);
		await tasks.invalidate(true);
	});
}

test("busy or queued parent work postpones delivery without losing query results", async () => {
	let busy = true;
	let queued = false;
	const messages: BackgroundTaskResult[] = [];
	const tasks = new BackgroundTasks(
		async () => result(),
		failure,
		(message) => messages.push(message),
	);
	const { taskId } = tasks.start(options, {
		isIdle: () => !busy,
		hasPendingMessages: () => queued,
	}).details;
	await waitFor(() => tasks.query(taskId).details.status === "completed");
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(messages).toHaveLength(0);
	busy = false;
	queued = true;
	tasks.scheduleDelivery();
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(messages).toHaveLength(0);
	queued = false;
	// No host event follows clear_queue: pending delivery must notice eligibility itself.
	await waitFor(() => messages.length === 1);
	await tasks.invalidate(true);
});

test("parent abort is detached; explicit task cancellation awaits cleanup", async () => {
	const parent = new AbortController();
	let childSignal: AbortSignal | undefined;
	let cleaned = false;
	const tasks = new BackgroundTasks(
		async ({ signal, ui }) => {
			expect(ui).toBeUndefined();
			childSignal = signal;
			await new Promise<void>((resolve) =>
				signal?.addEventListener("abort", () => setTimeout(resolve, 10), {
					once: true,
				}),
			);
			cleaned = true;
			return result("cancelled");
		},
		failure,
		() => {},
	);
	const { taskId } = tasks.start(
		{ ...options, signal: parent.signal, ui: async () => undefined },
		idle,
	).details;
	await waitFor(() => childSignal !== undefined);
	parent.abort();
	expect(childSignal?.aborted).toBe(false);
	expect(tasks.query(taskId).details.status).toBe("queued");
	const final = await tasks.cancel(taskId);
	expect(cleaned).toBe(true);
	expect(final.details.status).toBe("cancelled");
	await tasks.invalidate(true);
});

for (const closing of [false, true]) {
	test(`invalidation before fast completion suppresses old delivery (closing=${closing})`, async () => {
		const messages: BackgroundTaskResult[] = [];
		const tasks = new BackgroundTasks(
			async ({ signal }) => result(signal?.aborted ? "cancelled" : "completed"),
			failure,
			(message) => messages.push(message),
		);
		const old = tasks.start(options, idle).details.taskId;
		await tasks.invalidate(closing);
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(messages).toHaveLength(0);
		expect(tasks.query(old).isError).toBe(true);
		if (closing) expect(() => tasks.start(options, idle)).toThrow("closing");
		else {
			const fresh = tasks.start(options, idle).details.taskId;
			await waitFor(() => messages.length === 1);
			expect(messages[0].details.taskId).toBe(fresh);
			await tasks.invalidate(true);
		}
	});
}

for (const closing of [false, true]) {
	for (const withCurrent of [false, true]) {
		for (const oldFirst of [false, true]) {
			test(`overlapping invalidation awaits detached cleanup (closing=${closing}, current=${withCurrent}, oldFirst=${oldFirst})`, async () => {
				const messages: BackgroundTaskResult[] = [];
				const runs = new Map<
					string,
					{ signal: AbortSignal; finish: () => void }
				>();
				let controls = 0;
				const tasks = new BackgroundTasks(
					async ({ task, signal, onSteeringControl }) => {
						if (!signal) throw new Error("Missing task signal");
						onSteeringControl?.({
							steer: async () => {
								controls++;
								return { status: "accepted", disposition: "queued" };
							},
						});
						await new Promise<void>((finish) =>
							runs.set(task, { signal, finish }),
						);
						return result(signal.aborted ? "cancelled" : "completed");
					},
					failure,
					(message) => messages.push(message),
				);
				const start = (task: string) =>
					tasks.start({ ...options, task }, idle).details.taskId;
				const tick = () =>
					new Promise<void>((resolve) => setImmediate(resolve));
				const old = start("old");
				await waitFor(() => runs.has("old"));
				let firstDone = false;
				const first = tasks.invalidate().then(() => {
					firstDone = true;
				});
				expect(runs.get("old")?.signal.aborted).toBe(true);
				expect(tasks.query(old).isError).toBe(true);
				expect((await tasks.steer(old, "stale")).details.status).toBe(
					"unknown_task",
				);
				let current: string | undefined;
				if (withCurrent) {
					current = start("current");
					await waitFor(() => runs.has("current"));
				}
				let secondDone = false;
				const second = tasks.invalidate(closing).then(() => {
					secondDone = true;
				});
				if (current) {
					expect(runs.get("current")?.signal.aborted).toBe(true);
					expect(tasks.query(current).isError).toBe(true);
				}
				expect((await tasks.steer(old, "stale")).details.status).toBe(
					closing ? "closing" : "unknown_task",
				);
				expect(controls).toBe(0);
				let fresh: string | undefined;
				if (closing) expect(() => start("fresh")).toThrow("closing");
				else {
					fresh = start("fresh");
					await waitFor(() => runs.has("fresh"));
				}
				await tick();
				expect(firstDone).toBe(false);
				expect(secondDone).toBe(false);
				runs.get(oldFirst ? "old" : "current")?.finish();
				await tick();
				expect(firstDone).toBe(oldFirst);
				if (!oldFirst || withCurrent) expect(secondDone).toBe(false);
				runs.get(oldFirst ? "current" : "old")?.finish();
				await Promise.all([first, second]);
				expect(messages).toHaveLength(0);
				if (fresh) {
					expect(runs.get("fresh")?.signal.aborted).toBe(false);
					expect(tasks.query(fresh).details.status).toBe("queued");
					runs.get("fresh")?.finish();
					await waitFor(() => messages.length === 1);
					expect(messages[0].details.taskId).toBe(fresh);
				}
				await tasks.invalidate(true);
			});
		}
	}
}
test("invalidating already completed queued results prevents cross-scope delivery", async () => {
	const messages: BackgroundTaskResult[] = [];
	let busy = true;
	const tasks = new BackgroundTasks(
		async () => result(),
		failure,
		(message) => messages.push(message),
	);
	const { taskId } = tasks.start(options, {
		...idle,
		isIdle: () => !busy,
	}).details;
	await waitFor(() => tasks.query(taskId).details.status === "completed");
	await tasks.invalidate();
	busy = false;
	tasks.scheduleDelivery();
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(messages).toHaveLength(0);
	expect(tasks.query(taskId).isError).toBe(true);
	await tasks.invalidate(true);
});

test("unexpected runner and delivery failures are observable without unhandled work", async () => {
	const tasks = new BackgroundTasks(
		async () => {
			throw new Error("startup failure");
		},
		failure,
		() => {
			throw new Error("runtime invalid");
		},
	);
	const { taskId } = tasks.start(options, idle).details;
	await waitFor(() => tasks.query(taskId).details.deliveryError !== undefined);
	expect(tasks.query(taskId).details.status).toBe("failed");
	expect(tasks.query(taskId).details.deliveryError).toBe("runtime invalid");
	expect(tasks.query("unknown").isError).toBe(true);
	expect((await tasks.cancel("unknown")).isError).toBe(true);
	await tasks.invalidate(true);
	expect(() =>
		tasks.start({ ...options, signal: AbortSignal.abort() }, idle),
	).toThrow();
});

function registration(run: typeof import("../src/delegate.ts").runDelegation) {
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, (event: unknown) => unknown>();
	const messages: unknown[] = [];
	registerDelegate(
		{
			registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
				tools.set(tool.name, tool),
			on: (name: string, handler: (event: unknown) => unknown) => {
				hooks.set(name, handler);
				return () => {};
			},
			getAllTools: () => [],
			getActiveTools: () => [],
			getCommands: () => [],
			sendMessage: (message: unknown, policy: unknown) =>
				messages.push({ message, policy }),
		} as unknown as ExtensionAPI,
		run,
	);
	const ctx = {
		...configurationContext,
		...idle,
		cwd: process.cwd(),
		mode: "tui",
		isProjectTrusted: () => false,
	} as ExtensionToolContext;
	return { tools, hooks, messages, ctx };
}

test("registered TUI tools acknowledge, query and trigger model-visible completion", async () => {
	const { tools, hooks, messages, ctx } = registration(async () => result());
	const start = await tools
		.get("delegate")
		?.execute(
			"call",
			{ task: "task", background: true },
			undefined,
			undefined,
			ctx,
		);
	if (!start) throw new Error("Missing delegation acknowledgement");
	const taskId = (start.details as BackgroundTaskResult["details"]).taskId;
	expect((start.details as BackgroundTaskResult["details"]).status).toBe(
		"initializing",
	);
	await waitFor(() => messages.length === 1);
	expect(messages[0]).toMatchObject({
		message: {
			customType: "pi-delegate:completed",
			details: { taskId, status: "completed" },
		},
		policy: { triggerTurn: true, deliverAs: "followUp" },
	});
	const queried = await tools
		.get("delegate_status")
		?.execute("query", { taskId }, undefined, undefined, ctx);
	expect(queried?.details).toMatchObject({
		status: "completed",
		usage: { totalTokens: 3 },
	});
	expect(queried).not.toHaveProperty("usage");
	await hooks.get("session_before_tree")?.({
		preparation: { targetId: "new", oldLeafId: "old" },
	});
	const stale = await tools
		.get("delegate_status")
		?.execute("query", { taskId }, undefined, undefined, ctx);
	expect(stale?.isError).toBe(true);
	await hooks.get("session_shutdown")?.({ reason: "reload" });
});

test("shutdown hooks await cleanup already detached by navigation", async () => {
	let finish: (() => void) | undefined;
	const { tools, hooks, messages, ctx } = registration(async () => {
		await new Promise<void>((resolve) => {
			finish = resolve;
		});
		return result("cancelled");
	});
	await tools
		.get("delegate")
		?.execute(
			"call",
			{ task: "task", background: true },
			undefined,
			undefined,
			ctx,
		);
	await waitFor(() => finish !== undefined);
	const navigation = hooks.get("session_before_tree")?.({
		preparation: { targetId: "new", oldLeafId: "old" },
	});
	let shutdownsDone = 0;
	const shutdown = () =>
		Promise.resolve(hooks.get("session_shutdown")?.({ reason: "reload" })).then(
			() => {
				shutdownsDone++;
			},
		);
	const first = shutdown();
	const second = shutdown();
	await new Promise<void>((resolve) => setImmediate(resolve));
	expect(shutdownsDone).toBe(0);
	finish?.();
	await Promise.all([navigation, first, second]);
	expect(shutdownsDone).toBe(2);
	expect(messages).toHaveLength(0);
});
for (const mode of ["print", "json"] as const) {
	test(`one-shot ${mode} mode rejects background but retains synchronous operation`, async () => {
		let runs = 0;
		const { tools, ctx, hooks } = registration(async () => {
			runs++;
			return result();
		});
		const tool = tools.get("delegate");
		const oneShot = { ...ctx, mode };
		const rejected = await tool?.execute(
			"bg",
			{ task: "task", background: true },
			undefined,
			undefined,
			oneShot,
		);
		expect(rejected?.isError).toBe(true);
		expect(rejected?.content[0]).toMatchObject({
			text: expect.stringContaining("long-lived"),
		});
		expect(runs).toBe(0);
		const sync = await tool?.execute(
			"sync",
			{ task: "task" },
			undefined,
			undefined,
			oneShot,
		);
		expect(sync?.details).toMatchObject({ status: "completed" });
		expect(sync?.usage?.totalTokens).toBe(3);
		await hooks.get("session_shutdown")?.({ reason: "quit" });
	});
}
