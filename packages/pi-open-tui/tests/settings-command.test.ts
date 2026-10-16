import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type Focusable, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";
import { LEGACY_DEFAULT_CONFIG as DEFAULT_CONFIG, DEFAULT_CONFIG as NEW_DEFAULT_CONFIG, DEFAULT_USER_BORDER, getUserMessageLayout, getToolMessageLayout, loadConfig, saveConfig, type OpenTuiConfig } from "../src/config.ts";
import { installEditor, OpenTuiEditor } from "../src/editor.ts";
import { getPendingUiChange } from "../src/index.ts";
import { registerSettingsCommand } from "../src/settings-command.ts";

interface SettingsComponent extends Component, Focusable {
	handleInput(data: string): void;
}

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as Theme;

async function openSettings(
	initialConfig = structuredClone(DEFAULT_CONFIG),
	onChange?: (config: OpenTuiConfig) => void,
	settingsTheme: Theme = theme,
): Promise<{
	component: SettingsComponent;
	getConfig: () => OpenTuiConfig;
	isClosed: () => boolean;
	isOverlayClosed: () => boolean;
	waitForClose: () => Promise<void>;
}> {
	let commandHandler: ((args: string, ctx: ExtensionContext) => Promise<void> | void) | undefined;
	let component: SettingsComponent | undefined;
	let config = initialConfig;
	let closed = false;
	let overlayClosed = false;

	const pi = {
		registerCommand: (_name: string, options: { handler: typeof commandHandler }) => {
			commandHandler = options.handler;
		},
	} as unknown as ExtensionAPI;

	registerSettingsCommand(pi, {
		getConfig: () => config,
		onConfigChanged: (nextConfig) => {
			config = nextConfig;
			onChange?.(nextConfig);
		},
		onOverlayClosed: () => {
			overlayClosed = true;
		},
	});

	const tui = { requestRender() {} } as TUI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			custom: (
				factory: (
					tui: TUI,
					theme: Theme,
					keybindings: KeybindingsManager,
					done: (value: void) => void,
				) => Component,
			) => new Promise<void>((resolve) => {
				component = factory(tui, settingsTheme, {} as KeybindingsManager, (_value: void) => {
					closed = true;
					resolve();
				}) as SettingsComponent;
			}),
		},
	} as unknown as ExtensionContext;

	assert.ok(commandHandler);
	const closePromise = Promise.resolve(commandHandler("", ctx));
	assert.ok(component);

	return {
		component,
		getConfig: () => config,
		isClosed: () => closed,
		isOverlayClosed: () => overlayClosed,
		waitForClose: () => closePromise,
	};
}

function selectedLine(component: SettingsComponent): string {
	return component.render(80).find((line) => line.includes("→ ")) ?? "";
}

test("previews border styles without reinstalling and localizes their names", async () => {
	for (const language of ["en", "zh"] as const) {
		let mounted: OpenTuiEditor | undefined;
		let installs = 0;
		const editorTui = {
			terminal: { rows: 24 }, requestRender() {},
			getShowHardwareCursor: () => false,
		} as unknown as TUI;
		const handle = installEditor({} as ExtensionAPI, {
			ui: { setEditorComponent: (factory: Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]) => {
				installs++;
				assert.ok(factory);
				mounted = factory(editorTui, {
					borderColor: (s: string) => s,
					selectList: { selectedPrefix: (s: string) => s, selectedText: (s: string) => s,
						description: (s: string) => s, scrollInfo: (s: string) => s, noMatch: (s: string) => s },
				}, {} as Parameters<NonNullable<typeof factory>>[2]) as OpenTuiEditor;
			} },
		} as unknown as ExtensionContext, "block", undefined, "minimal");
		assert.ok(mounted);
		assert.match(mounted.render(40)[0] ?? "", /^─+$/);
		handle.setBorderStyle("surround");
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const settings = await openSettings(config, (next) => {
			handle.setBorderStyle(next.editorBorderStyle);
			assert.match(mounted!.render(40)[0] ?? "", next.editorBorderStyle === "minimal" ? /^─+$/ : /^╭/);
		});
		settings.component.handleInput("\t");
		settings.component.handleInput("\x1b[B");
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /编辑器边框.*环绕/ : /Editor border.*Surround/);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().editorBorderStyle, "minimal");
		assert.match(selectedLine(settings.component), language === "zh" ? /简洁/ : /Minimal/);
		settings.component.handleInput(" ");
		assert.equal(settings.getConfig().editorBorderStyle, "surround");
		assert.equal(installs, 1);
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
});

for (const setting of ["icons", "thinkingPeek"] as const) {
	test(`preserves unknown nested config fields when cycling ${setting} through the panel`, async () => {
		const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-nested-settings-"));
		const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		let settings: Awaited<ReturnType<typeof openSettings>> | undefined;
		try {
			process.env.PI_CODING_AGENT_DIR = agentDir;
			const icons = { mode: "auto", legacyGlyphs: { branch: "custom" }, futureModes: ["custom"] };
			const thinkingPeek = { lines: 1, legacyStyle: { color: "muted" }, futureEnabled: false };
			writeFileSync(join(agentDir, "open-tui.json"), JSON.stringify({ icons, thinkingPeek }), "utf8");
			const config = loadConfig();
			assert.deepEqual(config.icons, icons);
			assert.deepEqual(config.thinkingPeek, thinkingPeek);
			settings = await openSettings(config, saveConfig);

			if (setting === "icons") {
				settings.component.handleInput("\t");
				assert.match(selectedLine(settings.component), /Icon mode/);
			} else {
				settings.component.handleInput("\x1b[B");
				settings.component.handleInput("\x1b[B");
				assert.match(selectedLine(settings.component), /Thinking titles/);
			}

			const values = setting === "icons" ? ["nerd", "unicode", "ascii", "auto"] : [0, 1, 0, 1];
			for (const value of values) {
				settings.component.handleInput("\r");
				const expectedIcons = setting === "icons" ? { ...icons, mode: value } : icons;
				const expectedThinkingPeek = setting === "thinkingPeek" ? { ...thinkingPeek, lines: value } : thinkingPeek;
				assert.deepEqual(settings.getConfig().icons, expectedIcons);
				assert.deepEqual(settings.getConfig().thinkingPeek, expectedThinkingPeek);
				const reloaded = loadConfig();
				assert.deepEqual(reloaded.icons, expectedIcons);
				assert.deepEqual(reloaded.thinkingPeek, expectedThinkingPeek);
				assert.equal(settings.isClosed(), false);
			}
			assert.deepEqual(config.icons, icons);
			assert.deepEqual(config.thinkingPeek, thinkingPeek);
		} finally {
			settings?.component.handleInput("q");
			await settings?.waitForClose();
			if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
			rmSync(agentDir, { recursive: true, force: true });
		}
	});
}

test("persists border styles and defaults legacy config to surround", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-border-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeFileSync(join(agentDir, "open-tui.json"), "{}");
		assert.equal(loadConfig().editorBorderStyle, "surround");
		for (const style of ["minimal", "surround"] as const) {
			const config = structuredClone(DEFAULT_CONFIG);
			config.editorBorderStyle = style;
			saveConfig(config);
			assert.equal(loadConfig().editorBorderStyle, style);
		}
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("closes cleanly after enabling or disabling the UI", async () => {
	for (const enabled of [true, false]) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.enabled = enabled;
		const settings = await openSettings(config);

		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().enabled, !enabled);
		assert.equal(settings.isClosed(), false);
		assert.equal(settings.isOverlayClosed(), false);

		settings.component.handleInput("q");
		assert.equal(settings.isClosed(), true);
		assert.equal(settings.isOverlayClosed(), false);
		await settings.waitForClose();
		assert.equal(settings.isOverlayClosed(), true);
	}
});

test("leaves fullscreen wheel speed to Pi settings", async () => {
	const settings = await openSettings();
	assert.doesNotMatch(settings.component.render(80).join("\n"), /wheel speed/i);
	assert.equal("fullscreen" in settings.getConfig(), false);
});

test("previews cursor styles from the Appearance tab", async () => {
	const writes: string[] = [];
	let editorInstalls = 0;
	let hardwareCursor = false;
	const editorTui = {
		terminal: { rows: 24, write: (data: string) => writes.push(data) },
		requestRender() {},
		getShowHardwareCursor: () => hardwareCursor,
		setShowHardwareCursor: (enabled: boolean) => {
			hardwareCursor = enabled;
		},
	} as unknown as TUI;
	const editor = installEditor({} as ExtensionAPI, {
		ui: {
			setEditorComponent: (factory: unknown) => {
				editorInstalls++;
				if (typeof factory === "function") {
					factory(editorTui, {
						borderColor: (text: string) => text,
						selectList: {},
					}, { matches: () => false });
				}
			},
		},
	} as unknown as ExtensionContext);
	const settings = await openSettings(undefined, (config) => editor.setCursorStyle(config.cursorStyle));

	settings.component.handleInput("\t");
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\r");

	assert.equal(settings.getConfig().cursorStyle, "bar");
	assert.equal(settings.isClosed(), false);
	assert.equal(editorInstalls, 1);
	assert.equal(hardwareCursor, true);
	assert.ok(writes.includes("\x1b[6 q"));

	settings.component.handleInput("\r");
	assert.equal(settings.getConfig().cursorStyle, "underline");
	assert.ok(writes.includes("\x1b[4 q"));

	settings.component.handleInput("\r");
	assert.equal(settings.getConfig().cursorStyle, "block");
	assert.equal(hardwareCursor, false);
	assert.ok(writes.includes("\x1b[0 q"));
	assert.equal(editorInstalls, 1);
	assert.match(selectedLine(settings.component), /Cursor style/);
	assert.match(settings.component.render(80).join("\n"), /\[Appearance\].*Icon mode.*Cursor style/s);

	settings.component.handleInput("q");
	await settings.waitForClose();
	assert.equal(settings.isOverlayClosed(), true);
	editor.cleanup();
});

test("User/Skill and Tool layout controls replace Appearance layout and stay independent", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(NEW_DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const original = structuredClone(config);
		const settings = await openSettings(config);
		settings.component.handleInput("\t");
		assert.doesNotMatch(settings.component.render(100).join("\n"), /Message layout|消息布局/);
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		assert.match(selectedLine(settings.component), language === "zh" ? /启用.*开启/ : /Enabled.*On/);
		assert.match(settings.component.render(100).join("\n"), /Skill/);
		settings.component.handleInput("\r");
		assert.equal(getUserMessageLayout(settings.getConfig()), "normal");
		assert.equal(getToolMessageLayout(settings.getConfig()), "compact");
		assert.equal(settings.getConfig().messageLayout, "compact", "legacy key is not changed");
		assert.deepEqual(settings.getConfig().toolBoxBorder, original.toolBoxBorder);
		settings.component.handleInput("\x1b[Z");
		selectSetting(settings.component, language === "zh" ? /压缩展示/ : /Compression/);
		settings.component.handleInput("\r");
		assert.equal(getToolMessageLayout(settings.getConfig()), "normal");
		assert.equal(getUserMessageLayout(settings.getConfig()), "normal");
		assert.deepEqual(settings.getConfig().userBoxBorder, { ...original.userBoxBorder, enabled: false });
		settings.component.handleInput("q"); await settings.waitForClose();
	}
});

test("Tool controls are enhancement, compression, then optional border style in both languages", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(NEW_DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const observed: OpenTuiConfig[] = [];
		const settings = await openSettings(config, (next) => observed.push(next));
		const offOptions = /Color mode|配色模式|Top border|上边框|Static color|固定颜色/;
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		assert.equal(observed.length, 0, "opening settings does not migrate dormant choices");
		assert.match(selectedLine(settings.component), language === "zh" ? /增强展示.*开启/ : /Enhanced presentation.*On/);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolPresentation, false);
		assert.equal(getToolMessageLayout(settings.getConfig()), "compact");
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolPresentation, true);
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /压缩展示.*开启/ : /Compression.*On/);
		settings.component.handleInput("\r");
		assert.equal(getToolMessageLayout(settings.getConfig()), "normal");
		assert.equal(settings.getConfig().toolPresentation, true);
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /边框样式.*关闭/ : /Border style.*Off/);
		assert.equal(settings.getConfig().toolBoxBorder.style, "double", "hidden default preset is unchanged");
		assert.doesNotMatch(settings.component.render(100).join("\n"), offOptions);
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /增强展示/ : /Enhanced presentation/, "only three Tool rows when style is Off");
		selectSetting(settings.component, language === "zh" ? /边框样式/ : /Border style/);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolBoxBorder.enabled, true);
		assert.match(settings.component.render(100).join("\n"), language === "zh" ? /配色模式/ : /Color mode/);
		for (let i = 0; i < 5; i++) settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolBoxBorder.enabled, false);
		assert.equal(settings.getConfig().toolBoxBorder.style, "custom", "Off retains saved customization");
		assert.doesNotMatch(settings.component.render(100).join("\n"), offOptions);
		assert.equal(getToolMessageLayout(settings.getConfig()), "normal", "style selection does not toggle compression");
		assert.equal(settings.getConfig().toolPresentation, true);
		assert.deepEqual(settings.getConfig().userBoxBorder, config.userBoxBorder);
		assert.equal(getUserMessageLayout(settings.getConfig()), "compact");
		settings.component.handleInput("q"); await settings.waitForClose();
	}
});

test("User/Skill has one enable switch, hides disabled options and preserves legacy choices", async () => {
	for (const language of ["en", "zh"] as const) for (const layout of ["normal", "compact"] as const) for (const framed of [false, true]) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		config.userMessageLayout = layout;
		config.userBoxBorder = { ...structuredClone(DEFAULT_USER_BORDER), enabled: framed, style: "double", right: { enabled: true, char: "#" } };
		const original = structuredClone(config);
		const observed: OpenTuiConfig[] = [];
		const settings = await openSettings(config, (next) => observed.push(next));
		for (let i = 0; i < 5; i++) settings.component.handleInput("\t");
		const enabled = layout === "compact" || framed;
		assert.match(selectedLine(settings.component), enabled
			? (language === "zh" ? /启用.*开启/ : /Enabled.*On/)
			: (language === "zh" ? /启用.*关闭/ : /Enabled.*Off/));
		assert.equal(observed.length, 0);
		assert.deepEqual(settings.getConfig(), original, "legacy interpretation is in memory only");
		if (enabled) settings.component.handleInput("\r");
		assert.equal(getUserMessageLayout(settings.getConfig()), "normal");
		assert.equal(settings.getConfig().userBoxBorder!.enabled, false);
		assert.doesNotMatch(settings.component.render(100).join("\n"), /Border style|边框样式|Color mode|配色模式|Right symbol|右边框符号/);
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /启用/ : /Enabled/, "disabled page has only one setting");
		settings.component.handleInput("\r");
		assert.equal(getUserMessageLayout(settings.getConfig()), "compact");
		assert.equal(settings.getConfig().userBoxBorder!.enabled, true);
		assert.deepEqual(settings.getConfig().userBoxBorder, { ...original.userBoxBorder, enabled: true });
		assert.match(settings.component.render(100).join("\n"), language === "zh" ? /边框样式.*双线/ : /Border style.*Double/);
		assert.deepEqual(settings.getConfig().toolBoxBorder, original.toolBoxBorder);
		assert.equal(getToolMessageLayout(settings.getConfig()), getToolMessageLayout(original));
		settings.component.handleInput("q"); await settings.waitForClose();
	}
});

test("reconciles enabled changes with the installed UI", () => {
	assert.equal(getPendingUiChange(true, false), "install");
	assert.equal(getPendingUiChange(false, true), "uninstall");
	assert.equal(getPendingUiChange(true, true), undefined);
	assert.equal(getPendingUiChange(false, false), undefined);
});

test("keeps the changed setting selected", async () => {
	const settings = await openSettings();

	settings.component.handleInput("\t");
	settings.component.handleInput("\t");
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\x1b[B");
	assert.match(selectedLine(settings.component), /Git branch/);

	settings.component.handleInput("\r");
	assert.equal(settings.getConfig().footerSegments.gitBranch, false);
	assert.match(selectedLine(settings.component), /Git branch/);
});

test("remembers the selection for each tab", async () => {
	const settings = await openSettings();

	settings.component.handleInput("\t");
	settings.component.handleInput("\t");
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\x1b[B");
	// Wrap through all six tabs, preserving the Footer selection.
	for (let i = 0; i < 6; i++) settings.component.handleInput("\t");

	assert.match(selectedLine(settings.component), /Git branch/);
});

test("configures telemetry from its own tab", async () => {
	const settings = await openSettings();

	settings.component.handleInput("\t");
	settings.component.handleInput("\t");
	settings.component.handleInput("\t");
	assert.match(selectedLine(settings.component), /Enabled/);

	settings.component.handleInput("\r");
	assert.equal(settings.getConfig().telemetry.enabled, false);
	settings.component.handleInput("\x1b[B");
	settings.component.handleInput("\r");
	assert.equal(settings.getConfig().telemetry.tps, false);
});

test("supports localized settings and keyboard shortcuts", async () => {
	const settings = await openSettings();
	assert.match(settings.component.render(80).join("\n"), /Open TUI Settings.*General.*Language/s);

	settings.component.handleInput("\x1b[B");
	settings.component.handleInput(" ");
	assert.equal(settings.getConfig().settingsLanguage, "zh");
	assert.match(settings.component.render(80).join("\n"), /Open TUI 设置.*常规.*语言.*简体中文/s);
	assert.match(selectedLine(settings.component), /语言/);

	const reopened = await openSettings(structuredClone(settings.getConfig()));
	assert.match(reopened.component.render(80).join("\n"), /Open TUI 设置.*简体中文/s);

	reopened.component.handleInput("\x1b[B");
	reopened.component.handleInput("\x1b[C");
	assert.match(reopened.component.render(80).join("\n"), /\[外观\].*图标模式.*光标样式/s);
	reopened.component.handleInput("\x1b[D");
	assert.match(selectedLine(reopened.component), /语言/);
	reopened.component.handleInput("q");
	assert.equal(reopened.isClosed(), true);
});

test("configures inline footer from General settings", async () => {
	const settings = await openSettings();
	// Enabled → Language → Thinking peek → Inline footer
	for (let i = 0; i < 3; i++) settings.component.handleInput("\x1b[B");
	assert.match(selectedLine(settings.component), /Inline footer/);
	settings.component.handleInput(" ");
	assert.equal(settings.getConfig().inlineFooter, true);
});

test("configures the hostname footer segment", async () => {
	const settings = await openSettings();
	settings.component.handleInput("\x1b[C");
	settings.component.handleInput("\x1b[C");
	settings.component.handleInput("\x1b[B");
	assert.match(selectedLine(settings.component), /Hostname/);

	settings.component.handleInput(" ");
	assert.equal(settings.getConfig().footerSegments.hostname, true);
	assert.match(selectedLine(settings.component), /Hostname/);
});

test("configures the extension status line with Space", async () => {
	const settings = await openSettings();
	settings.component.handleInput("\x1b[C");
	settings.component.handleInput("\x1b[C");
	for (let i = 0; i < 10; i++) settings.component.handleInput("\x1b[B");
	assert.match(selectedLine(settings.component), /Extension status line/);

	settings.component.handleInput(" ");
	assert.equal(settings.getConfig().footerSegments.extensionStatuses, false);
	assert.match(selectedLine(settings.component), /Extension status line/);
});

test("keeps localized settings and values within narrow widths", async () => {
	const config = structuredClone(DEFAULT_CONFIG);
	config.settingsLanguage = "zh";
	const settings = await openSettings(config);

	for (const width of [24, 36, 48]) {
		const lines = settings.component.render(width);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} > ${width}: ${line}`);
		}
		const output = lines.join("\n");
		assert.match(output, /开启/);
		assert.match(output, /简体中文/);
	}
});

test("normalizes invalid settings values", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeFileSync(join(agentDir, "open-tui.json"), JSON.stringify({
			settingsLanguage: "de",
			cursorStyle: "invalid",
			editorBorderStyle: "invalid",
			inlineFooter: "yes",
			thinkingPeek: { lines: 9 },
			fullscreen: { wheelScrollLines: 10 },
		}), "utf8");
		const loaded = loadConfig();
		assert.equal(loaded.settingsLanguage, "en");
		assert.equal(loaded.cursorStyle, "block");
		assert.equal(loaded.editorBorderStyle, "surround");
		assert.equal(loaded.inlineFooter, false);
		assert.equal(loaded.thinkingPeek.lines, 1);
		assert.equal("fullscreen" in loaded, true);
	} finally {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("thinking titles expose only On/Off, including legacy one/two-line values", async () => {
	for (const legacy of [0, 1, 2] as const) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.thinkingPeek.lines = legacy;
		const settings = await openSettings(config);
		settings.component.handleInput("\x1b[B");
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), /Thinking titles/);
		assert.match(selectedLine(settings.component), legacy ? /On/ : /Off/);
		assert.doesNotMatch(selectedLine(settings.component), /1 line|2 lines/);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().thinkingPeek.lines, legacy ? 0 : 1);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().thinkingPeek.lines, legacy ? 1 : 0);
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
});

test("Workline settings are independent, localized and persist normalized defaults", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const settings = await openSettings(config);
		settings.component.handleInput("\t");
		for (let i = 0; i < 3; i++) settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /Workline 跑马灯.*开启/ : /Workline marquee.*On/);
		settings.component.handleInput("\r");
		assert.deepEqual(settings.getConfig().workline, { marquee: false, attachToBorder: true });
		settings.component.handleInput("\x1b[B");
		assert.match(selectedLine(settings.component), language === "zh" ? /Workline 贴合边框.*开启/ : /Workline attached to border.*On/);
		settings.component.handleInput(" ");
		assert.deepEqual(settings.getConfig().workline, { marquee: false, attachToBorder: false });
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
	const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-workline-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		for (const workline of [undefined, null, [], false, { marquee: "yes", attachToBorder: 1 }]) {
			writeFileSync(join(agentDir, "open-tui.json"), JSON.stringify({ workline }));
			assert.deepEqual(loadConfig().workline, DEFAULT_CONFIG.workline);
		}
		writeFileSync(join(agentDir, "open-tui.json"), JSON.stringify({ workline: { marquee: false } }));
		assert.deepEqual(loadConfig().workline, { marquee: false, attachToBorder: true });
		for (const marquee of [true, false]) for (const attachToBorder of [true, false]) {
			const config = structuredClone(DEFAULT_CONFIG);
			config.workline = { marquee, attachToBorder };
			saveConfig(config);
			assert.deepEqual(loadConfig().workline, config.workline);
		}
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("compact tool presentation is independently toggleable and localized", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const settings = await openSettings(config);
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		assert.match(selectedLine(settings.component), language === "zh" ? /增强展示.*开启/ : /Enhanced presentation.*On/);
		settings.component.handleInput(" ");
		assert.equal(settings.getConfig().toolPresentation, false);
		assert.equal(settings.getConfig().enabled, true);
		assert.deepEqual(settings.getConfig().footerSegments, config.footerSegments);
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
});

test("hides tool compression when enhancement is off and restores saved preferences", async () => {
	for (const language of ["en", "zh"] as const) {
		for (const enhanced of [false, true]) {
			for (const layout of ["normal", "compact"] as const) {
				for (const borderEnabled of [false, true]) {
					const config = structuredClone(DEFAULT_CONFIG);
					config.settingsLanguage = language;
					config.toolPresentation = enhanced;
					config.toolMessageLayout = layout;
					config.toolBoxBorder.enabled = borderEnabled;
					const settings = await openSettings(config);
					for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
					const compression = language === "zh" ? /^ *(?:→ )?压缩展示(?=:|\s*$|\s{2,})/m : /^ *(?:→ )?Compression(?=:|\s*$|\s{2,})/m;
					const borderStyle = language === "zh" ? /边框样式/ : /Border style/;
					let enabled = enhanced;
					for (let i = 0; i < 3; i++) {
						for (const width of [40, 80]) {
							const rendered = settings.component.render(width).join("\n");
							if (enabled) assert.match(rendered, compression);
							else assert.doesNotMatch(rendered, compression);
							assert.match(rendered, borderStyle);
						}
						assert.deepEqual(settings.getConfig(), { ...config, toolPresentation: enabled });
						settings.component.handleInput("\x1b[B");
						assert.match(selectedLine(settings.component), enabled ? compression : borderStyle);
						if (enabled) assert.match(selectedLine(settings.component), layout === "compact" ? /On|开启/ : /Off|关闭/);
						settings.component.handleInput("\x1b[A");
						settings.component.handleInput(" ");
						enabled = !enabled;
					}
					assert.deepEqual(settings.getConfig(), { ...config, toolPresentation: enabled });
					settings.component.handleInput("q");
					await settings.waitForClose();
				}
			}
		}
	}
});

function selectSetting(component: SettingsComponent, label: RegExp): void {
	for (let i = 0; i < 24 && !label.test(selectedLine(component)); i++) component.handleInput("\x1b[B");
	assert.match(selectedLine(component), label);
}

function clearTextInput(component: SettingsComponent): void {
	component.handleInput("\x05"); // Move to the end before clearing the prefilled value.
	component.handleInput("\x15");
}

test("exposes all tool border settings in a localized tab and previews independent changes", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		const original = structuredClone(config);
		const observed: OpenTuiConfig[] = [];
		const settings = await openSettings(config, (next) => observed.push(next));
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		assert.match(settings.component.render(80).join("\n"), language === "zh" ? /\[工具卡片\]/ : /\[Tools\]/);
		selectSetting(settings.component, language === "zh" ? /边框样式/ : /Border style/);
		assert.match(selectedLine(settings.component), language === "zh" ? /边框样式.*关闭/ : /Border style.*Off/);
		assert.doesNotMatch(settings.component.render(80).join("\n"), /Color mode|配色模式|Top symbol|上边框符号/);
		settings.component.handleInput(" ");
		assert.equal(settings.getConfig().toolBoxBorder.enabled, true);
		assert.equal(settings.getConfig().toolBoxBorder.style, "single");
		const styleNames = language === "zh" ? ["粗线", "双线", "虚线", "自定义", "关闭", "单线"] : ["Bold", "Double", "Dashed", "Custom", "Off", "Single"];
		for (const [i, style] of (["bold", "double", "dashed", "custom", "off", "single"] as const).entries()) {
			settings.component.handleInput("\r");
			assert.equal(settings.getConfig().toolBoxBorder.enabled, style !== "off");
			if (style !== "off") assert.equal(settings.getConfig().toolBoxBorder.style, style);
			assert.ok(selectedLine(settings.component).includes(styleNames[i]!));
		}
		settings.component.handleInput("\x1b[B");
		settings.component.handleInput(" ");
		assert.equal(settings.getConfig().toolBoxBorder.colorMode, "static");
		assert.match(selectedLine(settings.component), language === "zh" ? /固定配色/ : /Fixed color/);
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolBoxBorder.colorMode, "status");
		for (const [edge, label] of [
			["top", language === "zh" ? /上边框.*开启/ : /Top border.*On/],
			["bottom", language === "zh" ? /下边框.*开启/ : /Bottom border.*On/],
			["left", language === "zh" ? /左边框.*开启/ : /Left border.*On/],
		] as const) {
			selectSetting(settings.component, label);
			settings.component.handleInput(" ");
			assert.equal(settings.getConfig().toolBoxBorder[edge].enabled, false);
		}
		assert.equal(observed.length, 12);
		assert.deepEqual(config, original, "UI changes must not mutate the previous configuration");
		assert.deepEqual({ ...settings.getConfig(), toolBoxBorder: original.toolBoxBorder }, { ...original, toolMessageLayout: original.messageLayout });
		for (const width of [24, 36, 48, 80]) {
			for (const line of settings.component.render(width)) assert.ok(visibleWidth(line) <= width);
		}
		settings.component.handleInput("\t");
		assert.match(selectedLine(settings.component), language === "zh" ? /启用/ : /Enabled/);
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
});

test("edits and resets border symbols and static color without losing nested fields on save/reload", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-border-settings-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	let settings: Awaited<ReturnType<typeof openSettings>> | undefined;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const border = Object.assign(structuredClone(DEFAULT_CONFIG.toolBoxBorder), {
			color: "muted", legacyStyle: { keep: true },
			enabled: true,
			colorMode: "static",
			top: { enabled: true, char: "-", legacyField: "keep" },
		});
		writeFileSync(join(agentDir, "open-tui.json"), JSON.stringify({ toolBoxBorder: border }));
		const config = loadConfig();
		const original = structuredClone(config);
		settings = await openSettings(config, saveConfig);
		settings.component.focused = true;
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		for (const [label, value, edge] of [
			[/Top symbol/, "#", "top"],
			[/Bottom symbol/, "=", "bottom"],
			[/Left symbol/, "q", "left"],
		] as const) {
			selectSetting(settings.component, label);
			settings.component.handleInput(" ");
			clearTextInput(settings.component);
			settings.component.handleInput(value);
			assert.deepEqual(loadConfig().toolBoxBorder, settings.getConfig().toolBoxBorder, "Typing is not a save");
			assert.equal(settings.isClosed(), false, "q is text inside an input");
			assert.ok(settings.component.render(80).some((line) => line.includes("\x1b_pi:c")));
			settings.component.focused = false;
			assert.ok(settings.component.render(80).every((line) => !line.includes("\x1b_pi:c")));
			settings.component.focused = true;
			for (const width of [24, 36, 48]) {
				for (const line of settings.component.render(width)) assert.ok(visibleWidth(line) <= width);
			}
			settings.component.handleInput("\r");
			assert.equal(settings.getConfig().toolBoxBorder[edge].char, value);
			assert.match(selectedLine(settings.component), label);
			assert.deepEqual(loadConfig().toolBoxBorder, settings.getConfig().toolBoxBorder);
			settings.component.handleInput("\r");
			clearTextInput(settings.component);
			settings.component.handleInput("\r");
			assert.equal(Object.hasOwn(settings.getConfig().toolBoxBorder[edge], "char"), false);
			assert.match(selectedLine(settings.component), /Default/);
			assert.deepEqual(loadConfig().toolBoxBorder, settings.getConfig().toolBoxBorder);
		}
		selectSetting(settings.component, /Static color/);
		settings.component.handleInput("\r");
		clearTextInput(settings.component);
		settings.component.handleInput("accent");
		settings.component.handleInput("\x1b[D");
		settings.component.handleInput("\x1b[C");
		settings.component.handleInput("\r");
		assert.equal(settings.getConfig().toolBoxBorder.color, "accent");
		assert.deepEqual(loadConfig().toolBoxBorder, settings.getConfig().toolBoxBorder);
		settings.component.handleInput("\r");
		clearTextInput(settings.component);
		settings.component.handleInput("\r");
		assert.equal(Object.hasOwn(loadConfig().toolBoxBorder, "color"), false);
		assert.deepEqual((loadConfig().toolBoxBorder as typeof border).legacyStyle, { keep: true });
		assert.equal((loadConfig().toolBoxBorder.top as typeof border.top).legacyField, "keep");
		assert.deepEqual(config, original);
	} finally {
		settings?.component.handleInput("\x1b");
		if (settings && !settings.isClosed()) settings.component.handleInput("\x1b");
		await settings?.waitForClose();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("cancels text edits and rejects unsafe symbols and unknown theme colors", async () => {
	for (const language of ["en", "zh"] as const) {
		const config = structuredClone(DEFAULT_CONFIG);
		config.settingsLanguage = language;
		config.toolBoxBorder.top.char = "#";
		config.toolBoxBorder.enabled = true;
		config.toolBoxBorder.colorMode = "static";
		const observed: OpenTuiConfig[] = [];
		const settings = await openSettings(config, (next) => observed.push(next), {
			...theme,
			fg: (color: string, text: string) => {
				if (color === "notAColor") throw new Error("Unknown theme color");
				return text;
			},
		} as Theme);
		for (let i = 0; i < 4; i++) settings.component.handleInput("\t");
		selectSetting(settings.component, language === "zh" ? /上边框符号/ : /Top symbol/);
		settings.component.handleInput("\r");
		clearTextInput(settings.component);
		settings.component.handleInput("界");
		settings.component.handleInput("\r");
		assert.match(settings.component.render(80).join("\n"), language === "zh" ? /占一个显示列/ : /one visible column/);
		assert.equal(settings.getConfig().toolBoxBorder.top.char, "#");
		assert.equal(observed.length, 0);
		settings.component.handleInput("\x1b");
		assert.match(selectedLine(settings.component), language === "zh" ? /上边框符号/ : /Top symbol/);
		assert.equal(settings.isClosed(), false);
		selectSetting(settings.component, language === "zh" ? /固定颜色/ : /Static color/);
		settings.component.handleInput("\r");
		settings.component.handleInput("notAColor");
		settings.component.handleInput("\r");
		assert.match(settings.component.render(80).join("\n"), language === "zh" ? /未知的主题颜色/ : /Unknown theme color/);
		assert.equal(observed.length, 0);
		settings.component.handleInput("\x1b");
		settings.component.handleInput("q");
		await settings.waitForClose();
	}
});

test("User/Skill border controls, right symbols and legacy explicit saves are independently persisted", async () => {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-open-tui-independent-settings-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	let settings: Awaited<ReturnType<typeof openSettings>> | undefined;
	try {
		process.env.PI_CODING_AGENT_DIR = agentDir;
		const path = join(agentDir, "open-tui.json");
		writeFileSync(path, JSON.stringify({ messageLayout: "compact", toolBoxBorder: { enabled: true, style: "double", colorMode: "status", left: { enabled: false } }, future: { keep: true } }));
		const old = loadConfig();
		settings = await openSettings(old, saveConfig);
		for (let i = 0; i < 5; i++) settings.component.handleInput("\t");
		settings.component.handleInput("\r");
		assert.equal(getUserMessageLayout(loadConfig()), "normal"); assert.equal(getToolMessageLayout(loadConfig()), "compact");
		assert.deepEqual(loadConfig().toolBoxBorder, old.toolBoxBorder);
		selectSetting(settings.component, /Enabled/); settings.component.handleInput("\r");
		assert.equal(loadConfig().userBoxBorder?.enabled, true);
		for (const edge of ["Top border", "Bottom border", "Right border"] as const) {
			selectSetting(settings.component, new RegExp(edge)); settings.component.handleInput("\r");
		}
		assert.equal(loadConfig().userBoxBorder?.right?.enabled, true);
		selectSetting(settings.component, /Right symbol/); settings.component.handleInput("\r"); clearTextInput(settings.component);
		settings.component.handleInput("#"); settings.component.handleInput("\r");
		assert.equal(loadConfig().userBoxBorder?.right?.char, "#");
		selectSetting(settings.component, /Color mode/); settings.component.handleInput("\r");
		selectSetting(settings.component, /Static color/); settings.component.handleInput("\r"); clearTextInput(settings.component);
		settings.component.handleInput("accent"); settings.component.handleInput("\r");
		assert.equal(loadConfig().userBoxBorder?.color, "accent"); assert.equal(loadConfig().userBoxBorder?.colorMode, "static");
		assert.deepEqual(loadConfig().toolBoxBorder, old.toolBoxBorder);
		const user = structuredClone(loadConfig().userBoxBorder);
		settings.component.handleInput("\x1b[Z");
		assert.doesNotMatch(settings.component.render(100).join("\n"), /Static color/, "fixed color is hidden in status mode");
		selectSetting(settings.component, /Right border/); settings.component.handleInput("\r");
		assert.equal(loadConfig().toolMessageLayout, "compact", "explicit Tool edits store independent preferences");
		selectSetting(settings.component, /Right symbol/); settings.component.handleInput("\r"); clearTextInput(settings.component);
		settings.component.handleInput("!"); settings.component.handleInput("\r");
		assert.equal(loadConfig().toolBoxBorder.right?.char, "!");
		assert.deepEqual(loadConfig().userBoxBorder, user); assert.equal(getUserMessageLayout(loadConfig()), "compact");
		for (const width of [24, 40, 80]) assert.ok(settings.component.render(width).every((line) => visibleWidth(line) <= width));
	} finally {
		settings?.component.handleInput("q"); await settings?.waitForClose();
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(agentDir, { recursive: true, force: true });
	}
});
