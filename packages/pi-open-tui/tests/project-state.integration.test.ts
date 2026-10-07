import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.ts";
import openTui from "../src/index.ts";

function fixture(t: TestContext, options: { peek?: boolean; project?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), "open-tui-project-state-"));
	const cwd = join(root, "repo");
	mkdirSync(cwd);
	const path = join(root, "open-tui.json");
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	config.footerSegments.runtime = !!options.project;
	config.footerSegments.gitBranch = !!options.project;
	config.footerSegments.gitStatus = !!options.project;
	config.footerSegments.gitCommit = !!options.project;
	config.thinkingPeek.lines = options.peek ? 1 : 0;
	config.telemetry.enabled = false;
	writeFileSync(path, JSON.stringify(config));
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => unknown>>();
	let command: ((args: string, ctx: ExtensionContext) => Promise<void>) | undefined;
	let footer: (Component & { dispose?: () => void }) | undefined;
	let editorMounted = false;
	let settings: (Component & { handleInput(data: string): void }) | undefined;
	let onBranchChange: (() => void) | undefined;
	let renders = 0;
	const warnings: string[] = [];
	const hidden = {
		children: [] as unknown[], label: "Thinking...",
		setHiddenThinkingLabel(label: string) { this.label = label; },
		setHideThinkingBlock() {}, updateContent() {},
	};
	const tui = {
		mode: "regular", doRender() {}, renderNow() {},
		children: [] as unknown[], terminal: {
			rows: 24, columns: 200, write() {}, start() {}, stop() {}, showCursor() {}, hideCursor() {},
		},
		getShowHardwareCursor: () => false, setShowHardwareCursor() {},
		requestRender() { renders++; },
	};
	const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme;
	const ctx = {
		hasUI: true, mode: "tui", cwd, isIdle: () => false,
		getContextUsage: () => undefined,
		sessionManager: { getCwd: () => cwd, getEntries: () => [], getSessionName: () => undefined },
		ui: {
			theme, notify: (message: string) => warnings.push(message),
			setHiddenThinkingLabel() { hidden.label = "Thinking..."; },
			setFooter(factory?: any) {
				footer?.dispose?.();
				footer = factory?.(tui, theme, {
					onBranchChange(callback: () => void) { onBranchChange = callback; return () => { onBranchChange = undefined; }; },
					getExtensionStatuses: () => new Map(),
				});
			},
			setEditorComponent(factory?: any) {
				editorMounted = !!factory;
				factory?.(tui, { borderColor: (text: string) => text }, { matches: () => false });
			},
			custom(factory: any) {
				return new Promise<void>((resolve) => {
					settings = factory(tui, theme, {}, resolve);
				});
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		on(name: string, handler: (event: any, ctx: ExtensionContext) => unknown) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
		registerCommand(_name: string, options: { handler: typeof command }) { command = options.handler; },
		getThinkingLevel: () => "off",
	} as unknown as ExtensionAPI;
	const emit = async (type: string, payload: object = {}) => {
		for (const handler of handlers.get(type) ?? []) await handler({ type, ...payload }, ctx);
	};
	openTui(pi);
	t.after(async () => {
		await emit("session_shutdown");
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	});
	return {
		cwd, path, ctx, tui, hidden, warnings, emit,
		git: (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(),
		output: () => footer?.render(200).join("\n") ?? "",
		branchChanged: () => onBranchChange?.(),
		editorMounted: () => editorMounted,
		openSettings: () => command!("", ctx),
		settings: () => settings!,
		renders: () => renders,
	};
}

async function waitFor(predicate: () => boolean) {
	for (let attempt = 0; attempt < 200; attempt++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	assert.ok(predicate(), "project state did not refresh within 4s");
}

test("tool completion and full-run settlement refresh Git/runtime; live Git toggles clear and restore counts", async (t) => {
	const f = fixture(t, { project: true });
	f.git("init", "-b", "main");
	await f.emit("session_start");
	await waitFor(() => f.output().includes("main"));
	writeFileSync(join(f.cwd, "app.csproj"), "");
	await f.emit("tool_execution_end");
	await waitFor(() => /\?1/.test(f.output()) && f.output().includes("dotnet"));
	f.git("add", "app.csproj");
	await f.emit("agent_start");
	await f.emit("agent_end", { messages: [] });
	await f.emit("agent_settled");
	await waitFor(() => /A1/.test(f.output()) && !/\?1/.test(f.output()));
	f.git("checkout", "-b", "new-branch");
	f.branchChanged();
	await waitFor(() => f.output().includes("new-branch"));

	const close = f.openSettings();
	f.settings().handleInput("\t");
	f.settings().handleInput("\t");
	for (let i = 0; i < 4; i++) f.settings().handleInput("\x1b[B");
	assert.match(f.settings().render(80).join("\n"), /→ .*Git status/);
	f.settings().handleInput(" ");
	assert.doesNotMatch(f.output(), /A1/);
	f.settings().handleInput(" ");
	await waitFor(() => /A1/.test(f.output()));
	f.settings().handleInput("q");
	await close;

	await f.emit("session_shutdown");
	const stopped = f.renders();
	writeFileSync(join(f.cwd, "late"), "");
	await f.emit("tool_execution_end");
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(f.renders(), stopped, "shutdown ignores late refresh triggers");
});

test("failed settings persistence warns while preview applies, then safely uninstalls after overlay closes", async (t) => {
	const f = fixture(t);
	await f.emit("session_start");
	assert.equal(f.editorMounted(), true);
	rmSync(f.path);
	mkdirSync(f.path);
	const close = f.openSettings();
	f.settings().handleInput("\r");
	assert.equal(f.editorMounted(), true, "overlay closure owns editor removal");
	assert.match(f.warnings.at(-1)!, /session only; save failed/);
	f.settings().handleInput("q");
	await close;
	assert.equal(f.editorMounted(), false);
	assert.equal(f.output(), "");
});

test("incompatible thinking tree warns once, recovers, and session reload cancels old peek cleanup", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	const f = fixture(t, { peek: true });
	await f.emit("session_start");
	const update = async (thinking: string) => f.emit("message_update", {
		message: { role: "assistant", content: [{ type: "thinking", thinking }] },
		assistantMessageEvent: { type: "thinking_delta", delta: thinking },
	});
	await f.emit("agent_start");
	await f.emit("message_start", { message: { role: "assistant" } });
	await update("unavailable");
	await update("still unavailable");
	assert.equal(f.warnings.length, 1);
	assert.match(f.warnings[0]!, /thinking peek unavailable/);
	f.tui.children.push(f.hidden);
	await update("recovered");
	assert.match(f.hidden.label, /recovered/);
	await f.emit("agent_end", { messages: [] });
	await f.emit("agent_settled");
	await f.emit("session_start");
	await f.emit("agent_start");
	await f.emit("message_start", { message: { role: "assistant" } });
	await update("new session");
	t.mock.timers.tick(1_500);
	assert.match(f.hidden.label, /new session/, "an old settlement timeout cannot clear the new session label");
});
