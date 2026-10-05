import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { TuiMainScreen, type EditorTheme, type Terminal, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { installEditor, OpenTuiEditor } from "../src/editor.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createWorklineRenderer } from "../src/workline.ts";
import { stripAnsi } from "../src/utils.ts";

const tui = {
	terminal: { rows: 24 },
	requestRender() {},
} as TUI;

const editorTheme = {
	borderColor: (text: string) => text,
	selectList: {
		selectedPrefix: (text: string) => text,
		selectedText: (text: string) => text,
		description: (text: string) => text,
		scrollInfo: (text: string) => text,
		noMatch: (text: string) => text,
	},
} as EditorTheme;

test("minimal borders preserve inset, content and live switching", () => {
	const editor = new OpenTuiEditor(tui, editorTheme, { matches: () => false } as unknown as KeybindingsManager);
	editor.setText("abcdef");
	const surround = editor.render(40).map(stripAnsi);
	editor.setBorderStyle("minimal");
	const minimal = editor.render(40).map(stripAnsi);
	assert.equal(minimal[0], "─".repeat(40));
	assert.equal(minimal.at(-1), "─".repeat(40));
	assert.equal(minimal[1]?.indexOf("abcdef"), 2);
	assert.equal(minimal[1]?.slice(2, -2), surround[1]?.slice(2, -2));
	assert.ok(minimal.every((line) => !/[│╭╮╰╯]/.test(line)));
	editor.handleMouse({
		type: "click", button: "left", x: 3, y: 1, screenX: 3, screenY: 1,
		width: 40, height: 8, shift: false, alt: false, ctrl: false,
	});
	assert.equal(editor.getCursor().col, 1);
	editor.setBorderStyle("surround");
	assert.equal(stripAnsi(editor.render(40)[0] ?? ""), surround[0]);
});

test("minimal borders retain colored status, inline footer and bounded widths", () => {
	for (const inline of [false, true]) {
		const editor = new OpenTuiEditor(tui, editorTheme, { matches: () => false } as unknown as KeybindingsManager,
			"block", {
				enabled: () => inline,
				render: () => ({ top: { left: "cwd", right: "context" }, bottom: { left: "model", right: "stats" } }),
			}, "minimal");
		editor.setText("x");
		editor.setWorkingStatusIndicator({
			renderInBorder: () => "\x1b[32mworking\x1b[0m",
			renderSpinnerInBorder: () => "◐",
		});
		const lines = editor.render(80);
		assert.match(lines[0] ?? "", /\x1b\[32mworking\x1b\[0m/);
		if (inline) {
			assert.match(stripAnsi(lines[0] ?? ""), /cwd.*context/);
			assert.match(stripAnsi(lines.at(-1) ?? ""), /model.*stats/);
		}
		for (const width of [1, 2, 3, 4, 5, 10, 20, 80]) {
			for (const line of editor.render(width)) {
				// Pi itself emits a two-column cursor cell at width 1; preserve that fallback.
				assert.ok(visibleWidth(line) <= Math.max(2, width));
				assert.doesNotMatch(stripAnsi(line), /[│╭╮╰╯]/);
			}
		}
	}
});

test("compensates Pi editor padding for the custom left rail", () => {
	const editor = new OpenTuiEditor(
		tui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	editor.setText("x");

	// Pi copies editorPaddingX after constructing a custom editor.
	editor.setPaddingX(2);
	const contentLine = stripAnsi(editor.render(40)[1] ?? "");

	assert.equal(contentLine.indexOf("x"), 2);
});

test("maps framed editor clicks to the Pi editor coordinate space", () => {
	const editor = new OpenTuiEditor(
		tui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	editor.setText("abcdef");
	editor.render(40);

	const click = (x: number): void => {
		editor.handleMouse({
			type: "click",
			button: "left",
			x,
			y: 1,
			screenX: x,
			screenY: 1,
			width: 40,
			height: 8,
			shift: false,
			alt: false,
			ctrl: false,
		});
	};

	click(2);
	assert.equal(editor.getCursor().col, 0);
	click(3);
	assert.equal(editor.getCursor().col, 1);
	click(39);
	assert.equal(editor.getCursor().col, 6);
});

test("leaves narrow unframed editor mouse coordinates unchanged", () => {
	const editor = new OpenTuiEditor(
		tui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	editor.setText("abc");
	editor.render(3);

	editor.handleMouse({
		type: "click",
		button: "left",
		x: 0,
		y: 1,
		screenX: 0,
		screenY: 1,
		width: 3,
		height: 8,
		shift: false,
		alt: false,
		ctrl: false,
	});

	assert.equal(editor.getCursor().col, 0);
});
test("embeds the working indicator in the editor top border", () => {
	const editor = new OpenTuiEditor(
		tui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	editor.setWorkingStatusIndicator({
		renderInBorder: () => "◐ working",
		renderSpinnerInBorder: () => "◐",
	});

	assert.match(stripAnsi(editor.render(40)[0] ?? ""), /^╭── ◐ working ─+╮$/);
});

test("renders inline footer lines in the editor frame", () => {
	const editor = new OpenTuiEditor(
		tui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
		"block",
		{
			enabled: () => true,
			render: (width) => ({
				top: { left: "cwd", right: "context" },
				bottom: { left: "model", right: "stats" },
			}),
		},
	);

	const lines = editor.render(40).map(stripAnsi);
	assert.match(lines[0] ?? "", /^╭─ cwd ─+ context ─╮$/);
	assert.match(lines.at(-1) ?? "", /^╰─ model ─+ stats ─╯$/);
	assert.equal(visibleWidth(lines[0] ?? ""), 40);
	assert.equal(visibleWidth(lines.at(-1) ?? ""), 40);
});

test("keeps a narrow scrolled working border intact", () => {
	for (const style of ["surround", "minimal"] as const) {
		const editor = new OpenTuiEditor(
			tui,
			editorTheme,
			{ matches: () => false } as unknown as KeybindingsManager,
		);
		editor.setBorderStyle(style);
		editor.setText(Array.from({ length: 10 }, (_, index) => `line ${index}`).join("\n"));
		let spinnerRenders = 0;
		editor.setWorkingStatusIndicator({
			renderInBorder: () => "◐ working status that ignores width",
			renderSpinnerInBorder: () => {
				spinnerRenders++;
				return "◐";
			},
		});

		const topBorder = stripAnsi(editor.render(30)[0] ?? "");

		assert.equal(spinnerRenders, 1);
		assert.equal(visibleWidth(topBorder), 30);
		assert.match(topBorder, /↑ 3 more/);
		assert.ok(topBorder.endsWith(style === "minimal" ? "─" : "╮"));
	}
});


test("uses the terminal hardware cursor for non-block styles", () => {
	for (const [cursorStyle, sequence] of [
		["bar", "\x1b[6 q"],
		["underline", "\x1b[4 q"],
	] as const) {
		const writes: string[] = [];
		let hardwareCursor: boolean | undefined;
		const hardwareTui = {
			...tui,
			terminal: {
				rows: 24,
				write: (data: string) => writes.push(data),
			},
			getShowHardwareCursor: () => hardwareCursor === true,
			setShowHardwareCursor: (enabled: boolean) => {
				hardwareCursor = enabled;
			},
		} as unknown as TUI;
		const editor = new OpenTuiEditor(
			hardwareTui,
			editorTheme,
			{ matches: () => false } as unknown as KeybindingsManager,
			cursorStyle,
		);

		const lines = editor.render(40);

		assert.equal(hardwareCursor, true);
		assert.ok(writes.includes(sequence), `${cursorStyle} cursor sequence was sent`);
		assert.ok(lines.every((line) => !line.includes("\x1b[7m")), "software block cursor was removed");
	}
});

test("shows a hardware cursor while previewing a non-block style under an overlay", () => {
	const cursorEvents: string[] = [];
	const terminal = {
		columns: 80,
		rows: 24,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		write() {},
		hideCursor: () => cursorEvents.push("hide"),
		showCursor: () => cursorEvents.push("show"),
	} as unknown as Terminal;
	const overlayTui = new TuiMainScreen(terminal, false);
	const editor = new OpenTuiEditor(
		overlayTui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	overlayTui.addChild(editor);
	overlayTui.setFocus(editor);
	overlayTui.showOverlay({ render: () => ["settings"], invalidate() {} });
	cursorEvents.length = 0;

	editor.setCursorStyle("bar");
	(overlayTui as unknown as { doRender(): void }).doRender();

	assert.equal(cursorEvents.at(-1), "show");

	overlayTui.hideOverlay();
	(overlayTui as unknown as { doRender(): void }).doRender();
	overlayTui.showOverlay({ render: () => ["other overlay"], invalidate() {} });
	cursorEvents.length = 0;
	(overlayTui as unknown as { doRender(): void }).doRender();
	assert.equal(cursorEvents.at(-1), "hide");
	overlayTui.stop();
});

test("preserves block hardware cursor settings", () => {
	let changes = 0;
	const hardwareTui = {
		...tui,
		getShowHardwareCursor: () => true,
		setShowHardwareCursor: () => changes++,
	} as unknown as TUI;

	new OpenTuiEditor(
		hardwareTui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
		"block",
	);

	assert.equal(changes, 0);
});

test("does not override Pi's native fullscreen wheel setting", () => {
	let wheelSettingChanges = 0;
	const fullscreenTui = {
		...tui,
		mode: "fullscreen",
		terminal: { rows: 24, write() {} },
		getShowHardwareCursor: () => false,
		setShowHardwareCursor() {},
		setWheelScrollLines: () => wheelSettingChanges++,
	} as unknown as TUI;
	const ctx = {
		ui: {
			setEditorComponent: (factory: unknown) => {
				if (typeof factory === "function") {
					factory(fullscreenTui, editorTheme, { matches: () => false });
				}
			},
		},
	} as unknown as ExtensionContext;

	const editor = installEditor({} as ExtensionAPI, ctx);
	assert.equal(wheelSettingChanges, 0);
	editor.cleanup();
	assert.equal(wheelSettingChanges, 0);
});

test("restores cursor shape and visibility when the editor is removed", () => {
	const writes: string[] = [];
	const visibility: boolean[] = [];
	const hardwareTui = {
		...tui,
		terminal: {
			rows: 24,
			write: (data: string) => writes.push(data),
		},
		getShowHardwareCursor: () => false,
		setShowHardwareCursor: (enabled: boolean) => visibility.push(enabled),
	} as unknown as TUI;
	const ctx = {
		ui: {
			setEditorComponent: (factory: unknown) => {
				if (typeof factory === "function") {
					factory(hardwareTui, editorTheme, { matches: () => false });
				}
			},
		},
	} as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;

	const editor = installEditor({} as import("@earendil-works/pi-coding-agent").ExtensionAPI, ctx, "bar");
	editor.cleanup();

	assert.ok(writes.includes("\x1b[0 q"), "cursor shape was reset");
	assert.deepEqual(visibility, [true, false]);
});

test("frame recolors via borderColor (bash mode / thinking level hook)", () => {
	const painted: string[] = [];
	const theme = {
		...editorTheme,
		borderColor: (text: string) => {
			painted.push(text);
			return text;
		},
	} as EditorTheme;
	const editor = new OpenTuiEditor(
		tui,
		theme,
		{ matches: () => false } as unknown as KeybindingsManager,
	);
	editor.setText("hi");
	editor.setWorkingStatusIndicator({
		renderInBorder: () => "◐ working",
		renderSpinnerInBorder: () => "◐",
	});

	const lines = editor.render(40);
	const top = stripAnsi(lines[0] ?? "");
	const body = stripAnsi(lines[1] ?? "");

	// Frame shape stays intact and working corners route through borderColor.
	assert.ok(top.startsWith("╭") && top.endsWith("╮"), `top border shape: ${top!}`);
	assert.ok(body.startsWith("│") && body.endsWith("│"), `body rails: ${body!}`);
	assert.ok(painted.some((text) => text.startsWith("╭")), "left top corner bypassed borderColor");
	assert.ok(painted.some((text) => text.endsWith("╮")), "right top corner bypassed borderColor");
});

test("keeps a hardware cursor after Pi re-applies its runtime settings", () => {
	const cursorEvents: string[] = [];
	const terminal = {
		columns: 80,
		rows: 24,
		kittyProtocolActive: false,
		start() {},
		stop() {},
		write() {},
		hideCursor: () => cursorEvents.push("hide"),
		showCursor: () => cursorEvents.push("show"),
	} as unknown as Terminal;
	const hostTui = new TuiMainScreen(terminal, false);
	const editor = new OpenTuiEditor(
		hostTui,
		editorTheme,
		{ matches: () => false } as unknown as KeybindingsManager,
		"bar",
	);
	hostTui.addChild(editor);
	hostTui.setFocus(editor);

	// Pi re-applies settings.showHardwareCursor after session_start on /reload,
	// which would leave no cursor at all: the software cursor is stripped for
	// non-block styles.
	hostTui.setShowHardwareCursor(false);
	cursorEvents.length = 0;
	(hostTui as unknown as { doRender(): void }).doRender();
	assert.equal(cursorEvents.at(-1), "show");

	assert.ok(
		editor.render(40).every((line) => !line.includes("\x1b[7m")),
		"software cursor stays stripped",
	);
	hostTui.stop();
});

const worklineTheme = {
	fg: (color: string, text: string) => `\x1b[${color === "accent" ? 36 : color === "success" ? 32 : 90}m${text}\x1b[0m`,
} as Theme;

function worklineFixture(inlineFooter = false, borderStyle: "minimal" | "surround" = "surround") {
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	config.inlineFooter = inlineFooter;
	const state: { workingSince: number | undefined; lastDoneIn: number | undefined } = { workingSince: undefined, lastDoneIn: undefined };
	let now = 2_000;
	const renderer = createWorklineRenderer(() => state, () => config, () => worklineTheme, () => now);
	const editor = new OpenTuiEditor(tui, editorTheme, { matches: () => false } as unknown as KeybindingsManager,
		"block", {
			enabled: () => config.inlineFooter,
			render: () => ({ top: { left: "main", right: "cwd" }, bottom: { left: "model", right: "stats" } }),
		}, borderStyle, renderer);
	editor.setText("abcdef\nghijkl");
	return { config, state, renderer, editor, setNow: (value: number) => { now = value; } };
}

test("one Workline merges native work/time and persists done in both placements/footer modes", () => {
	for (const inline of [false, true]) for (const borderStyle of ["surround", "minimal"] as const) {
		const { config, state, editor, setNow } = worklineFixture(inline, borderStyle);
		const idle = editor.render(100).map(stripAnsi);
		state.workingSince = 0;
		editor.setWorkingStatusIndicator({ kind: "working", renderInBorder: () => "o Custom work", renderSpinnerInBorder: () => "o" });
		for (const attached of [true, false]) {
			config.workline.attachToBorder = attached;
			const lines = editor.render(100).map(stripAnsi);
			assert.equal(lines.length, idle.length + (attached ? 0 : 3));
			assert.match(lines[attached ? 0 : 1]!, /Custom work 2s/);
			assert.equal(lines.filter((line) => line.includes("Custom work")).length, 1);
			if (!attached) {
				assert.equal(lines[0], "");
				assert.equal(lines[2], "");
				assert.deepEqual(lines.slice(3), idle);
			} else {
				assert.deepEqual(lines.slice(1), idle.slice(1));
			}
			if (inline) assert.match(lines[attached ? 0 : 3]!, /main.*cwd/);
		}
		state.workingSince = undefined;
		state.lastDoneIn = 2_000;
		editor.setWorkingStatusIndicator(undefined);
		const done = editor.render(100).map(stripAnsi);
		assert.match(done[1]!, /done 2s/);
		assert.equal(done.filter((line) => line.includes("done")).length, 1);
		setNow(10_000);
		assert.deepEqual(editor.render(100).map(stripAnsi), done);
		state.workingSince = 10_000;
		state.lastDoneIn = undefined;
		assert.doesNotMatch(editor.render(100).join("\n"), /done/);
		assert.match(stripAnsi(editor.render(100)[1]!), /working 0s/);
		state.workingSince = undefined;
		assert.deepEqual(editor.render(100).map(stripAnsi), idle);
	}
});

test("Workline sweep changes highlight, not text; off still updates elapsed time", () => {
	const { config, state, renderer, setNow } = worklineFixture();
	state.workingSince = 0;
	const native = { renderInBorder: () => "o 工作 é 👩‍💻 custom work", renderSpinnerInBorder: () => "o" };
	const first = renderer.render(80, native);
	setNow(2_250);
	const second = renderer.render(80, native);
	assert.equal(stripAnsi(first), stripAnsi(second));
	assert.notEqual(first, second);
	config.workline.marquee = false;
	const staticFirst = renderer.render(80, native);
	setNow(2_500);
	assert.equal(renderer.render(80, native), staticFirst);
	setNow(4_000);
	assert.match(stripAnsi(renderer.render(80, native)), /4s$/);
	assert.doesNotMatch(renderer.render(80, native), /\x1b\[90m/);
	for (const attached of [true, false]) {
		config.workline.attachToBorder = attached;
		assert.equal(renderer.attached(), attached);
		assert.equal(config.workline.marquee, false);
	}
});

test("Workline keeps special native statuses and bounds ANSI/CJK at narrow widths", () => {
	const { config, state, renderer, editor } = worklineFixture(true);
	state.workingSince = 0;
	const retry = { kind: "retry", renderInBorder: () => "\x1b[33mRetrying in 2s\x1b[0m", renderSpinnerInBorder: () => "R" };
	assert.equal(renderer.render(80, retry), retry.renderInBorder());
	assert.equal(renderer.render(2, retry, true), "R");
	state.workingSince = undefined;
	state.lastDoneIn = 2_000;
	assert.equal(renderer.render(80, retry), retry.renderInBorder());
	state.workingSince = 0;
	state.lastDoneIn = undefined;
	editor.setWorkingStatusIndicator({ kind: "working", renderInBorder: () => "o 工作 👩‍💻 é", renderSpinnerInBorder: () => "o" });
	for (const attached of [true, false]) for (const marquee of [true, false]) {
		config.workline = { attachToBorder: attached, marquee };
		for (const width of [0, 1, 2, 3, 4, 5, 8, 10, 20, 40, 80]) {
			assert.ok(visibleWidth(renderer.render(width)) <= width);
			for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= Math.max(2, width), `${width}: ${line}`);
		}
	}
});

test("detached Workline compensates mouse rows and ignores its own row", () => {
	const { config, state, editor } = worklineFixture();
	config.workline.attachToBorder = false;
	state.workingSince = 0;
	editor.render(40);
	const click = (y: number) => editor.handleMouse({
		type: "click", button: "left", x: 4, y, screenX: 4, screenY: y,
		width: 40, height: 8, shift: false, alt: false, ctrl: false,
	});
	click(5);
	assert.deepEqual(editor.getCursor(), { line: 1, col: 2 });
	const before = editor.getCursor();
	for (const row of [0, 1, 2]) {
		assert.deepEqual(click(row), { handled: true });
		assert.deepEqual(editor.getCursor(), before);
	}
	config.workline.attachToBorder = true;
	editor.render(40);
	click(1);
	assert.deepEqual(editor.getCursor(), { line: 0, col: 2 });
});

test("detached telemetry shares done row, obeys live config/theme and stays width bounded", () => {
	const { config, state } = worklineFixture();
	state.lastDoneIn = 2_000;
	const telemetry = {
		tps: 12.5, ttftMs: 100, totalMs: 2_000, inputTokens: 50, outputTokens: 25,
		cacheReadTokens: 0, stallMs: 0, stallCount: 0, rateUsdPerMTokens: 4,
		generationMs: 2_000, totalTokens: 75, costUsd: 0.0003, measurementMs: 2_000,
	};
	let currentTheme = worklineTheme;
	const renderer = createWorklineRenderer(() => state, () => config, () => currentTheme, () => 2_000, () => telemetry);
	const attached = renderer.render(200);
	assert.equal(stripAnsi(attached), "+ done 2s");
	config.workline.attachToBorder = false;
	assert.match(stripAnsi(renderer.render(200)), /done 2s \| .*TPS 12.5 tok\/s.*TTFT/);
	for (const width of [0, 1, 2, 3, 4, 8, 20, 40, 80, 200]) assert.ok(visibleWidth(renderer.render(width)) <= width);
	currentTheme = { fg: (_color: string, text: string) => text } as Theme;
	assert.doesNotMatch(renderer.render(200), /\x1b/);
	config.telemetry.enabled = false;
	assert.equal(stripAnsi(renderer.render(200)), "+ done 2s");
	config.telemetry = { enabled: true, tps: false, ttft: false, duration: false, tokens: false, stalls: false, cost: false };
	assert.equal(stripAnsi(renderer.render(200)), "+ done 2s");
	config.workline.attachToBorder = true;
	assert.equal(stripAnsi(renderer.render(200)), stripAnsi(attached));
	state.workingSince = 2_000;
	assert.doesNotMatch(stripAnsi(renderer.render(200)), /TPS|done/);
	state.workingSince = undefined;
	state.lastDoneIn = undefined;
	assert.equal(renderer.render(200), "");
});
