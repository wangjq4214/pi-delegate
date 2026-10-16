import assert from "node:assert/strict";
import test from "node:test";
import { UiRefresh } from "../src/ui-refresh.ts";

function fixture(t: test.TestContext) {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
	const set = globalThis.setTimeout;
	const clear = globalThis.clearTimeout;
	const active = new Set<ReturnType<typeof setTimeout>>();
	let wakeups = 0;
	let maximum = 0;
	t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
		const timer = set(() => { active.delete(timer); wakeups++; callback(); }, delay);
		active.add(timer);
		maximum = Math.max(maximum, active.size);
		return timer;
	});
	t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { active.delete(timer); clear(timer); });
	const refresh = new UiRefresh(() => Date.now());
	t.after(() => refresh.reset());
	return { refresh, advance: (ms: number) => t.mock.timers.tick(ms), get active() { return active.size; }, get wakeups() { return wakeups; }, get maximum() { return maximum; } };
}

test("three consumers share one source, align due work, keep slower cadence and coalesce render channels", (t) => {
	const f = fixture(t);
	const counts = { workline: 0, thinking: 0, tool: 0, render: 0 };
	const render = () => { counts.render++; };
	const stopWorkline = f.refresh.subscribe(250, () => { counts.workline++; f.refresh.requestRender(render); });
	f.advance(40); // An arrival offset must not create another wakeup phase.
	const stopThinking = f.refresh.subscribe(250, () => { counts.thinking++; f.refresh.requestRender(render); });
	const stopTools = f.refresh.subscribe(500, () => { counts.tool++; f.refresh.requestRender(render); });
	assert.equal(f.active, 1);
	f.advance(210);
	for (let i = 0; i < 3; i++) f.advance(250);
	assert.deepEqual(counts, { workline: 4, thinking: 4, tool: 2, render: 4 });
	assert.equal(f.wakeups, 4);
	assert.equal(f.maximum, 1);
	stopThinking();
	stopWorkline();
	assert.equal(f.active, 1, "slower tool demand survives another consumer's completion");
	f.advance(500);
	assert.equal(counts.tool, 3);
	stopTools();
	assert.equal(f.active, 0);
	const count = f.wakeups;
	f.advance(10000);
	assert.equal(f.wakeups, count, "no idle wakeups");
});

test("reset during dispatch cancels stale consumers and queued rendering without stopping a replacement subscription", (t) => {
	const f = fixture(t);
	let stale = 0;
	let replacement = 0;
	let rendered = 0;
	const disposeOld = f.refresh.subscribe(250, () => {
		f.refresh.requestRender(() => { rendered++; });
		f.refresh.reset();
		f.refresh.subscribe(500, () => { replacement++; });
	});
	f.refresh.subscribe(250, () => { stale++; });
	f.advance(250);
	assert.equal(stale, 0);
	assert.equal(rendered, 0);
	disposeOld();
	f.advance(500);
	assert.equal(replacement, 1);
	assert.equal(f.active, 1);
	assert.equal(f.maximum, 1);
});

test("unsubscribing due work while dispatching is safe and doesn't erase unrelated demand", (t) => {
	const f = fixture(t);
	let called = 0;
	let disposeSecond: () => void;
	const first = f.refresh.subscribe(250, () => { disposeSecond(); });
	disposeSecond = f.refresh.subscribe(250, () => { assert.fail("disposed callback must not run"); });
	f.refresh.subscribe(500, () => { called++; });
	f.advance(250);
	first();
	f.advance(250);
	assert.equal(called, 1);
	assert.equal(f.maximum, 1);
});

test("event-driven rendering is immediate; repeated enable/disable doesn't retain timers", (t) => {
	const f = fixture(t);
	let renders = 0;
	f.refresh.requestRender(() => { renders++; });
	assert.equal(renders, 1);
	for (let i = 0; i < 20; i++) {
		const stop = f.refresh.subscribe(250, () => { assert.fail("no time advanced"); });
		assert.equal(f.active, 1);
		stop(); stop();
		assert.equal(f.active, 0);
	}
	for (const interval of [0, -1, Infinity, NaN]) assert.throws(() => f.refresh.subscribe(interval, () => {}), /positive/);
});

test("paused clocks skip obsolete frames instead of replaying a burst of missed updates", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let now = 0;
	let updates = 0;
	const refresh = new UiRefresh(() => now);
	t.after(() => refresh.reset());
	refresh.subscribe(250, () => { updates++; });
	now = 10000;
	t.mock.timers.tick(250);
	assert.equal(updates, 1);
	now += 250;
	t.mock.timers.tick(250);
	assert.equal(updates, 2);
});
