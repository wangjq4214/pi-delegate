import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { PeekController, type PeekLabelEditor } from "../src/peek-controller.ts";
import { SessionLifecycle } from "../src/session-lifecycle.ts";
import { UiRefresh } from "../src/ui-refresh.ts";
import { stripAnsi, visibleWidth } from "../src/utils.ts";

const assistant = { role: "assistant", stopReason: "stop" };
function fixture(t: test.TestContext) {
	let now = 1000;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	const lifecycle = new SessionLifecycle();
	lifecycle.start();
	const labels: string[] = [];
	const warnings: string[] = [];
	let clears = 0;
	let resets = 0;
	let renders = 0;
	const host = { active: true, tui: true, supported: true, columns: 80 as number | undefined, spinner: undefined as string | undefined };
	const ctx = { ui: {
		setHiddenThinkingLabel(label?: string) { assert.equal(label, undefined); clears++; },
		notify(message: string, level: string) { assert.equal(level, "warning"); warnings.push(message); },
	} } as unknown as ExtensionContext;
	let currentCtx: ExtensionContext | undefined = ctx;
	let editor: PeekLabelEditor | undefined = {
		getViewportWidth: () => host.columns,
		getWorkingSpinner: () => host.spinner,
		setLatestHiddenThinkingLabel(label, requestRender) {
			assert.equal(requestRender, false, "shared scheduler owns the render request");
			if (!host.supported) return false;
			labels.push(stripAnsi(label));
			return true;
		},
		resetHiddenThinkingLabelTarget() { resets++; },
	};
	const refresh = new UiRefresh(() => now);
	const controller = new PeekController({
		getConfig: () => config, getEditor: () => editor, getContext: () => currentCtx,
		isActive: () => host.active, isTuiContext: () => host.tui, lifecycle,
		refresh, requestRender: () => { renders++; }, now: () => now,
	});
	controller.startSession();
	t.after(() => { controller.resetAndClear(ctx); refresh.reset(); });
	const update = (thinking: string, text = "", target = ctx) => controller.messageUpdate({
		role: "assistant", content: [{ type: "thinking", thinking }, { type: "text", text }],
	}, target);
	return {
		controller, refresh, config, lifecycle, host, ctx, labels, warnings, update,
		advance(ms: number) { now += ms; },
		tick(ms = 250) { now += ms; controller.tick(ctx); },
		get clears() { return clears; }, get resets() { return resets; }, get renders() { return renders; },
		setEditor(next: PeekLabelEditor | undefined) { editor = next; },
		setContext(next?: ExtensionContext) { currentCtx = next; },
	};
}

test("native frames, not tick/render counts, drive the spinner; completion and new messages keep independent time", (t) => {
	const f = fixture(t);
	f.config.icons.mode = "unicode";
	f.host.spinner = "⠋";
	f.update("**Analyzing voting dynamics**");
	for (const spin of ["⠙", "⠹", "⠸"]) {
		f.advance(80);
		f.host.spinner = spin;
		f.controller.refreshLayout();
		assert.ok(f.labels.at(-1)!.endsWith(`${spin} Analyzing voting dynamics`));
		const count = f.labels.length;
		f.controller.refreshLayout();
		f.update("**Analyzing voting dynamics**\nmore body");
		assert.ok(f.labels.at(-1)!.endsWith(`${spin} Analyzing voting dynamics`));
		f.controller.refreshLayout();
		const rendered = f.labels.length;
		f.controller.refreshLayout();
		assert.equal(f.labels.length, rendered, "same native frame and content do not perpetually request frames");
		assert.ok(rendered <= count + 1, "elapsed event update may publish once, not advance animation");
	}
	f.controller.tick(f.ctx);
	assert.ok(f.labels.at(-1)!.endsWith("⠸ Analyzing voting dynamics"), "a slow duration tick cannot advance the native spinner");
	f.controller.messageEnd(assistant, f.ctx);
	const final = f.labels.at(-1);
	f.host.spinner = "⠼";
	f.advance(1000);
	f.controller.refreshLayout();
	assert.equal(f.labels.at(-1), final);
	assert.ok(final!.endsWith("0.2s"));
	f.controller.messageStart(assistant, f.ctx);
	f.update("**Exploring voting thresholds**");
	assert.ok(f.labels.at(-1)!.endsWith("⠼ Exploring voting thresholds"));
	assert.ok(f.labels.at(-1)!.includes("0.0s"));
});

test("only titles change collapsed content; cumulative repeats/body deltas do not create extra nodes or renders", (t) => {
	const f = fixture(t);
	f.controller.messageStart(assistant, f.ctx);
	f.update("## First\nprivate body");
	assert.equal(f.labels.at(-1), "~ Thinking · 0.0s\n`- | First");
	f.update("## First\nlonger private body");
	assert.equal(f.labels.length, 1);
	f.update("## First\nbody\n## Second");
	assert.equal(f.labels.at(-1), "~ Thinking · 0.0s\n+- First\n`- | Second");
	f.update("## First\nbody\n## Second", "answer");
	assert.equal(f.labels.at(-1), "~ + Second · 0.0s");
	f.update("## ignored", "longer answer");
	f.controller.messageEnd(assistant, f.ctx);
	assert.equal(f.labels.length, 3);
	const resets = f.resets;
	f.controller.messageStart({ role: "toolResult" }, f.ctx);
	assert.equal(f.resets, resets);
	f.controller.messageStart(assistant, f.ctx);
	assert.equal(f.resets, resets + 1);
	assert.equal(f.clears, 0, "new assistant state must not globally reset earlier summaries");
	f.update("## Fresh");
	assert.ok(!f.labels.at(-1)!.includes("First"));
	f.controller.messageStart({ role: "user" }, f.ctx);
	assert.equal(f.clears, 0, "a new user prompt also preserves previous summaries");
});

test("timer starts on the first actual thinking chunk, advances without deltas, and freezes at answer transition", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const f = fixture(t);
	f.controller.messageStart(assistant, f.ctx);
	f.advance(2000);
	f.update("## Work");
	assert.match(f.labels.at(-1)!, /0\.0s/);
	f.advance(250);
	t.mock.timers.tick(250);
	assert.equal(f.labels.at(-1), "~ Thinking · 0.3s\n`- / Work");
	f.advance(13950);
	f.update("## Work", "answer");
	assert.equal(f.labels.at(-1), "~ + Work · 14.2s");
	const count = f.labels.length;
	f.advance(10000);
	t.mock.timers.tick(10000);
	f.controller.messageEnd(assistant, f.ctx);
	f.controller.settled(f.ctx);
	assert.equal(f.labels.length, count);
	assert.equal(f.labels.at(-1), "~ + Work · 14.2s");
});

test("plain answers/replayed user updates keep native labels; untitled thinking has only one status row", (t) => {
	const f = fixture(t);
	f.controller.messageUpdate(undefined, f.ctx);
	f.controller.messageUpdate({ role: "user", content: "text" }, f.ctx);
	f.update("", "plain answer");
	f.controller.messageEnd(assistant, f.ctx);
	assert.equal(f.labels.length, 0);
	f.update("ordinary thought");
	assert.equal(f.labels.at(-1), "~ | Thinking · 0.0s");
	f.controller.messageEnd(assistant, f.ctx);
	assert.equal(f.labels.at(-1), "~ + · 0.0s");
});

for (const [stopReason, mark] of [["stop", "+"], ["toolUse", "+"], ["aborted", "!"], ["error", "x"], ["length", "-"], [undefined, "-"]] as const) {
	test(`message-level ${stopReason ?? "unknown"} uses ${mark}, not an invented task success`, (t) => {
		const f = fixture(t);
		f.update("## Verify");
		f.advance(18400);
		f.controller.messageEnd({ role: "assistant", stopReason }, f.ctx);
		assert.equal(f.labels.at(-1), `~ ${mark} Verify · 18.4s`);
		f.tick(9000);
		assert.equal(f.labels.at(-1), `~ ${mark} Verify · 18.4s`);
	});
}

test("an explicit final error can update the outcome without extending already-frozen thinking time", (t) => {
	const f = fixture(t);
	f.update("## Verify");
	f.advance(1200);
	f.update("## Verify", "answer");
	f.advance(9000);
	f.controller.messageEnd({ role: "assistant", stopReason: "error" }, f.ctx);
	assert.equal(f.labels.at(-1), "~ x Verify · 1.2s");
});

test("settlement immediately finalizes abandoned thinking neutrally and keeps the summary across subsequent messages", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const f = fixture(t);
	f.update("## Abandoned");
	f.advance(5000);
	f.controller.settled(f.ctx);
	assert.equal(f.labels.at(-1), "~ - Abandoned · 5.0s");
	assert.equal(f.clears, 0);
	f.controller.startTask();
	f.controller.messageStart(assistant, f.ctx);
	f.update("## New");
	const count = f.labels.length;
	f.advance(300);
	t.mock.timers.tick(300);
	assert.equal(f.clears, 0, "old settlement cannot later clear a new task");
	assert.ok(f.labels.length >= count);
	assert.ok(f.labels.at(-1)!.includes("New"));
});

test("cancelled abandoned thinking uses interruption, while tool results do not complete the current assistant", (t) => {
	const f = fixture(t);
	f.update("## Work");
	f.controller.messageEnd({ role: "toolResult" }, f.ctx);
	assert.equal(f.labels.length, 1);
	const abort = new AbortController();
	abort.abort();
	f.controller.settled({ ...f.ctx, signal: abort.signal } as ExtensionContext);
	assert.equal(f.labels.at(-1), "~ ! Work · 0.0s");
});

test("generation changes and shutdown reject periodic work; session restart resets the warning allowance", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const f = fixture(t);
	f.update("## Old");
	f.lifecycle.start(); // Simulate a late callback even before the explicit controller reset.
	f.advance(250);
	t.mock.timers.tick(250);
	assert.equal(f.labels.length, 1);
	f.controller.startSession();
	f.host.supported = false;
	f.update("## Missing");
	assert.equal(f.warnings.length, 1);
	f.update("## Still missing");
	assert.equal(f.warnings.length, 1);
	f.lifecycle.shutdown();
	f.controller.messageStart(assistant, f.ctx);
	f.update("## Late");
	f.controller.messageEnd(assistant, f.ctx);
	f.advance(1000);
	t.mock.timers.tick(1000);
	assert.equal(f.labels.length, 1);
	f.controller.resetAndClear(f.ctx);
	assert.equal(f.clears, 1, "uninstall still clears after shutdown");
	f.lifecycle.start();
	f.controller.startSession();
	f.update("## New session missing");
	assert.equal(f.warnings.length, 2);
});

test("unsupported targets warn once, do not cause global clears, and recover on a later valid update", (t) => {
	const f = fixture(t);
	f.host.supported = false;
	f.update("## Missing");
	f.update("## Still missing");
	assert.equal(f.labels.length, 0);
	assert.equal(f.warnings.length, 1);
	assert.match(f.warnings[0]!, /thinking peek unavailable on this host; retaining the native label/);
	f.controller.resetAndClear();
	assert.equal(f.clears, 0);
	f.host.supported = true;
	f.update("## Recovered");
	assert.match(f.labels.at(-1)!, /Recovered$/);
});

test("unavailable viewport/editor is safe; narrow/frozen resize and the current editor's target reset work", (t) => {
	const f = fixture(t);
	f.host.columns = undefined;
	f.update("## Long title");
	assert.equal(f.labels.length, 0);
	assert.equal(f.warnings.length, 1);
	f.host.columns = 1;
	f.update("## Narrow");
	assert.ok(f.labels.at(-1)!.split("\n").every((row) => visibleWidth(row) <= 1));
	f.host.columns = 80;
	f.update(`## ${"分析".repeat(40)}`);
	f.advance(68000);
	f.controller.messageEnd(assistant, f.ctx);
	f.host.columns = 24;
	f.controller.refreshLayout();
	assert.ok(visibleWidth(f.labels.at(-1)!) <= 21);
	assert.ok(f.labels.at(-1)!.endsWith("1m 8s"));
	f.setEditor(undefined);
	f.controller.resetAndClear();
	f.update("## No editor");
	assert.equal(f.warnings.length, 1);
	let nextResets = 0;
	f.setEditor({ getViewportWidth: () => 80, setLatestHiddenThinkingLabel: () => true, resetHiddenThinkingLabelTarget: () => { nextResets++; } });
	f.controller.messageStart(assistant, f.ctx);
	assert.equal(nextResets, 1);
});

for (const toggle of ["enabled", "lines"] as const) {
	test(`${toggle} disable/re-enable clears state and waits for fresh reasoning`, (t) => {
		const f = fixture(t);
		f.update("## Old");
		if (toggle === "enabled") f.config.enabled = false;
		else f.config.thinkingPeek.lines = 0;
		f.controller.configChanged(1);
		assert.equal(f.clears, 1);
		const count = f.labels.length;
		f.update("## Disabled");
		f.tick();
		assert.equal(f.labels.length, count);
		f.config.enabled = true;
		f.config.thinkingPeek.lines = 1;
		f.controller.configChanged(0);
		assert.equal(f.labels.length, count);
		f.update("## Fresh");
		assert.match(f.labels.at(-1)!, /Fresh$/);
		assert.ok(!f.labels.at(-1)!.includes("Old"));
	});
}

test("legacy 1/2 mean the same tree; icon/language configuration immediately rerenders", (t) => {
	const f = fixture(t);
	f.config.thinkingPeek.lines = 2;
	f.update("# A\n# B\n# C\n# D\n# E");
	assert.equal(f.labels.at(-1)!.split("\n").length, 5);
	f.config.thinkingPeek.lines = 1;
	f.controller.configChanged(2);
	assert.equal(f.labels.length, 1);
	f.config.icons.mode = "unicode";
	f.config.settingsLanguage = "zh";
	f.controller.configChanged(1);
	assert.match(f.labels.at(-1)!, /^💡 思考/);
});

test("inactive/non-TUI/idle replay events don't write; absent/throwing idle probes remain compatible", (t) => {
	const f = fixture(t);
	f.host.active = false;
	f.update("## Inactive");
	f.host.active = true;
	f.host.tui = false;
	f.update("## Not TUI");
	assert.equal(f.labels.length, 0);
	assert.deepEqual(f.warnings, []);
	f.host.tui = true;
	const idle = { ...f.ctx, isIdle: () => true } as ExtensionContext;
	const resets = f.resets;
	f.controller.messageStart(assistant, idle);
	f.update("## Replay", "", idle);
	assert.equal(f.resets, resets);
	assert.equal(f.labels.length, 0);
	const throwing = { ...f.ctx, isIdle: () => { throw new Error("unsupported"); } } as ExtensionContext;
	f.update("## Live", "", throwing);
	assert.match(f.labels.at(-1)!, /Live$/);
	f.host.tui = false;
	f.controller.clearLabel();
	assert.equal(f.clears, 0);
	f.host.tui = true;
	f.controller.clearLabel();
	assert.equal(f.clears, 1);
});

test("resetAndClear can use its captured context even when the global context is unavailable", (t) => {
	const f = fixture(t);
	f.update("## Captured");
	f.setContext(undefined);
	f.controller.resetAndClear();
	assert.equal(f.clears, 1);
});

test("unavailable targets do not poll periodically and an available layout can resume demand", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const set = globalThis.setTimeout;
	let wakeups = 0;
	t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => set(() => { wakeups++; callback(); }, delay));
	const f = fixture(t);
	f.host.supported = false;
	f.update("## Missing");
	f.advance(250); t.mock.timers.tick(250);
	assert.equal(wakeups, 0);
	f.host.supported = true;
	f.update("## Recovered");
	f.advance(250); t.mock.timers.tick(250);
	assert.equal(wakeups, 1);
	f.host.columns = undefined;
	f.controller.refreshLayout();
	f.advance(250); t.mock.timers.tick(250);
	assert.equal(wakeups, 1);
	f.host.columns = 80;
	f.controller.refreshLayout();
	f.advance(250); t.mock.timers.tick(250);
	assert.equal(wakeups, 2);
	assert.equal(f.warnings.length, 1);
});
