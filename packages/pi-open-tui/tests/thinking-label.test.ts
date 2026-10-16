import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir, initTheme, VERSION, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, TuiAltScreen, stripTerminalSequences, visibleWidth, type Terminal, type TUI } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { PeekController } from "../src/peek-controller.ts";
import { installEditor, type OpenTuiEditor } from "../src/editor.ts";
import { createWorklineRenderer } from "../src/workline.ts";
import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme } from "@earendil-works/pi-tui";
import { SessionLifecycle } from "../src/session-lifecycle.ts";
import { ThinkingLabelTarget } from "../src/thinking-label.ts";
import { UiRefresh } from "../src/ui-refresh.ts";

function component() {
	return {
		children: [] as unknown[], label: "Thinking...",
		setHiddenThinkingLabel(label: string) { this.label = label; },
		setHideThinkingBlock() {}, updateContent() {},
	};
}

test("thinking compatibility finds the latest component, tolerates cycles and resets its cached target", () => {
	const first = component();
	const second = component();
	let renders = 0;
	const tui = { children: [first, { children: [second] }] as unknown[], requestRender() { renders++; } };
	tui.children.push(tui, null);
	const bridge = new ThinkingLabelTarget(tui as unknown as TUI);
	assert.equal(bridge.set("latest"), true);
	assert.equal(first.label, "Thinking...");
	assert.equal(second.label, "latest");
	const third = component();
	tui.children.push(third);
	bridge.set("cached");
	assert.equal(second.label, "cached");
	bridge.reset();
	bridge.set("next message");
	assert.equal(third.label, "next message");
	assert.equal(renders, 3);
});

test("missing/incompatible/throwing host components fail safely and later recover", () => {
	const tui = { children: [{ children: [], setHiddenThinkingLabel() { throw new Error("incompatible"); } }] as unknown[], requestRender() {} };
	const bridge = new ThinkingLabelTarget(tui as unknown as TUI);
	assert.equal(bridge.set("no target"), false);
	const broken = component();
	broken.setHiddenThinkingLabel = () => { throw new Error("host changed"); };
	tui.children.push(broken);
	assert.equal(bridge.set("throwing"), false);
	const recovered = component();
	tui.children.push(recovered);
	assert.equal(bridge.set("recovered"), true);
	assert.equal(recovered.label, "recovered");
});

// Actual pinned host component and TUI, not a fake label target. The clock and
// terminal are deterministic; this does not establish live font/IME compatibility.
const { AssistantMessageComponent } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/assistant-message.js")).href);
const { WorkingStatusIndicator } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/status-indicator.js")).href);
const { InteractiveMode } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/interactive-mode.js")).href);
initTheme("dark");

for (const mode of ["regular", "fullscreen"] as const) {
	test(`title tree renders bounded native ${mode} rows and preserves expansion and frozen resize`, (t) => {
		assert.equal(VERSION, "1.1.0");
		let columns = 80;
		const terminal: Terminal = {
			get columns() { return columns; }, rows: 24, kittyProtocolActive: false,
			start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
			showCursor() {}, hideCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
			setTitle() {}, setProgress() {}, setProgramStatus() {},
		};
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		const config = structuredClone(DEFAULT_CONFIG);
		config.icons.mode = "nerd";
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		let now = 1000;
		let message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "previous thought\nlatest thought" }] };
		const component = new AssistantMessageComponent(message, true);
		tui.addChild(component);
		const bridge = new ThinkingLabelTarget(tui);
		const refresh = new UiRefresh(() => now);
		const ctx = { ui: {
			setHiddenThinkingLabel(label = "Thinking...") { component.setHiddenThinkingLabel(label); },
			notify(message: string) { assert.fail(message); },
		} } as unknown as ExtensionContext;
		const editor = {
			getViewportWidth: () => terminal.columns,
			setLatestHiddenThinkingLabel: (label: string, render?: boolean) => bridge.set(label, render),
			resetHiddenThinkingLabelTarget: () => bridge.reset(),
		};
		const controller = new PeekController({
			getConfig: () => config, getEditor: () => editor,
			getContext: () => ctx, isActive: () => true, isTuiContext: () => true,
			lifecycle, now: () => now, refresh, requestRender: () => tui.requestRender(),
		});
		t.after(() => { controller.resetAndClear(ctx); refresh.reset(); tui.stop(); });
		const rows = () => {
			const rendered: string[] = component.render(terminal.columns);
			assert.ok(rendered.every((row) => visibleWidth(row) <= terminal.columns));
			return rendered.map((row) => stripTerminalSequences(row).trim()).filter(Boolean);
		};
		controller.messageStart(message, ctx);
		controller.messageUpdate(message, ctx);
		now += 4900;
		controller.tick(ctx);
		assert.deepEqual(rows(), [" ⠙ Thinking · 4.9s"]);
		component.setHideThinkingBlock(false);
		assert.equal(rows().join(" "), "previous thought latest thought");
		controller.tick(ctx);
		assert.equal(rows().join(" "), "previous thought latest thought");
		component.setHideThinkingBlock(true);

		message = { ...message, content: [{ type: "thinking", thinking: "# A\n# B\n# C\n# D\n# E\nprivate body" }] };
		component.updateContent(message, true);
		controller.messageUpdate(message, ctx);
		assert.deepEqual(rows(), [" Thinking · 4.9s", "├─ B", "├─ C", "├─ D", "└─ ⠹ E"]);
		config.thinkingPeek.lines = 2;
		controller.configChanged(1, ctx);
		assert.equal(rows().length, 5, "legacy 2 does not change the fixed title budget");

		message = { ...message, content: [{ type: "thinking", thinking: `## ${"分析".repeat(40)}` }] };
		component.updateContent(message, true);
		controller.messageUpdate(message, ctx);
		now = 69000;
		controller.messageEnd(message, ctx);
		assert.equal(rows().length, 1);
		assert.ok(rows()[0]!.endsWith("1m 8s"));
		columns = 24;
		controller.refreshLayout();
		assert.equal(rows().length, 1);
		assert.ok(rows()[0]!.endsWith("1m 8s"));
		now += 10000;
		controller.tick(ctx);
		assert.ok(rows()[0]!.endsWith("1m 8s"));
		config.thinkingPeek.lines = 0;
		controller.configChanged(1, ctx);
		assert.deepEqual(rows(), ["Thinking..."]);
	});
}

for (const mode of ["regular", "fullscreen"] as const) {
	for (const iconMode of ["unicode", "nerd", "ascii"] as const) {
		test(`native ${mode}/${iconMode} bold titles and Workline/Think render at the same actual spinner speed`, (t) => {
			t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
			let now = 1000;
			let requested = false;
			const terminal: Terminal = {
				columns: 100, rows: 24, kittyProtocolActive: false,
				start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
				showCursor() {}, hideCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
				setTitle() {}, setProgress() {}, setProgramStatus() {},
			};
			const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
			t.mock.method(tui, "requestRender", () => { requested = true; });
			const config = structuredClone(DEFAULT_CONFIG);
			config.icons.mode = iconMode;
			config.workline.marquee = false;
			const lifecycle = new SessionLifecycle();
			lifecycle.start();
			const refresh = new UiRefresh(() => now);
			const message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "" }] };
			const component = new AssistantMessageComponent(message, true);
			tui.addChild(component); // Native transcript renders BEFORE the editor, as in the real host.
			let mounted: OpenTuiEditor | undefined;
			let controller: PeekController | undefined;
			const ctx = { ui: {
				theme: { fg: (_color: string, text: string) => text } as Theme,
				setHiddenThinkingLabel(label = "Thinking...") { component.setHiddenThinkingLabel(label); },
				notify(text: string) { assert.fail(text); },
				setEditorComponent(factory?: (tui: TUI, theme: EditorTheme, keys: KeybindingsManager) => OpenTuiEditor) {
					mounted = factory?.(tui, { borderColor: (text: string) => text } as EditorTheme, { matches: () => false } as unknown as KeybindingsManager);
				},
			} } as unknown as ExtensionContext;
			const state = { workingSince: 500, lastRun: undefined };
			const workline = createWorklineRenderer(() => state, () => config, () => ctx.ui.theme, () => now);
			const editor = installEditor({} as ExtensionAPI, ctx, "block", undefined, "minimal", workline,
				undefined, (changed) => controller?.refreshLayout(changed));
			tui.addChild(mounted!);
			controller = new PeekController({
				getConfig: () => config, getEditor: () => editor, getContext: () => ctx,
				isActive: () => true, isTuiContext: () => true, lifecycle, refresh, now: () => now,
				requestRender: () => editor.requestRender(),
			});
			t.after(() => { controller?.resetAndClear(ctx); refresh.reset(); editor.cleanup(); tui.stop(); });
			tui.start();
			const paint = () => {
				let passes = 0;
				do {
					requested = false;
					(tui as unknown as { doRender(): void }).doRender();
					assert.ok(++passes <= 3, "native-frame publication must settle, not cause an endless render loop");
				} while (requested);
			};
			const rows = () => (component.render(terminal.columns) as string[]).map(stripTerminalSequences).map((row) => row.trim()).filter(Boolean);
			const update = (thinking: string, answer = "") => {
				const current = { ...message, content: [{ type: "thinking", thinking }, ...(answer ? [{ type: "text", text: answer }] : [])] };
				component.updateContent(current, true);
				controller!.messageUpdate(current, ctx);
				paint();
			};
			const braille = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
			const ascii = ["|", "|", "|", "/", "/", "-", "-", "-", "\\", "\\"];
			const source = "**Analyzing voting dynamics**\nPrivate explanatory body\n\n**Exploring voting thresholds**";
			for (const period of [80, 37, 140]) {
				// Default host speed and two custom speeds, all unlike the shared 250ms duration tick.
				const native = new WorkingStatusIndicator(tui, "working", period === 80 ? undefined : { frames: braille, intervalMs: period });
				t.after(() => native.dispose());
				mounted!.setWorkingStatusIndicator(native);
				controller.messageStart(message, ctx);
				for (let n = 1; n <= source.length; n++) update(source.slice(0, n));
				assert.equal(rows().length, 3);
				assert.ok(rows()[1]!.endsWith("Analyzing voting dynamics"));
				assert.ok(rows()[2]!.endsWith("Exploring voting thresholds"));
				assert.ok(!rows().join(" ").includes("Private explanatory body"));
				component.setHideThinkingBlock(false);
				assert.ok(rows().join(" ").includes("Private explanatory body"), "full native reasoning is preserved");
				component.setHideThinkingBlock(true);
				for (let frame = 0; frame < 21; frame++) {
					config.workline.attachToBorder = frame % 2 === 0;
					paint();
					const expected = (iconMode === "ascii" ? ascii : braille)[frame % 10]!;
					assert.equal(stripTerminalSequences(native.renderSpinnerInBorder(16)), braille[frame % 10]);
					assert.ok(rows().at(-1)!.includes(`${expected} Exploring voting thresholds`), `${mode}/${iconMode} period=${period} frame=${frame}: ${JSON.stringify(rows())}`);
					for (const compact of [false, true]) {
						assert.ok(stripTerminalSequences(workline.render(90, native, compact)).startsWith(expected));
					}
					const unchanged = rows();
					paint(); paint();
					assert.deepEqual(rows(), unchanged, "extra host renders do not accelerate the animation");
					now += period;
					t.mock.timers.tick(period);
				}
				update(source, "answer");
				const frozen = rows();
				now += period;
				t.mock.timers.tick(period);
				paint();
				assert.deepEqual(rows(), frozen, "thinking summary freezes while native Workline continues");
				assert.equal(frozen.length, 2, "one thinking summary plus the native answer row");
				assert.ok(frozen[0]!.includes("Exploring voting thresholds"));
				assert.ok(now - state.workingSince > period * 21, "whole-run timing has its own start");
				native.dispose();
			}
		});
	}
}

for (const mode of ["regular", "fullscreen"] as const) {
	test(`native ${mode}: completed summaries survive new user/plain/thinking messages without global label resets`, (t) => {
		t.mock.timers.enable({ apis: ["setTimeout"] });
		let now = 1000;
		let clears = 0;
		const terminal: Terminal = {
			columns: 100, rows: 24, kittyProtocolActive: false,
			start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {},
			showCursor() {}, hideCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
			setTitle() {}, setProgress() {}, setProgramStatus() {},
		};
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		const config = structuredClone(DEFAULT_CONFIG);
		config.icons.mode = "ascii";
		const lifecycle = new SessionLifecycle();
		lifecycle.start();
		const refresh = new UiRefresh(() => now);
		const components: InstanceType<typeof AssistantMessageComponent>[] = [];
		const host = { defaultHiddenThinkingLabel: "Thinking...", chatContainer: { children: components }, ui: tui };
		const ctx = { ui: {
			setHiddenThinkingLabel(label?: string) {
				clears++;
				// Exercise the real host's global reset, which affects ALL Assistant components.
				InteractiveMode.prototype.setHiddenThinkingLabel.call(host, label);
			},
			notify(text: string) { assert.fail(text); },
		} } as unknown as ExtensionContext;
		const bridge = new ThinkingLabelTarget(tui);
		const controller = new PeekController({
			getConfig: () => config,
			getEditor: () => ({
				getViewportWidth: () => terminal.columns,
				setLatestHiddenThinkingLabel: (label: string, render?: boolean) => bridge.set(label, render),
				resetHiddenThinkingLabelTarget: () => bridge.reset(),
			}),
			getContext: () => ctx, isActive: () => true, isTuiContext: () => true,
			lifecycle, refresh, now: () => now, requestRender: () => tui.requestRender(),
		});
		t.after(() => { controller.resetAndClear(ctx); refresh.reset(); tui.stop(); });
		const mount = (thinking: string, text = "") => {
			const message = { role: "assistant", stopReason: "stop", content: [
				...(thinking ? [{ type: "thinking", thinking }] : []),
				...(text ? [{ type: "text", text }] : []),
			] };
			const component = new AssistantMessageComponent(message, true);
			components.push(component);
			tui.addChild(component);
			controller.messageStart(message, ctx);
			controller.messageUpdate(message, ctx);
			return { message, component };
		};
		const rows = (component: InstanceType<typeof AssistantMessageComponent>) =>
			(component.render(terminal.columns) as string[]).map(stripTerminalSequences).map((row) => row.trim()).filter(Boolean);

		const first = mount("**First**\nprivate reasoning");
		now += 1400;
		controller.messageEnd(first.message, ctx);
		assert.deepEqual(rows(first.component), ["~ + First · 1.4s"]);
		const frozen = rows(first.component);
		controller.messageStart({ role: "user" }, ctx);
		assert.deepEqual(rows(first.component), frozen, "a new prompt must not erase old summaries");

		const plain = mount("", "plain answer");
		controller.messageEnd(plain.message, ctx);
		controller.settled(ctx);
		controller.refreshLayout(true);
		assert.deepEqual(rows(first.component), frozen, "a plain final answer must not turn prior summaries into Thinking...");
		assert.deepEqual(rows(plain.component), ["plain answer"], "no synthetic thinking on a plain answer");

		now += 5000;
		const second = mount("**Second**\nother reasoning");
		assert.ok(rows(second.component)[0]!.endsWith("0.0s"), "fresh thinking measures a fresh segment");
		assert.ok(!rows(second.component).join(" ").includes("First"));
		now += 600;
		controller.messageEnd(second.message, ctx);
		assert.deepEqual(rows(second.component), ["~ + Second · 0.6s"]);
		assert.deepEqual(rows(first.component), frozen, "later thinking writes only to its own component");
		assert.equal(clears, 0);

		const abandoned = mount("**Abandoned**");
		now += 500;
		const afterAbandon = mount("", "answer after missing message_end");
		assert.deepEqual(rows(abandoned.component), ["~ - Abandoned · 0.5s"], "missing final evidence freezes neutrally before switching targets");
		assert.deepEqual(rows(afterAbandon.component), ["answer after missing message_end"]);
		now += 5000;
		t.mock.timers.tick(5000);
		controller.refreshLayout();
		assert.deepEqual(rows(first.component), frozen);
		assert.deepEqual(rows(abandoned.component), ["~ - Abandoned · 0.5s"]);
		assert.equal(clears, 0);

		mount("", "another plain answer"); // No active custom label now; teardown must still restore retained labels.
		config.thinkingPeek.lines = 0;
		controller.configChanged(1, ctx);
		assert.equal(clears, 1);
		assert.deepEqual(rows(first.component), ["Thinking..."]);
		assert.deepEqual(rows(second.component), ["Thinking..."]);
		controller.resetAndClear(ctx);
		assert.equal(clears, 1, "repeated cleanup is idempotent");
	});
}
