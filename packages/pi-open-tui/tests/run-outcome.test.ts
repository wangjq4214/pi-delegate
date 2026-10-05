import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentBeforeSettleEvent } from "@earendil-works/pi-coding-agent";
import { RunOutcomeTracker, type RunOutcome, type RunState } from "../src/run-outcome.ts";

function assistant(stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant", content: [], api: "openai-completions", provider: "fixture", model: "fixture",
		stopReason, timestamp: 0,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

function fixture() {
	let now = 0;
	const state: RunState = { workingSince: undefined, lastRun: undefined };
	const tracker = new RunOutcomeTracker(state, () => now);
	return {
		tracker, state, setNow: (value: number) => { now = value; },
		result: () => state.lastRun,
		start: () => tracker.handle({ type: "agent_start" }),
		end: (reason?: AssistantMessage["stopReason"]) => tracker.handle({ type: "agent_end", messages: reason ? [assistant(reason)] : [] }),
		boundary: (outcome: AgentBeforeSettleEvent["outcome"]) => tracker.handle({ type: "agent_before_settle", outcome } as AgentBeforeSettleEvent),
		settle: () => tracker.handle({ type: "agent_settled" }),
	};
}

for (const { reason, boundary, expected } of [
	{ reason: "stop", boundary: "completed", expected: "completed" },
	{ reason: "toolUse", boundary: "completed", expected: "completed" },
	{ reason: "aborted", expected: "interrupted" },
	{ reason: "aborted", boundary: "aborted", expected: "interrupted" },
	{ reason: "error", boundary: "error", expected: "failed" },
	{ reason: "error", expected: "ended" },
	{ reason: "stop", expected: "ended" },
	{ reason: "toolUse", expected: "ended" },
	{ reason: "length", boundary: "completed", expected: "ended" },
	{ reason: "length", expected: "ended" },
	{ boundary: "completed", expected: "ended" },
	{ boundary: "aborted", expected: "ended" },
	{ reason: "error", boundary: "completed", expected: "ended" },
	{ reason: "stop", boundary: "error", expected: "ended" },
	{ reason: "pending", boundary: "completed", expected: "ended" },
	{ reason: "deferred", boundary: "completed", expected: "ended" },
	{ expected: "ended" },
] as Array<{ reason?: AssistantMessage["stopReason"]; boundary?: AgentBeforeSettleEvent["outcome"]; expected: RunOutcome }>) {
	test(`settlement: ${reason ?? "no assistant"} / ${boundary ?? "no boundary"} -> ${expected}`, () => {
		const f = fixture();
		f.start();
		f.setNow(2_000);
		f.end(reason);
		if (boundary) f.boundary(boundary);
		assert.equal(f.state.lastRun, undefined, "no result before full settlement");
		assert.equal(f.state.workingSince, 0);
		f.setNow(3_000);
		f.settle();
		assert.deepEqual(f.state.lastRun, { outcome: expected, elapsedMs: 3_000 });
		assert.equal(f.state.workingSince, undefined);
		f.setNow(9_000);
		f.settle();
		assert.deepEqual(f.state.lastRun, { outcome: expected, elapsedMs: 3_000 }, "duplicate settlement preserves duration");
	});
}

test("retries, compaction recovery and provisional continuations share a timer and later evidence wins", () => {
	for (const first of ["error", "length", "aborted", "stop"] as const) {
		const f = fixture();
		f.start();
		f.setNow(1_000);
		f.end(first);
		f.boundary(first === "error" ? "error" : first === "aborted" ? "aborted" : "completed");
		f.setNow(2_000);
		f.start();
		assert.equal(f.state.workingSince, 0);
		assert.equal(f.state.lastRun, undefined);
		f.end("stop");
		f.boundary("completed");
		f.setNow(4_000);
		f.settle();
		assert.deepEqual(f.state.lastRun, { outcome: "completed", elapsedMs: 4_000 });
	}
});

test("continuation without a decisive final message/boundary cannot reuse earlier success or failure", () => {
	for (const first of ["stop", "error", "aborted"] as const) {
		const f = fixture();
		f.start();
		f.end(first);
		f.boundary(first === "stop" ? "completed" : first === "error" ? "error" : "aborted");
		f.start();
		f.end();
		f.setNow(500);
		f.settle();
		assert.deepEqual(f.state.lastRun, { outcome: "ended", elapsedMs: 500 });
	}
});

test("a later assistant invalidates provisional evidence; tool content does not classify the run", () => {
	const f = fixture();
	f.start();
	f.end("stop");
	f.boundary("completed");
	f.tracker.handle({ type: "message_end", message: assistant("error") });
	f.tracker.handle({ type: "message_end", message: {
		role: "toolResult", toolCallId: "id", toolName: "fixture", content: [{ type: "text", text: "failed" }], isError: true, timestamp: 0,
	} });
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "ended");

	f.start();
	f.tracker.handle({ type: "message_end", message: {
		role: "toolResult", toolCallId: "id", toolName: "fixture", content: [{ type: "text", text: "aborted failed done" }], isError: true, timestamp: 0,
	} });
	f.end("stop");
	f.boundary("completed");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "completed");
});

test("the latest assistant in agent_end wins, not errors in earlier messages or the final tool result", () => {
	const f = fixture();
	f.start();
	f.tracker.handle({ type: "agent_end", messages: [
		assistant("error"), assistant("stop"),
		{ role: "toolResult", toolCallId: "id", toolName: "fixture", content: [], isError: true, timestamp: 0 },
	] });
	f.boundary("completed");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "completed");
});

test("reset discards running/retained state and evidence, ignores idle replay and late settlement", () => {
	const f = fixture();
	f.end("error");
	f.boundary("error");
	f.settle();
	assert.deepEqual(f.state, { workingSince: undefined, lastRun: undefined });
	f.start();
	f.end("aborted");
	f.tracker.reset();
	f.tracker.handle({ type: "message_end", message: assistant("aborted") });
	f.settle();
	assert.deepEqual(f.state, { workingSince: undefined, lastRun: undefined });
	f.setNow(500);
	f.start();
	f.end("stop");
	f.boundary("completed");
	f.setNow(1_500);
	f.settle();
	assert.deepEqual(f.state.lastRun, { outcome: "completed", elapsedMs: 1_000 });
	f.setNow(2_000);
	f.start();
	assert.deepEqual(f.state.lastRun, undefined);
	f.settle();
	assert.equal(f.result()?.outcome, "ended");
	f.tracker.reset();
	assert.equal(f.state.lastRun, undefined);
});

test("backward wall-clock adjustments never publish negative elapsed time", () => {
	const f = fixture();
	f.setNow(5_000);
	f.start();
	f.setNow(4_000);
	f.settle();
	assert.equal(f.state.lastRun?.elapsedMs, 0);
});

test("captured public signal recognizes tool-phase abort and cannot leak across loops/runs/reset", () => {
	const f = fixture();
	const first = new AbortController();
	f.tracker.handle({ type: "agent_start" }, first.signal);
	f.end("toolUse");
	first.abort();
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "interrupted");
	f.start();
	f.end("stop");
	f.boundary("completed");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "completed");

	const stale = new AbortController();
	f.tracker.handle({ type: "agent_start" }, stale.signal);
	f.end("error");
	f.start();
	stale.abort();
	f.end("stop");
	f.boundary("completed");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "completed");
	f.tracker.reset();
	f.start();
	f.end("stop");
	f.boundary("completed");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "completed");
});

test("turn boundaries replace early message evidence and invalidate provisional settlement", () => {
	const f = fixture();
	f.start();
	f.end("stop");
	f.boundary("completed");
	f.tracker.handle({ type: "turn_start", turnIndex: 1, timestamp: 0 });
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "ended");

	f.start();
	f.tracker.handle({ type: "message_end", message: assistant("stop") });
	f.tracker.handle({ type: "turn_end", turnIndex: 0, outcome: "error", entries: [], continue: false,
		context: { contextEntries: [], contextMessages: [], llmMessages: [], pendingMessages: [], canContinue: false },
		message: assistant("error"), toolResults: [], messageEntryId: "id", toolResultEntryIds: [],
	});
	f.boundary("error");
	f.settle();
	assert.equal(f.state.lastRun?.outcome, "failed");
});
