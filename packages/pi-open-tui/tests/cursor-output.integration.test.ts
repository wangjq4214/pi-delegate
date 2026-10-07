import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type EditorTheme, type Terminal, type TUI } from "@earendil-works/pi-tui";
import type { CursorStyle } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { installEditor, type OpenTuiEditor } from "../src/editor.ts";
import { createWorklineRenderer } from "../src/workline.ts";

// Default pinned host; an explicit module root also exercises an installed host without changing it.
const modules = process.env.OPEN_TUI_CURSOR_HOST_MODULES ?? path.resolve(import.meta.dirname, "../node_modules");
const { TuiMainScreen, TuiAltScreen } = await import(pathToFileURL(path.join(modules, "@earendil-works/pi-tui/dist/index.js")).href);
const { createInteractiveTuiReference } = await import(pathToFileURL(path.join(modules, "@earendil-works/pi-coding-agent/dist/modes/interactive/tui-renderer.js")).href);
const BEGIN = "\x1b[?2026h";
const END = "\x1b[?2026l";
const SHOW = "\x1b[?25h";
const HIDE = "\x1b[?25l";
const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
const worklineTheme = { fg: (_color: string, text: string) => text } as Theme;
const keys = { matches: () => false } as unknown as KeybindingsManager;

function fixture(mode: "regular" | "fullscreen", style: CursorStyle, attached = true, preference = false, nonWritableInitial = false) {
	const writes: string[] = [];
	const warnings: string[] = [];
	const terminal = {
		columns: 80, rows: 24, kittyProtocolActive: false,
		start() {}, stop() {}, drainInput: async () => {},
		write: (data: string) => writes.push(data),
		showCursor: () => writes.push(SHOW), hideCursor: () => writes.push(HIDE),
		moveBy: (n: number) => writes.push(n > 0 ? `\x1b[${n}B` : `\x1b[${-n}A`),
		clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {},
	} as Terminal;
	let host: TUI = mode === "regular" ? new TuiMainScreen(terminal, preference) : new TuiAltScreen(terminal, preference);
	const reference: TUI = createInteractiveTuiReference(() => host);
	const nativeRender = Reflect.get(host, "doRender");
	if (nonWritableInitial) Object.defineProperty(host, "doRender", { value: nativeRender, configurable: false, writable: false });
	const nativeWrite = terminal.write;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	config.workline.attachToBorder = attached;
	const state = { workingSince: 0, lastRun: undefined };
	let now = 1000;
	const workline = createWorklineRenderer(() => state, () => config, () => worklineTheme, () => now);
	let editor: OpenTuiEditor;
	let factory: ((tui: TUI, theme: EditorTheme, keys: KeybindingsManager) => OpenTuiEditor) | undefined;
	const applyFactory = () => {
		if (editor) host.removeChild(editor);
		editor = factory!(reference, theme, keys);
		host.addChild(editor);
		host.setFocus(editor);
	};
	const ctx = { ui: {
		notify: (message: string) => warnings.push(message),
		setEditorComponent(next: typeof factory) {
			factory = next;
			if (next) applyFactory();
			else { host.removeChild(editor); host.setFocus(null); }
		},
	} } as unknown as ExtensionContext;
	const installed = installEditor({} as ExtensionAPI, ctx, style, undefined, "surround", workline);
	host.start();
	return {
		writes, warnings, terminal, reference, installed, nativeRender, nativeWrite,
		initialOutput: writes.join(""),
		get host() { return host; }, get editor() { return editor; },
		tick() { now += 250; },
		render(force = false) { writes.length = 0; host.renderNow(force); return writes.join(""); },
		applyFactory,
		switchMode(nextMode: "regular" | "fullscreen", nonWritable = false, startRenderer = true) {
			host.stop({ preserveScreen: true });
			host.setFocus(null);
			host.clear();
			const show = host.getShowHardwareCursor();
			host = nextMode === "regular" ? new TuiMainScreen(terminal, show) : new TuiAltScreen(terminal, show);
			if (nonWritable) Object.defineProperty(host, "doRender", { value: Reflect.get(host, "doRender"), configurable: false, writable: false });
			host.addChild(editor);
			host.invalidate();
			host.setFocus(editor);
			if (startRenderer) host.start();
		},
		cleanup() { installed.cleanup(); host.stop(); },
	};
}

for (const mode of ["regular", "fullscreen"] as const) for (const style of ["block", "bar", "underline"] as const) for (const attached of [true, false]) {
	test(`${mode}/${style}/Workline ${attached ? "attached" : "detached"}: ordered frames, deduplication, text and cleanup`, (t) => {
		const f = fixture(mode, style, attached, true);
		t.after(() => f.cleanup());
		f.editor.setText("中文 é 👩‍💻 abc");
		const first = f.render();
		assert.ok(first.includes(BEGIN));
		assert.equal(first.endsWith(END), true);
		assert.ok(first.includes("working 1s"));
		assert.ok(!first.includes(CURSOR_MARKER), "marker stripped by host, not plugin");
		assert.ok(style === "block" ? !first.includes(SHOW) && f.initialOutput.includes(HIDE) : first.includes(SHOW));
		assert.equal(f.host.getShowHardwareCursor(), style !== "block");
		assert.equal(f.editor.getText(), "中文 é 👩‍💻 abc");
		const rendered = f.editor.render(80).join("\n");
		assert.equal(rendered.includes("\x1b[7m"), style === "block");
		if (style !== "block") assert.ok(f.initialOutput.includes(style === "bar" ? "\x1b[6 q" : "\x1b[4 q"));

		const unchanged = f.render();
		assert.ok(!unchanged.includes(SHOW) && !unchanged.includes(HIDE));
		for (let i = 0; i < 5; i++) {
			f.tick();
			const updated = f.render();
			assert.ok(!updated.includes(SHOW) && !updated.includes(HIDE), "Workline refresh doesn't reset visibility");
			if (updated.includes(BEGIN)) {
				assert.ok(updated.endsWith(END));
				const position = [...updated.matchAll(mode === "regular" ? /\x1b\[\d+G/g : /\x1b\[\d+;\d+H/g)].at(-1);
				assert.ok(position && position.index < updated.lastIndexOf(END), "final cursor movement precedes commit");
			}
		}
		// Host settings can be reapplied after session_start. All styles reassert their policy.
		f.host.setShowHardwareCursor(style === "block");
		f.render();
		assert.equal(f.host.getShowHardwareCursor(), style !== "block");
		const forced = f.render(true);
		assert.ok(forced.includes(style === "block" ? HIDE : SHOW));
		Object.defineProperty(f.terminal, "columns", { value: 60, configurable: true });
		assert.ok(f.render().endsWith(END));
		f.installed.cleanup();
		assert.equal(f.host.getShowHardwareCursor(), true, "original preference restored");
		assert.equal(Reflect.get(f.host, "doRender"), f.nativeRender);
		assert.equal(f.terminal.write, f.nativeWrite);
		assert.deepEqual(f.warnings, []);
	});
}

test("hidden block cursor still positions the hardware cursor at the IME marker", (t) => {
	const f = fixture("regular", "block");
	t.after(() => f.cleanup());
	f.editor.setText("中é");
	const output = f.render();
	assert.ok(output.includes("\x1b[6G"), "2-column frame inset + Chinese 2 + combined grapheme 1 = column 6");
	assert.ok(!output.includes(SHOW));
	assert.ok(f.editor.render(80).some((line) => line.includes(CURSOR_MARKER)));
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: overlays own focus and style previews don't persist after refocus`, (t) => {
		const f = fixture(mode, "block", true, true);
		t.after(() => f.cleanup());
		f.render();
		const input = { focused: false, render: () => ["dialog " + CURSOR_MARKER + "x"], invalidate() {} };
		const overlay = f.host.showOverlay(input);
		const overlayOutput = f.render();
		assert.ok(overlayOutput.includes(SHOW), "block preference doesn't suppress an overlay's real cursor");
		assert.equal(input.focused, true);
		assert.equal(f.editor.focused, false);
		f.writes.length = 0;
		overlay.hide();
		const immediateHide = f.writes.join("");
		assert.ok((immediateHide + f.render()).includes(HIDE));
		assert.equal(f.editor.focused, true);
		f.host.showOverlay({ render: () => ["settings"], invalidate() {} });
		f.installed.setCursorStyle("bar");
		assert.ok(f.render().includes(SHOW), "hardware style preview retains an editor position");
		f.host.hideOverlay();
		f.render();
		f.writes.length = 0;
		f.host.showOverlay({ render: () => ["unrelated"], invalidate() {} });
		const overlayHide = f.writes.join("");
		assert.ok((overlayHide + f.render()).includes(HIDE), "old editor preview doesn't leak through later overlays");
		f.host.hideOverlay();
		f.installed.setCursorStyle("underline");
		assert.ok(f.render().includes(SHOW));
		f.installed.setCursorStyle("block");
		const block = f.render();
		assert.ok(!block.includes(SHOW));
		assert.equal(f.host.getShowHardwareCursor(), false);
	});
}

test("actual stable host reference rebinds across mode switches and restores old instances", (t) => {
	const f = fixture("regular", "bar");
	t.after(() => f.cleanup());
	const old = f.host;
	f.render();
	for (const mode of ["fullscreen", "regular", "fullscreen", "regular"] as const) {
		f.switchMode(mode);
		const output = f.render(true);
		assert.ok(output.endsWith(END));
		assert.equal(f.reference.mode, mode);
		f.tick();
		const updated = f.render();
		assert.ok(!updated.includes(SHOW) && !updated.includes(HIDE));
	}
	assert.equal(Reflect.get(old, "doRender"), f.nativeRender);
	assert.equal(Object.getOwnPropertySymbols(old).length, 0);
	assert.deepEqual(f.warnings, []);
});

test("repeated editor factories preserve original preference and cleanup occurs once", (t) => {
	const f = fixture("regular", "bar", true, false);
	t.after(() => f.cleanup());
	f.render();
	f.applyFactory();
	f.render();
	f.installed.cleanup();
	assert.equal(f.host.getShowHardwareCursor(), false);
	assert.equal(Reflect.get(f.host, "doRender"), f.nativeRender);
	assert.equal(f.terminal.write, f.nativeWrite);
	const writes = f.writes.length;
	f.installed.cleanup();
	assert.equal(f.writes.length, writes);
});

test("scheduled requestRender frames use the protected seam, not only renderNow", async (t) => {
	const f = fixture("regular", "underline");
	t.after(() => f.cleanup());
	f.render();
	for (let i = 0; i < 4; i++) f.tick();
	f.writes.length = 0;
	f.installed.requestRender();
	await new Promise((resolve) => setTimeout(resolve, 50));
	const output = f.writes.join("");
	assert.ok(output.includes(BEGIN) && output.endsWith(END));
	assert.ok(!output.includes(SHOW));
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: streaming transcript growth, shrinking and editor movement keep final cursor atomic`, (t) => {
		const f = fixture(mode, "bar", false);
		t.after(() => f.cleanup());
		let lines = ["stream 0"];
		f.host.children.unshift({ render: () => lines, invalidate() {} });
		f.render();
		for (const count of [2, 5, 30, 32, 3, 1]) {
			lines = Array.from({ length: count }, (_, i) => `stream ${i}`);
			const output = f.render();
			assert.ok(output.includes(BEGIN) && output.endsWith(END));
			assert.ok(!output.includes(SHOW) && !output.includes(HIDE));
			assert.equal(f.editor.getText(), "");
		}
		f.editor.setText("中é");
		const output = f.render();
		assert.ok(output.endsWith(END));
		assert.ok(output.includes(mode === "regular" ? "\x1b[6G" : ";6H"));
		assert.ok(!output.includes(SHOW), "input movement doesn't need another show");
	});
}

test("non-writable replacement renderer warns once and releases all old adaptations", (t) => {
	const f = fixture("regular", "bar");
	t.after(() => f.cleanup());
	const old = f.host;
	f.render();
	f.switchMode("fullscreen", true);
	f.render();
	f.render();
	assert.equal(f.warnings.length, 1);
	assert.match(f.warnings[0]!, /cursor output adaptation unavailable/);
	assert.equal(Reflect.get(old, "doRender"), f.nativeRender);
	assert.equal(f.terminal.write, f.nativeWrite);
	assert.equal(Object.getOwnPropertySymbols(f.host).some((symbol) => symbol.description === "open-tui-renderer"), false);
});

test("initial unsupported seam falls back without partial patches and warns only once per installation", (t) => {
	const f = fixture("regular", "underline", true, false, true);
	t.after(() => f.cleanup());
	f.render();
	f.applyFactory();
	f.render();
	assert.equal(f.warnings.length, 1);
	assert.match(f.warnings[0]!, /using native cursor output/);
	assert.equal(Reflect.get(f.host, "doRender"), f.nativeRender);
	assert.equal(f.terminal.write, f.nativeWrite);
	assert.equal(Object.getOwnPropertySymbols(f.host).length, 0);
});

for (const style of ["block", "bar", "underline"] as const) {
	test(`fullscreen transcript exit: first regular ${style} frame is adapted without terminal.start`, (t) => {
		const f = fixture("fullscreen", style);
		t.after(() => f.cleanup());
		f.editor.setText("中é");
		f.render();
		// Mirror switchTuiMode("regular", false, false): remount + invalidate + focus,
		// no terminal start, then the immediate first renderNow().
		f.switchMode("regular", false, false);
		const output = f.render();
		assert.ok(output.includes(BEGIN) && output.endsWith(END));
		assert.ok(output.lastIndexOf("\x1b[6G") < output.lastIndexOf(END));
		assert.ok(output.includes("\x1b[6G"));
		if (style !== "block") assert.ok(output.includes(SHOW) && output.indexOf(SHOW) < output.lastIndexOf(END));
		assert.deepEqual(f.warnings, []);
	});
}
