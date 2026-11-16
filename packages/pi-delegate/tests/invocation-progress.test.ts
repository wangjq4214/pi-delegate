import { expect, spyOn, test } from "bun:test";
import type { DelegateExecutionProgress } from "../src/api.ts";
import { observeInvocation } from "../src/invocation-progress.ts";
import { TaskRecords } from "../src/tasks.ts";
import { taskInput, taskResult } from "./fixtures/task-record.ts";

function setup() {
	const records = new TaskRecords();
	const record = records.accept(taskInput);
	let subscriptions = 0;
	const subscribe = records.subscribe.bind(records);
	spyOn(records, "subscribe").mockImplementation((listener) => {
		subscriptions++;
		const off = subscribe(listener);
		return () => {
			subscriptions--;
			off();
		};
	});
	const controller = new AbortController();
	const remove = spyOn(controller.signal, "removeEventListener");
	const snapshots: DelegateExecutionProgress[] = [];
	return {
		records,
		record,
		controller,
		remove,
		snapshots,
		subscriptions: () => subscriptions,
	};
}

test("observer disposal removes subscriptions/listeners without cancelling or hiding records", () => {
	const s = setup();
	const detach = observeInvocation(
		s.records,
		s.record,
		s.controller.signal,
		(value) => {
			s.snapshots.push(value);
			return new Promise<void>(() => {}); // A stalled observer must never be awaited.
		},
	);
	expect(s.subscriptions()).toBe(1);
	expect(s.snapshots).toEqual([
		{
			taskId: s.record.taskId,
			phase: "queued",
			cancelling: false,
		},
	]);
	s.record.progress.phase("initializing");
	s.record.progress.observe({ type: "agent_start" });
	detach();
	detach();
	expect(s.subscriptions()).toBe(0);
	expect(s.remove).toHaveBeenCalledTimes(1);
	expect(s.controller.signal.aborted).toBe(false);
	expect(s.records.list().total).toBe(1);
	expect(s.record.result).toBeUndefined();
	s.record.progress.observe({ type: "agent_settled" });
	s.record.complete(taskResult());
	s.controller.abort();
	expect(s.snapshots.map((value) => value.phase)).toEqual([
		"queued",
		"initializing",
		"running",
	]);
	expect(s.record.result?.details.status).toBe("completed");
});

test("terminal and invalidated records detach exactly once, including listeners, before late updates", () => {
	for (const terminal of [true, false]) {
		const s = setup();
		const detach = observeInvocation(
			s.records,
			s.record,
			s.controller.signal,
			(value) => {
				s.snapshots.push(value);
			},
		);
		const unrelated = s.records.accept(taskInput);
		unrelated.progress.observe({ type: "agent_start" });
		expect(s.snapshots).toHaveLength(1);
		if (terminal) s.record.complete(taskResult());
		else s.records.invalidate();
		const count = s.snapshots.length;
		expect(s.subscriptions()).toBe(0);
		expect(s.remove).toHaveBeenCalledTimes(1);
		expect(s.controller.signal.aborted).toBe(false);
		s.record.progress.observe({ type: "agent_start" });
		s.controller.abort();
		detach();
		expect(s.snapshots).toHaveLength(count);
		expect(s.subscriptions()).toBe(0);
	}
});
