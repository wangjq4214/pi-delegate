import { expect, spyOn, test } from "bun:test";
import type { Clock } from "../src/clock.ts";
import { validateWaitArguments, waitForTasks } from "../src/task-wait.ts";
import { TaskRecords } from "../src/tasks.ts";
import { taskInput, taskResult } from "./fixtures/task-record.ts";

function harness() {
	let now = 0;
	let next = 0;
	let cancellations = 0;
	const timers = new Map<number, { at: number; callback: () => void }>();
	const callbacks: (() => void)[] = [];
	const clock: Clock = {
		now: () => now,
		schedule(callback, ms) {
			const id = ++next;
			timers.set(id, { at: now + ms / 1000, callback });
			callbacks.push(callback);
			return () => {
				cancellations++;
				timers.delete(id);
			};
		},
	};
	const records = new TaskRecords(clock);
	const listeners = new Set<() => void>();
	const subscribe = records.subscribe.bind(records);
	let afterSubscribe: (() => void) | undefined;
	spyOn(records, "subscribe").mockImplementation((listener) => {
		listeners.add(listener);
		const off = subscribe(listener);
		afterSubscribe?.();
		return () => {
			listeners.delete(listener);
			off();
		};
	});
	return {
		records,
		clock,
		timers,
		callbacks,
		listeners,
		onSubscribe(action: () => void) {
			afterSubscribe = action;
		},
		cancellations: () => cancellations,
		advance(seconds: number) {
			now += seconds;
			for (const [id, timer] of [...timers])
				if (timer.at <= now) {
					timers.delete(id);
					timer.callback();
				}
		},
		wait(args: unknown, signal?: AbortSignal) {
			return waitForTasks(records, args, signal, clock);
		},
		clean() {
			expect(timers.size).toBe(0);
			expect(listeners.size).toBe(0);
		},
	};
}

test("defaults, duplicate IDs and caller mutations are captured per wait", async () => {
	const h = harness();
	const first = h.records.accept(taskInput),
		second = h.records.accept(taskInput);
	const ids = [first.taskId, first.taskId];
	expect(validateWaitArguments({ taskIds: ids })).toEqual({
		taskIds: [first.taskId],
		condition: "any",
		timeoutSeconds: 30,
	});
	const waiting = h.wait({ taskIds: ids });
	ids.push(second.taskId);
	h.advance(29.999);
	expect(h.listeners.size).toBe(1);
	h.advance(0.001);
	expect(await waiting).toEqual({
		reason: "timeout",
		tasks: [{ taskId: first.taskId, status: "queued" }],
	});
	expect(h.cancellations()).toBe(1);
	h.clean();
});

for (const status of [
	"completed",
	"incomplete",
	"failed",
	"cancelled",
] as const) {
	test(`already-terminal ${status} satisfies any immediately without returning a report`, async () => {
		const h = harness();
		const first = h.records.accept(taskInput),
			pending = h.records.accept(taskInput);
		first.complete({
			...taskResult(status),
			details: { status, error: "PRIVATE DIAGNOSTICS" },
		});
		const result = await h.wait({ taskIds: [pending.taskId, first.taskId] });
		expect(result).toEqual({
			reason: "completed",
			tasks: [
				{ taskId: pending.taskId, status: "queued" },
				{ taskId: first.taskId, status },
			],
		});
		expect(JSON.stringify(result)).not.toMatch(
			/PRIVATE|available result|usage|configuration/,
		);
		expect(first.result?.content[0].text).toBe("available result");
		expect(h.callbacks).toHaveLength(0);
		h.clean();
	});
}

test("all waits for available terminal results in both modes, not cancellation or settlement alone", async () => {
	const h = harness();
	const first = h.records.accept(taskInput);
	first.complete(taskResult());
	const second = h.records.accept({ ...taskInput, mode: "synchronous" });
	const waiting = h.wait({
		taskIds: [first.taskId, second.taskId],
		condition: "all",
	});
	second.progress.phase("initializing");
	second.progress.observe({ type: "agent_start" });
	second.cancelRequested();
	second.progress.observe({ type: "agent_settled" });
	expect(h.listeners.size).toBe(1);
	expect(h.timers.size).toBe(1);
	second.complete(taskResult("cancelled"));
	expect(await waiting).toEqual({
		reason: "completed",
		tasks: [
			{ taskId: first.taskId, status: "completed" },
			{ taskId: second.taskId, status: "cancelled" },
		],
	});
	h.clean();
});

test("unrelated completions cannot satisfy a wait; selected concurrent completions are retained", async () => {
	const h = harness();
	const selected = [h.records.accept(taskInput), h.records.accept(taskInput)];
	const other = h.records.accept(taskInput);
	const any = h.wait({ taskIds: selected.map((record) => record.taskId) });
	const all = h.wait({
		taskIds: selected.map((record) => record.taskId),
		condition: "all",
	});
	other.complete(taskResult());
	expect(h.listeners.size).toBe(2);
	selected[0].complete(taskResult("failed"));
	selected[1].complete(taskResult("incomplete"));
	expect((await any).tasks[0].status).toBe("failed");
	expect((await all).tasks.map((task) => task.status)).toEqual([
		"failed",
		"incomplete",
	]);
	h.clean();
});

for (const timeoutSeconds of [0.01, 1.5, 120]) {
	test(`custom timeout ${timeoutSeconds} includes queue/initialization time and preserves tasks`, async () => {
		const h = harness();
		const record = h.records.accept(taskInput);
		const waiting = h.wait({ taskIds: [record.taskId], timeoutSeconds });
		record.progress.phase("initializing");
		h.advance(timeoutSeconds);
		expect(await waiting).toEqual({
			reason: "timeout",
			tasks: [{ taskId: record.taskId, status: "initializing" }],
		});
		expect(h.records.get(record.taskId)).toBe(record);
		expect(record.summary().cancelling).toBe(false);
		const again = h.wait({ taskIds: [record.taskId] });
		record.complete(taskResult());
		expect((await again).reason).toBe("completed");
		h.clean();
	});
}

test("abort ends only its wait; other waits and accepted records stay intact", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	const controller = new AbortController();
	const remove = spyOn(controller.signal, "removeEventListener");
	const aborted = h.wait({ taskIds: [record.taskId] }, controller.signal);
	const other = h.wait({ taskIds: [record.taskId] });
	controller.abort("PRIVATE ABORT REASON");
	expect(await aborted).toEqual({ reason: "cancelled", tasks: [] });
	expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	expect(record.summary().cancelling).toBe(false);
	expect(record.result).toBeUndefined();
	expect(h.listeners.size).toBe(1);
	record.complete(taskResult());
	expect((await other).reason).toBe("completed");
	expect(h.cancellations()).toBe(2);
	h.clean();
	remove.mockRestore();
});

test("pre-aborted invocation does not schedule, and cancellation outranks an already-ended task", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	record.complete(taskResult());
	expect(
		await h.wait({ taskIds: [record.taskId] }, AbortSignal.abort()),
	).toEqual({
		reason: "cancelled",
		tasks: [],
	});
	expect(h.callbacks).toHaveLength(0);
	h.clean();
});

test("scope invalidation ends old waits without destination or stale snapshots", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	const waiting = h.wait({ taskIds: [record.taskId] });
	h.records.invalidate();
	const fresh = h.records.accept(taskInput);
	record.complete(taskResult());
	fresh.complete(taskResult());
	expect(await waiting).toEqual({ reason: "invalidated", tasks: [] });
	for (const callback of h.callbacks) callback();
	h.advance(120);
	h.clean();
	await expect(h.wait({ taskIds: [record.taskId] })).rejects.toThrow(
		"Unknown delegated task",
	);
	h.clean();
});

test("unknown IDs fail for the whole selection, even if another selected task is terminal", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	record.complete(taskResult());
	for (const id of [
		"unknown",
		"1",
		record.taskId.slice(0, 8),
		` ${record.taskId}`,
	]) {
		await expect(h.wait({ taskIds: [record.taskId, id] })).rejects.toThrow(
			"Unknown delegated task",
		);
		h.clean();
	}
	expect(h.callbacks).toHaveLength(0);
});

for (const args of [
	null,
	[],
	{},
	{ taskIds: [] },
	{ taskIds: null },
	{ taskIds: "id" },
	{ taskIds: [1] },
	{ taskIds: [""] },
	{ taskIds: [" "] },
	...[null, 0, -1, NaN, Infinity, 120.001, "30", true].map(
		(timeoutSeconds) => ({ taskIds: ["id"], timeoutSeconds }),
	),
	...[null, "", "ANY", "none", 1].map((condition) => ({
		taskIds: ["id"],
		condition,
	})),
]) {
	test(`reject malformed raw arguments before timers/subscriptions: ${JSON.stringify(args)}`, async () => {
		const h = harness();
		expect(() => validateWaitArguments(args)).toThrow();
		await expect(h.wait(args)).rejects.toThrow();
		expect(h.callbacks).toHaveLength(0);
		h.clean();
	});
}

test("completion during subscription cannot be lost and cleans up the returned subscription", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	h.onSubscribe(() => record.complete(taskResult()));
	expect((await h.wait({ taskIds: [record.taskId] })).reason).toBe("completed");
	expect(h.callbacks).toHaveLength(0);
	h.clean();
});

test("invalidation during subscription wins without reading invalidated records", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	h.onSubscribe(() => h.records.invalidate());
	expect(await h.wait({ taskIds: [record.taskId] })).toEqual({
		reason: "invalidated",
		tasks: [],
	});
	h.clean();
});

test("queued timeout callback cannot override a published terminal result", async () => {
	const h = harness();
	const record = h.records.accept(taskInput);
	const waiting = h.wait({ taskIds: [record.taskId] });
	const callback = h.callbacks[0];
	record.complete(taskResult());
	callback();
	expect((await waiting).reason).toBe("completed");
	h.clean();
});

test("timeout settlement stays stable across late completion and abort", async () => {
	const h = harness();
	const record = h.records.accept(taskInput),
		controller = new AbortController();
	const waiting = h.wait(
		{ taskIds: [record.taskId], timeoutSeconds: 1 },
		controller.signal,
	);
	h.advance(1);
	record.complete(taskResult());
	controller.abort();
	expect(await waiting).toEqual({
		reason: "timeout",
		tasks: [{ taskId: record.taskId, status: "queued" }],
	});
	h.clean();
});

test("scheduling failure still releases observation and abort resources", async () => {
	const h = harness();
	const record = h.records.accept(taskInput),
		controller = new AbortController();
	const remove = spyOn(controller.signal, "removeEventListener");
	spyOn(h.clock, "schedule").mockImplementation(() => {
		throw new Error("clock unavailable");
	});
	await expect(
		h.wait({ taskIds: [record.taskId] }, controller.signal),
	).rejects.toThrow("clock unavailable");
	expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	h.clean();
	remove.mockRestore();
});
