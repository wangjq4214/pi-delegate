import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
	createBashToolDefinition, createReadToolDefinition, createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition, createFindToolDefinition, createLsToolDefinition, createCodemodeExtension,
	DefaultResourceLoader, ExtensionRunner, SessionManager, SettingsManager, getPackageDir, initTheme, VERSION,
	type ExtensionAPI, type ExtensionContext, type ExtensionToolContext, type ModelRegistry, type ToolInfo, type ToolRenderers, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Component, Container, Markdown, Spacer, ScrollView, VStack, Text, TuiMainScreen, TuiAltScreen, sliceByColumn, stripTerminalSequences, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { LEGACY_DEFAULT_CONFIG as DEFAULT_CONFIG, DEFAULT_CONFIG as NEW_DEFAULT_CONFIG, DEFAULT_USER_BORDER } from "../src/config.ts";
import { codemodeCalls, selectChildren, ToolPresentation } from "../src/tool-presentation.ts";
import { toolPolicy, compactContent, defaultOutputLines, renderCallSummary, renderChildActivity, withoutResultNotices, expansionHint } from "../src/tool-presentation-policy.ts";
import openTui from "../src/index.ts";
import { createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { installUserMessageLayout } from "../src/user-message-layout.ts";
import { MessageRail, ToolBoxFrame, resolveBorderGlyphs, borderFrameOptions } from "../src/message-layout.ts";
import { UiRefresh } from "../src/ui-refresh.ts";
import { PeekController } from "../src/peek-controller.ts";
import { SessionLifecycle } from "../src/session-lifecycle.ts";
import { ThinkingLabelTarget } from "../src/thinking-label.ts";
import { createWorklineRenderer } from "../src/workline.ts";

// Actual upgraded host registration, resolver chain and ToolExecutionComponent, with controlled
// results and an in-memory terminal. No provider, real terminal/font or IME visual claims.
const { ToolExecutionComponent } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/tool-execution.js")).href);
const hostTheme = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/theme/theme.js")).href);
const { UserMessageComponent } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/user-message.js")).href);
const { SkillInvocationMessageComponent } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/skill-invocation-message.js")).href);
const { AssistantMessageComponent } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/components/assistant-message.js")).href);
initTheme("dark");

async function fixture(t: test.TestContext, mode: "regular" | "fullscreen" = "regular") {
	assert.equal(VERSION, "1.1.0");
	const cwd = await mkdtemp(join(tmpdir(), "open-tui-presentation-"));
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	let presentation!: ToolPresentation;
	let api!: ExtensionAPI;
	let now = 100;
	const refresh = new UiRefresh(() => now);
	const read = createReadToolDefinition(cwd);
	const bash = createBashToolDefinition(cwd);
	const edit = createEditToolDefinition(cwd);
	const write = createWriteToolDefinition(cwd);
	const grep = createGrepToolDefinition(cwd);
	const find = createFindToolDefinition(cwd);
	const ls = createLsToolDefinition(cwd);
	let codemode!: ToolDefinition;
	const specialized = { renderCall: () => new Text("SPECIAL CALL", 0, 0), renderResult: () => new Text("SPECIAL RESULT AND CONTROLS", 0, 0) };
	const loader = new DefaultResourceLoader({
		cwd, agentDir: cwd, settingsManager: SettingsManager.inMemory(), noExtensions: true, noSkills: true,
		noPromptTemplates: true, noThemes: true, noContextFiles: true,
		extensionFactories: [
			(pi) => { api = pi; presentation = new ToolPresentation(() => config, pi, () => now, refresh); },
			(pi) => { pi.registerToolRenderer((name, next) => name === "special" ? specialized : next()); },
			(pi) => { createCodemodeExtension()({ ...pi, registerTool(tool: ToolDefinition) { codemode = tool; pi.registerTool(tool); } } as unknown as ExtensionAPI); },
		],
	});
	await loader.reload();
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	// Only resolve renderers: model registry is unused by this boundary.
	const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), {} as ModelRegistry);
	// The real API binds tool discovery during session startup. Supply the real native schema for shell recognition.
	loaded.runtime.getAllTools = () => [read, bash, edit, write, grep, find, ls, codemode] as unknown as ToolInfo[];
	let writes = "";
	const terminal: Terminal = {
		columns: 100, rows: 40, kittyProtocolActive: false,
		start() {}, stop() {}, async drainInput() {}, write(data) { writes += data; }, moveBy() {},
		showCursor() {}, hideCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {},
		setTitle() {}, setProgress() {}, setProgramStatus() {},
	};
	const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
	presentation.startSession(true);
	t.after(async () => { presentation.shutdown(); refresh.reset(); tui.stop(); await rm(cwd, { recursive: true, force: true }); });
	const component = (name: string, id: string, args: unknown, base: ToolRenderers | undefined = runner.getToolDefinition(name) ?? ({ read, bash, edit, write, grep, find, ls, codemode } as Record<string, ToolRenderers>)[name]) => {
		const renderers = runner.resolveToolRenderers(name, () => base);
		return new ToolExecutionComponent(name, id, args, { outputPad: 0 }, renderers, tui, cwd);
	};
	return { cwd, refresh, now: () => now, config, presentation, component, runner, api, read, codemode, tui, terminal, writes: () => writes, advance(ms: number) { now += ms; } };
}
function result(text: string, details: unknown = undefined, isError = false, durationMs?: number) {
	return { content: [{ type: "text" as const, text }], details, isError, durationMs };
}
function frame(component: InstanceType<typeof ToolExecutionComponent>, width = 100): string {
	const lines = component.render(width);
	assert.ok(lines.every((line: string) => visibleWidth(line) <= width), `overflow at ${width}`);
	return stripTerminalSequences(lines.join("\n"));
}

// Interpret SGR state instead of stripping it: text/width snapshots cannot detect background holes.
function styledRuns(line: string): Array<{ text: string; bg: string; fg: string; bold: boolean; dim: boolean }> {
	const runs: Array<{ text: string; bg: string; fg: string; bold: boolean; dim: boolean }> = [];
	let bg = "default", fg = "default", bold = false, dim = false;
	for (const match of line.matchAll(/\x1b\[([\d;]*)m|([^\x1b]+)/g)) {
		if (match[2] !== undefined) {
			runs.push({ text: match[2], bg, fg, bold, dim });
			continue;
		}
		const codes = match[1]!.split(";").map(Number);
		for (let i = 0; i < codes.length; i++) {
			const code = codes[i]!;
			if (code === 38 || code === 48) {
				const count = codes[i + 1] === 2 ? 4 : 2;
				if (code === 48) bg = codes.slice(i, i + count + 1).join(";");
				else fg = codes.slice(i, i + count + 1).join(";");
				i += count; // RGB/palette values are not independent SGR attributes.
			} else if (code === 0) { bg = "default"; fg = "default"; bold = false; dim = false; }
			else if (code === 49) bg = "default";
			else if (code === 39) fg = "default";
			else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) bg = String(code);
			else if (code === 1) bold = true;
			else if (code === 2) dim = true;
			else if (code === 22) { bold = false; dim = false; }
		}
	}
	return runs;
}

test("normal framing matches the native default/self shell across padding, themes and result states", async (t) => {
	const f = await fixture(t);
	f.config.toolPresentation = false;
	t.after(() => initTheme("dark"));
	for (const theme of ["dark", "light"] as const) for (const renderShell of ["default", "self"] as const) {
		initTheme(theme);
		const base: ToolRenderers = {
			renderShell,
			renderCall: (_args, theme) => new Text(theme.fg("toolTitle", "CALL\n\n  indented call"), 0, 0),
			renderResult: (_result, _options, theme) => new Text(theme.fg("toolOutput", "RESULT\n\n  indented result"), 0, 0),
		};
		for (const outputPad of [0, 2]) {
			const adapted = f.component("custom", "same", {}, base);
			const native = new ToolExecutionComponent("custom", "same", {}, { outputPad }, base, f.tui, f.cwd);
			adapted.setOutputPad(outputPad);
			for (const state of ["pending", "partial", "ok", "error"] as const) {
				if (state !== "pending") {
					const value = result("result", undefined, state === "error");
					adapted.updateResult(value, state === "partial"); native.updateResult(value, state === "partial");
				}
				for (const width of [12, 80]) assert.deepEqual(adapted.render(width), native.render(width),
					`${theme}/${renderShell}/${outputPad}/${state}/${width}: native bytes and whitespace`);
			}
		}
	}
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: truncated summaries preserve the host background through ellipsis, duration and padding`, async (t) => {
		const f = await fixture(t, mode);
		t.after(() => initTheme("dark"));
		for (const theme of ["dark", "light"] as const) {
			initTheme(theme);
			for (const status of ["pending", "running", "ok", "error"] as const) {
				for (const generic of [false, true]) {
					const name = generic ? "unfamiliar" : "read";
					const id = `${theme}-${status}-${name}`;
					const path = "中文/é👩‍💻/" + "long-path/".repeat(20);
					const card = f.component(name, id, { path });
					if (status === "running") {
						f.presentation.start(id); f.advance(275); card.markExecutionStarted();
					} else if (status === "ok" || status === "error") {
						card.updateResult(result("long-result ".repeat(30), undefined, status === "error", status === "ok" ? 275 : 2500));
					}
					for (const width of [12, 22, 40, 60, 1000]) {
						card.invalidate();
						const lines: string[] = card.render(width);
						assert.ok(lines.every((line) => visibleWidth(line) <= width));
						const expectedBg = styledRuns(lines[1]!)[0]!.bg; // Host's top padding uses the current status/theme.
						assert.notEqual(expectedBg, "default");
						for (const line of lines.slice(1)) {
							assert.ok(styledRuns(line).every((run) => run.bg === expectedBg),
								`${theme}/${status}/${name}/${width}: background changed within ${JSON.stringify(stripTerminalSequences(line))}`);
						}
						const header = lines[2]!;
						if (width === 1000) assert.doesNotMatch(stripTerminalSequences(header), /\.\.\./, "wide control avoids truncation");
						if (width === 60) {
							assert.match(stripTerminalSequences(header), /\.\.\./, "exercise actual truncation");
							const ellipsis = styledRuns(header).find((run) => run.text.includes("..."))!;
							assert.equal(ellipsis.bold, false, "truncated bold target does not bleed into ellipsis");
							if (status !== "pending") {
								const time = status === "error" ? "2.5s" : "275ms";
								const suffix = styledRuns(header).find((run) => run.text.includes(time))!;
								assert.ok(suffix, "measured duration survives truncation");
								assert.equal(suffix.bold, false);
								const expected = styledRuns(hostTheme.theme.fg("dim", time))[0]!;
								assert.equal(suffix.fg, expected.fg, "duration keeps the theme's dim foreground");
								assert.equal(suffix.dim, expected.dim);
							}
						}
					}
					f.presentation.end(id);
				}
			}
		}
	});
	test(`${mode}: truncated codemode hints, child rows and output keep the parent background`, async (t) => {
		const f = await fixture(t, mode);
		t.after(() => initTheme("dark"));
		for (const theme of ["dark", "light"] as const) {
			initTheme(theme);
			const card = f.component("codemode", "background", { code: "return 'parent';" });
			for (const stage of ["pending", "running", "ok"] as const) {
				if (stage !== "pending") card.updateResult(result("parent-output ".repeat(30), {
					calls: [{ id: "background/0", name: "unfamiliar", args: "long-child-args ".repeat(30), status: stage, durationMs: 275 }],
				}), stage === "running");
				for (const width of [12, 22, 60, 400]) {
					card.invalidate();
					const lines: string[] = card.render(width);
					const expectedBg = styledRuns(lines[1]!)[0]!.bg;
					assert.notEqual(expectedBg, "default");
					assert.ok(lines.every((line) => visibleWidth(line) <= width));
					assert.ok(lines.slice(1).every((line) => styledRuns(line).every((run) => run.bg === expectedBg)),
						`${theme}/${stage}/${width}: codemode background changed within a line`);
				}
			}
		}
	});
}

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: actual host compacts success, preserves expansion, width, duration and native escape hatch`, async (t) => {
		const f = await fixture(t, mode);
		const args = { path: "中文/é👩‍💻.txt" };
		const output = Array.from({ length: 25 }, (_, i) => `line-${i}`).join("\n");
		const value = result(output, undefined, false, 1500);
		const original = JSON.stringify({ args, value });
		const card = f.component("read", "one", args);
		card.updateResult(value);
		f.tui.addChild(card);
		assert.match(frame(card), /\+ ok read 中文/);
		assert.match(frame(card), /1\.5s/);
		assert.doesNotMatch(frame(card), /line-24/);
		card.setExpanded(true);
		assert.match(frame(card), /line-24/);
		card.setExpanded(false);
		for (const mode of ["ascii", "unicode", "nerd", "auto"] as const) {
			f.config.icons.mode = mode;
			for (const width of [12, 30, 60, 100]) frame(card, width);
		}
		initTheme("light"); card.invalidate(); frame(card); initTheme("dark"); card.invalidate();
		f.tui.start(); f.tui.renderNow(true);
		assert.ok(f.writes().length > 0);
		f.config.toolPresentation = false;
		assert.doesNotMatch(frame(card), /\+ ok read/);
		f.config.toolPresentation = true; f.config.enabled = false;
		assert.doesNotMatch(frame(card), /\+ ok read/);
		assert.equal(JSON.stringify({ args, value }), original);
	});
	test(`${mode}: compact layout hides successful output across native, generic and specialized tools`, async (t) => {
		const f = await fixture(t, mode);
		const specialized: ToolRenderers = {
			renderCall: () => new Text("SPECIAL-CALL", 0, 0),
			renderResult: () => new Text("SPECIAL-RESULT", 0, 0),
		};
		const broken: ToolRenderers = { renderResult() { throw new Error("renderer failed"); } };
		const cases: Array<{ name: string; args: unknown; base?: ToolRenderers; diff?: boolean }> = [
			{ name: "read", args: { path: "file.txt" } },
			{ name: "bash", args: { command: "some-command" } },
			{ name: "edit", args: { path: "file.txt", edits: [{ oldText: "old", newText: "new" }] }, diff: true },
			{ name: "future_tool", args: {} },
			{ name: "mcp__specialized", args: {}, base: specialized },
			{ name: "broken_renderer", args: {}, base: broken },
		];
		for (const { name, args, base, diff } of cases) {
			f.config.messageLayout = "normal";
			const value = result("SUCCESS-FIRST\nSUCCESS-SECOND\nSUCCESS-THIRD\nSUCCESS-END",
				diff ? { diff: "-1 DIFF-OLD\n+1 DIFF-NEW", firstChangedLine: 1 } : undefined, false, 250);
			const snapshot = JSON.stringify({ args, value });
			const card = f.component(name, name, args, base);
			card.updateResult(value);
			const normal = frame(card);
			assert.match(normal, /SUCCESS-FIRST/, "normal layout retains the output summary");
			f.config.messageLayout = "compact";
			for (const width of [22, 100, 500]) {
				const compact = frame(card, width);
				assert.doesNotMatch(compact, /SUCCESS-|SPECIAL-RESULT|DIFF-OLD|DIFF-NEW/, `${name}: no successful output, including header summary`);
			}
			assert.ok(frame(card).includes(`ok ${name}`));
			assert.match(frame(card), /250ms/);
			card.setExpanded(true);
			assert.match(frame(card), diff ? /DIFF-NEW/ : /SUCCESS-END/, `${name}: details remain recoverable`);
			if (base === specialized) assert.match(frame(card), /SPECIAL-RESULT/);
			card.setExpanded(false);
			assert.doesNotMatch(frame(card), /SUCCESS-|SPECIAL-RESULT|DIFF-NEW/);
			f.config.messageLayout = "normal";
			assert.equal(frame(card), normal, "live layout toggle restores the original presentation");
			f.config.messageLayout = "compact";
			f.config.toolPresentation = false;
			card.setExpanded(true); // Native read intentionally hides successful content while collapsed.
			assert.match(frame(card), base === specialized ? /SPECIAL-RESULT/ : diff ? /DIFF-NEW/ : /SUCCESS-FIRST/, "native escape hatch remains available");
			f.config.toolPresentation = true;
			f.config.enabled = false;
			assert.match(frame(card), base === specialized ? /SPECIAL-RESULT/ : diff ? /DIFF-NEW/ : /SUCCESS-FIRST/);
			f.config.enabled = true;
			card.setExpanded(false);
			assert.equal(JSON.stringify({ args, value }), snapshot, "presentation never mutates model-facing content");
			card.updateResult(result("permission denied\n" + "earlier output\n".repeat(10) + "failure-tail", undefined, true));
			assert.match(frame(card), /permission denied/);
			assert.match(frame(card), /failure-tail/);
		}
	});
	test(`${mode}: compact result notices fold through expansion without hiding errors or mutating results`, async (t) => {
		const f = await fixture(t, mode);
		const specialized: ToolRenderers = {
			renderResult: (value) => new Text(value.content.filter((part) => part.type === "text").map((part) => part.text).join("\n")
				+ (value.details?.fullOutputPath ? `\nCUSTOM-PATH: ${value.details.fullOutputPath}` : ""), 0, 0),
		};
		const cases = [
			{ name: "read", args: { path: "file.txt" }, base: undefined },
			{ name: "bash", args: { command: "some-command" }, base: undefined },
			{ name: "edit", args: { path: "file.txt", edits: [{ oldText: "old", newText: "new" }] }, base: undefined },
			{ name: "future_tool", args: {}, base: undefined },
			{ name: "mcp__specialized", args: {}, base: specialized },
			{ name: "codemode", args: { code: "return 'body';" }, base: undefined },
		];
		const nativeContent = (text: string) => text.split("\n").map((line) => line.replace(/^\| ?/, "").trim()).filter(Boolean).join("\n");
		const notices = /Output truncated|Host truncation|Showing 1-3|text-notice|tail-notice|metadata-only|CUSTOM-PATH/;
		for (const { name, args, base } of cases) for (const state of ["ok", "partial", "error"] as const) {
			f.config.toolMessageLayout = "normal";
			const value = result("[Output truncated: Full output saved to: /tmp/text-notice.txt]\n"
				+ (state === "error" ? "permission denied\n" : "BODY-START\n")
				+ "body\n".repeat(10) + "BODY-END\n[Showing 1-3 of 9]\n[Full output written to: /tmp/tail-notice.txt]", {
					truncation: { truncated: true }, matchLimitReached: 3, resultLimitReached: 4,
					entryLimitReached: 5, linesTruncated: 6, fullOutputPath: "/tmp/中文/metadata-only.txt",
					...(name === "codemode" ? { calls: [{ id: "child", name: "read", args: "file.txt", status: "error", error: "child permission denied" }] } : {}),
				}, state === "error");
			const snapshot = JSON.stringify(value);
			const card = f.component(name, `${name}-${state}`, args, base);
			card.updateResult(value, state === "partial");
			card.setExpanded(true);
			f.config.toolPresentation = false;
			const native = nativeContent(frame(card, 500));
			f.config.enabled = false;
			const disabledExtension = frame(card, 500);
			f.config.enabled = true; f.config.toolPresentation = true;
			card.setExpanded(false);
			const normal = frame(card, 500);
			f.config.toolMessageLayout = "compact";
			for (const width of [40, 500]) assert.doesNotMatch(frame(card, width), notices, `${name}/${state}: notices stay folded`);
			if (state === "error") assert.match(frame(card, 500), /permission denied/, `${name}: actual error remains visible`);
			if (name === "codemode") assert.match(frame(card, 500), /child permission denied/, "child errors are not result notices");
			card.setExpanded(true);
			const expanded = frame(card, 500);
			assert.match(expanded, /text-notice\.txt/);
			assert.match(expanded, /tail-notice\.txt/);
			assert.match(expanded, /metadata-only\.txt/, `${name}/${state}: metadata-only file access is recoverable`);
			for (const key of ["matchLimitReached", "resultLimitReached", "entryLimitReached", "linesTruncated"]) assert.ok(expanded.includes(key));
			card.setExpanded(false);
			assert.doesNotMatch(frame(card, 500), notices, "collapse folds notices again");
			f.config.toolMessageLayout = "normal";
			assert.equal(frame(card, 500), normal, "normal layout is unchanged after expand/collapse");
			f.config.toolMessageLayout = "compact";
			f.config.toolPresentation = false;
			card.setExpanded(true);
			const disabled = frame(card, 500);
			f.config.enabled = false;
			assert.equal(nativeContent(disabled), native, "disabled enhancement retains native result behavior");
			assert.equal(frame(card, 500), disabledExtension, "disabled extension retains its original shell and native result behavior");
			f.config.enabled = true; f.config.toolPresentation = true;
			assert.equal(JSON.stringify(value), snapshot, "folding never edits host/model-facing content or metadata");
		}
	});
}

test("folding notices preserves arbitrary output, other metadata and images", () => {
	const image = { type: "image" as const, data: "fixture", mimeType: "image/png" };
	const text = "warning: application fallback\n\u001b[33m[Output truncated: host notice]\u001b[0m\npermission denied";
	const value = {
		...result(text, {
			truncation: { truncated: true }, fullOutputPath: "/tmp/full.txt", linesTruncated: 1,
			diff: "retained diff", calls: [], custom: { retained: true },
		}, true),
		content: [{ type: "text" as const, text }, image],
	};
	const snapshot = structuredClone(value);
	const folded = withoutResultNotices(value);
	assert.deepEqual(folded.content, [{ type: "text", text: "warning: application fallback\npermission denied" }, image]);
	assert.deepEqual(folded.details, { diff: "retained diff", calls: [], custom: { retained: true } });
	assert.equal(folded.isError, true);
	assert.equal(folded.content[1], image, "image ownership is unchanged");
	assert.deepEqual(value, snapshot, "original notices remain available for expansion");
});

test("host error evidence, tail notices/paths, edit diff and image controls survive", async (t) => {
	const f = await fixture(t);
	const read = f.component("read", "read", { path: "file.txt" });
	f.config.messageLayout = "compact";
	read.updateResult(result("error is just a word\n" + "many\n".repeat(15) + "[Output truncated: Full output saved to: /tmp/full-tail.txt]", { truncation: { truncated: true }, fullOutputPath: "/tmp/中文/full-output.txt" }));
	assert.match(frame(read), /\+ ok/);
	assert.doesNotMatch(frame(read), /Output truncated|full-tail\.txt|full-output\.txt/);
	read.setExpanded(true);
	assert.match(frame(read), /Output truncated by host/);
	assert.match(frame(read), /full-tail\.txt/);
	assert.match(frame(read), /full-output\.txt/);
	read.setExpanded(false);
	read.updateResult(result("permission denied\nfull error tail", undefined, true));
	assert.match(frame(read), /x error read/);
	assert.match(frame(read), /permission denied/);
	const bash = f.component("bash", "failure", { command: "a-command" });
	bash.updateResult(result("earlier output\n".repeat(30) + "Command exited with code 1", undefined, true));
	assert.match(frame(bash), /Command exited with code 1/);
	const edit = f.component("edit", "edit", { path: "a.txt", edits: [{ oldText: "old", newText: "new" }] });
	edit.updateResult(result("Successfully replaced", { diff: "-1 old\n+1 new", firstChangedLine: 1 }));
	assert.doesNotMatch(frame(edit), /old|new|Successfully replaced/);
	edit.setExpanded(true);
	assert.match(frame(edit), /old/); assert.match(frame(edit), /new/);
	edit.setExpanded(false);
	assert.doesNotMatch(frame(edit), /old|new|Successfully replaced/, "collapse hides the successful diff again");
	const image = f.component("read", "image", { path: "a.png" });
	const content = { content: [{ type: "image", data: "fixture", mimeType: "image/png" }], details: undefined, isError: false };
	image.updateResult(content);
	image.setShowImages(false);
	image.setExpanded(true);
	assert.match(frame(image), /image/i);
	assert.equal(content.content[0]!.data, "fixture");
});

test("codemode prioritizes ordered child activity, retains independent parent outcome/output and expanded records", async (t) => {
	const f = await fixture(t);
	const code = "// script-start\n" + "console.log('script-middle');\n".repeat(25) + "return 'script-end';";
	const calls = [
		{ id: "c/0", name: "read", args: '{"path":"one"}', status: "ok", durationMs: 1000 },
		{ id: "c/1", name: "read", args: '{"path":"two"}', status: "error", error: "child permission denied", durationMs: 1000 },
		{ id: "c/2", name: "models.classify", args: '{"provider":"typesafe","model":"jev"}', status: "running", cost: 0.005 },
		{ id: "c/3", name: "read", args: "bounded host argument...", status: "cancelled", error: "script ended" },
		...Array.from({ length: 8 }, (_, i) => ({ id: `c/${i + 4}`, name: `tool-${i}`, args: "summary", status: "ok" })),
	];
	const card = f.component("codemode", "c", { code });
	card.markExecutionStarted();
	card.updateResult(result("", { calls }), true);
	assert.match(frame(card), /Observed 12 calls/);
	assert.match(frame(card), /child permission denied/);
	assert.match(frame(card), /models.classify.*typesafe.*jev.*0\.005/);
	assert.match(frame(card), /cancelled/);
	assert.match(frame(card), /Hidden 7: 7 ok/);
	assert.doesNotMatch(frame(card), /%|script-middle/);
	card.updateResult(result("Script completed\nWall time 1.5 seconds\nOutput:\ncount: 2\n" + "output\n".repeat(20) + "parent-end", { calls, fullOutputPath: "/tmp/parent-output.txt" }, false, 1500));
	const compact = frame(card);
	assert.match(compact, /\+ ok codemode/); assert.match(compact, /1\.5s/);
	assert.match(compact, /1 error/); assert.match(compact, /count: 2/);
	assert.match(compact, /parent-output.txt/);
	f.config.messageLayout = "compact";
	assert.doesNotMatch(frame(card), /count: 2|parent-end/);
	assert.match(frame(card), /child permission denied/);
	assert.match(frame(card), /cancelled/); assert.doesNotMatch(frame(card), /parent-output.txt/);
	card.setExpanded(true);
	const expanded = frame(card);
	assert.match(expanded, /script-end/); assert.match(expanded, /parent-end/);
	assert.match(expanded, /tool-7/); assert.match(expanded, /host summaries/);
	assert.match(expanded.replace(/\n\| /g, "\n"), /raw child results are not\s+retained/);
	card.setExpanded(false);
	card.updateResult(result("partial output\n" + "before\n".repeat(8) + "Script error: failed after write", { calls }, true));
	assert.match(frame(card), /x error codemode/); assert.match(frame(card), /partial output/);
	assert.match(frame(card), /failed after write/);
});

test("unknown/specialized schemas are styled without guessing malformed codemode records", async (t) => {
	const f = await fixture(t);
	const specialized = { renderCall: () => new Text("OTHER CALL", 0, 0), renderResult: () => new Text("OTHER RESULT", 0, 0) };
	assert.notEqual(f.runner.resolveToolRenderers("read", () => specialized), specialized);
	const other = f.component("read", "other", { command: "not necessarily a shell command" }, specialized);
	other.updateResult(result("actual output"));
	assert.match(frame(other), /ok read.*"command":/);
	assert.match(frame(other), /OTHER CALL/); assert.match(frame(other), /OTHER RESULT/);
	const special = f.component("special", "s", {}, specialized);
	special.updateResult(result("special output"));
	assert.match(frame(special), /ok special/);
	assert.match(frame(special), /SPECIAL CALL/);
	assert.match(frame(special), /SPECIAL RESULT AND CONTROLS/);
	const wrong = f.component("read", "wrong", { url: "not a file path" });
	wrong.updateResult(result("content"));
	assert.match(frame(wrong), /ok read.*"url":/);
	const code = f.component("codemode", "unknown", { code: "return 1;" });
	code.updateResult(result("unknown output", undefined));
	assert.match(frame(code), /ok codemode/);
	assert.doesNotMatch(frame(code), /Observed/);
	assert.match(frame(code), /return 1/);
	for (const details of [null, {}, { calls: [{ id: "1", name: "read", args: "{}", status: "guessed" }] }, { calls: [], fullOutputPath: 3 }]) assert.equal(codemodeCalls(details), undefined);
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: every tool source and future tool gets generic styling without a dedicated renderer`, async (t) => {
		const f = await fixture(t, mode);
		for (const name of ["replace", "replace_match", "insert", "copy", "move", "ffgrep", "fffind", "delegate", "delegate_status", "computer_use_click", "mcp__example__search", "future_tool_2026"]) {
			const args = { query: "中文/é👩‍💻", custom: { mode: "example" } };
			const returned = result("actual output\n" + "other output\n".repeat(15) + "last-output", { fullOutputPath: "/tmp/" + "long/".repeat(8) + "saved.txt" }, false, 250);
			const snapshot = JSON.stringify({ args, returned });
			f.presentation.start(name); f.advance(500);
			const card = f.component(name, name, args);
			card.markExecutionStarted();
			assert.ok(frame(card).includes(`running ${name}`));
			assert.match(frame(card), /500ms/);
			card.updateResult(returned);
			assert.ok(frame(card).includes(`ok ${name}`));
			assert.match(frame(card), /"query":/); assert.match(frame(card), /actual output/);
			assert.match(frame(card), /250ms/); assert.doesNotMatch(frame(card), /last-output/);
			for (const width of [12, 30, 60]) frame(card, width);
			assert.match(frame(card, 22).replace(/\s+/g, ""), /saved\.txt/);
			card.setExpanded(true);
			assert.match(frame(card), /last-output/); assert.match(frame(card), /example/);
			card.setExpanded(false);
			card.updateResult(result("permission denied\n" + "output\n".repeat(10) + "failure-tail", undefined, true));
			assert.ok(frame(card).includes(`error ${name}`));
			assert.match(frame(card), /permission denied/); assert.match(frame(card), /failure-tail/);
			assert.equal(JSON.stringify({ args, returned }), snapshot);
			f.presentation.end(name);
		}
	});
}

test("late registration, missing renderers, history, generic images and settings keep content recoverable", async (t) => {
	const f = await fixture(t);
	const before = f.component("late_registered", "before", { path: "not-yet-connected" });
	before.updateResult(result("historical content"));
	assert.match(frame(before), /ok late_registered/);
	assert.doesNotMatch(frame(before), /0ms|Took|Elapsed/);
	let executed = 0;
	f.api.registerTool({ ...f.read, name: "late_registered", renderCall: undefined, renderResult: undefined,
		async execute() { executed++; return result("registered result"); } });
	const tool = f.runner.getToolDefinition("late_registered")!;
	assert.ok(tool);
	const value = await tool.execute("late", { path: "file" }, undefined, undefined, {} as ExtensionToolContext);
	const card = f.component("late_registered", "late", { path: "file" });
	card.updateResult({ ...value, isError: false });
	assert.match(frame(card), /ok late_registered.*"path":/); assert.match(frame(card), /registered result/);
	assert.equal(executed, 1, "rendering does not execute the tool again");
	const output = result("preview\n" + "data\n".repeat(12) + "last-data");
	card.updateResult(output);
	assert.doesNotMatch(frame(card), /last-data/);
	f.config.toolPresentation = false;
	assert.doesNotMatch(frame(card), /ok late_registered/);
	assert.match(frame(card), /last-data/);
	f.config.toolPresentation = true;
	assert.match(frame(card), /ok late_registered/);
	assert.doesNotMatch(frame(card), /last-data/);
	const image = f.component("mcp__image__fetch", "image", {});
	image.updateResult({ content: [{ type: "image", data: "fixture", mimeType: "image/png" }], details: undefined, isError: false });
	image.setShowImages(false);
	assert.match(frame(image), /image/i);
	image.setExpanded(true); assert.match(frame(image), /image/i);
});

test("renderer callback failures retain unified presentation and recover generic details", async (t) => {
	const f = await fixture(t);
	const base: ToolRenderers = {
		renderCall() { throw new Error("custom call renderer failed"); },
		renderResult() { throw new Error("custom result renderer failed"); },
	};
	const args = { content: "hidden argument ".repeat(20) + "ARGUMENT-END" };
	const card = f.component("broken_renderer", "broken", args, base);
	card.updateResult(result("output preview\n" + "output\n".repeat(10) + "OUTPUT-END"));
	assert.match(frame(card), /ok broken_renderer/);
	assert.match(frame(card), /output preview/);
	assert.doesNotMatch(frame(card), /ARGUMENT-END|OUTPUT-END/);
	card.setExpanded(true);
	assert.match(frame(card), /ARGUMENT-END/); assert.match(frame(card), /OUTPUT-END/);
	f.config.toolPresentation = false;
	assert.doesNotMatch(frame(card), /ok broken_renderer/);
	assert.match(frame(card), /OUTPUT-END/);
});

test("generic arguments are bounded and sanitized without inventing familiar-name semantics", async (t) => {
	const f = await fixture(t);
	for (const args of [undefined, null, "script text", [1, "two"], { path: "not-guaranteed-to-be-a-file", command: "not-guaranteed-to-be-a-shell" }]) {
		const card = f.component("bash", "foreign-bash", args, {});
		card.updateResult(result("error is only output", { calls: [{ status: "error" }], diff: "not an edit diff" }));
		assert.match(frame(card), /ok bash/);
		assert.doesNotMatch(frame(card), /Observed|More diff|x error/);
		card.setExpanded(true); frame(card, 20);
	}
	const args = { content: "long-content-".repeat(10000) + "ARGUMENT-END", injected: "\u001b[31mred\u001b]52;c;payload\u0007", nested: { one: { two: "deep" } } };
	const card = f.component("future", "bounded", args);
	card.updateResult(result("plain result"));
	assert.doesNotMatch(frame(card), /ARGUMENT-END|\u001b|\u0007/);
	card.setExpanded(true);
	assert.match(frame(card), /ARGUMENT-END/);
	const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
	const cycle = f.component("future", "cycle", cyclic);
	cycle.updateResult(result("result")); frame(cycle); cycle.setExpanded(true);
	assert.match(frame(cycle), /arguments unavailable/);
});

for (const renderShell of ["default", "self"] as const) for (const messageLayout of ["normal", "compact"] as const) {
	test(`${renderShell}/${messageLayout}: specialized components retain mouse/focus/input, state and lastComponent through composition`, async (t) => {
		const f = await fixture(t, "fullscreen");
		f.config.messageLayout = messageLayout;
		let clicks = 0; let invalidations = 0;
		const keys: string[] = [];
		const seenLast: Array<Component | undefined> = [];
		const sharedStates: unknown[] = [];
		const control = (label: string): Component & { focused: boolean } => ({
			focused: false, wantsKeyRelease: true,
			render: (width) => new Text(label, 0, 0).render(width),
			handleMouse(event) { if (event.type === "click") { clicks++; return { handled: true, focus: true }; } return undefined; },
			handleInput(data) { keys.push(data); },
			invalidate() { invalidations++; },
		});
		const callControl = control("CALL CONTROL");
		const resultControl = control("RESULT CONTROL — IMPORTANT METADATA");
		const base: ToolRenderers = {
			renderShell,
			renderCall(_args, _theme, ctx) { seenLast.push(ctx.lastComponent); sharedStates.push(ctx.state); return callControl; },
			renderResult(_result, _options, _theme, ctx) { seenLast.push(ctx.lastComponent); sharedStates.push(ctx.state); return resultControl; },
		};
		const card = f.component("mcp__interactive__widget", "interactive", { field: "value", content: "long argument ".repeat(30) + "ARGUMENT-END" }, base);
		card.updateResult(result("actual output\n" + "long output\n".repeat(15) + "OUTPUT-END"));
		for (const expanded of [false, true, false]) {
			card.setExpanded(expanded);
			const rendered = frame(card);
			assert.match(rendered, /ok mcp__interactive__widget/);
			assert.match(rendered, /CALL CONTROL/);
			if (messageLayout === "compact" && !expanded) assert.doesNotMatch(rendered, /IMPORTANT METADATA/);
			else assert.match(rendered, /IMPORTANT METADATA/);
			if (expanded) {
				assert.match(rendered, /ARGUMENT-END/); assert.match(rendered, /OUTPUT-END/);
			} else assert.doesNotMatch(rendered, /ARGUMENT-END|OUTPUT-END/);
			const lines = card.render(100);
			for (const label of messageLayout === "compact" && !expanded ? ["CALL CONTROL"] : ["CALL CONTROL", "RESULT CONTROL"]) {
				const y = lines.findIndex((line: string) => stripTerminalSequences(line).includes(label));
				assert.ok(y >= 0);
				const handled = card.handleMouse({ type: "click", button: "left", x: messageLayout === "compact" ? 3 : 1, y, screenX: 1, screenY: y, width: 100, height: lines.length, shift: false, ctrl: false, alt: false }) as { handled?: boolean; focus?: boolean; focusTarget?: Component; target: { component: Component } };
				assert.equal(handled.handled, true); assert.equal(handled.focus, true);
				const focused = handled.focusTarget ?? handled.target.component;
				assert.equal(focused, label === "CALL CONTROL" ? callControl : resultControl);
				assert.equal(focused.wantsKeyRelease, true);
				f.tui.setFocus(focused);
				focused.handleInput?.("test-key");
			}
			card.invalidate(); frame(card, 22);
		}
		const expectedClicks = messageLayout === "compact" ? 4 : 6;
		assert.equal(clicks, expectedClicks); assert.equal(keys.length, expectedClicks); assert.ok(invalidations > 0);
		assert.ok(seenLast.includes(callControl) && seenLast.includes(resultControl));
		assert.ok(sharedStates.every((state) => state === sharedStates[0]));
		f.config.toolPresentation = false;
		assert.doesNotMatch(frame(card), /ok mcp__interactive__widget/);
		assert.match(frame(card), /CALL CONTROL/); assert.match(frame(card), /RESULT CONTROL/);
		f.config.enabled = false; f.config.toolPresentation = true;
		assert.doesNotMatch(frame(card), /ok mcp__interactive__widget/);
	});
}

test("native enhancements and all unfamiliar codemode child rows remain available", async (t) => {
	const f = await fixture(t);
	for (const [name, args, expected] of [
		["write", { path: "written.txt", content: "content" }, "written.txt"],
		["grep", { pattern: "needle", path: "src" }, "needle in src"],
		["find", { pattern: "*.ts", path: "src" }, "*.ts in src"],
		["ls", { path: "src" }, "src"],
	] as const) {
		const card = f.component(name, name, args);
		card.updateResult(result("output"));
		assert.ok(frame(card).includes(`ok ${name} ${expected}`));
	}
	const names = ["replace", "delegate", "computer_use_click", "mcp__new__tool", "future_tool"];
	const calls = names.map((name, i) => ({ id: `all/${i}`, name, args: `host-args-${i}`, status: "ok" }));
	const card = f.component("codemode", "all", { code: "return 'parent';" });
	card.updateResult(result("parent", { calls }));
	for (const name of names) assert.ok(frame(card).includes(`ok ${name}`));
	assert.match(frame(card), /Observed 5 calls/);
	card.setExpanded(true);
	for (const name of names) assert.ok(frame(card).includes(name));
	assert.match(frame(card), /raw child results are not\s+retained/);
});

test("live clocks are event-evidenced, isolated and forgotten on session/branch transitions", async (t) => {
	const f = await fixture(t);
	f.presentation.start("a"); f.advance(1000); f.presentation.start("b"); f.advance(500);
	const a = f.component("read", "a", { path: "a" }); const b = f.component("read", "b", { path: "b" });
	a.markExecutionStarted(); b.markExecutionStarted();
	assert.match(frame(a), /1\.5s/); assert.match(frame(b), /500ms/);
	f.presentation.start("a/1", "a");
	const nested = f.component("read", "a/1", { path: "nested" }); nested.markExecutionStarted();
	assert.doesNotMatch(frame(nested), /\d+(?:ms|s)/);
	f.presentation.reset(); f.presentation.start("a"); f.advance(2000);
	assert.doesNotMatch(frame(a), /\d+(?:ms|s)/, "old card cannot borrow a reused id's new clock");
	a.updateResult(result("historical content"));
	assert.doesNotMatch(frame(a), /0ms|2\.0s|Took/);
	f.presentation.shutdown(); f.presentation.start("inactive");
	assert.doesNotMatch(frame(f.component("read", "inactive", { path: "inactive" })), /\d+(?:ms|s)/);
});
test("shared refresh drives actual tool invalidation, thinking and Workline without mixing clocks or retaining idle demand", async (t) => {
	const f = await fixture(t);
	t.mock.timers.enable({ apis: ["setTimeout"] });
	// Keep host scheduling out of the extension-source count. Actual components,
	// public invalidation and cached render output are still exercised below.
	t.mock.method(f.tui, "requestRender", () => {});
	const set = globalThis.setTimeout;
	const clear = globalThis.clearTimeout;
	const active = new Set<ReturnType<typeof setTimeout>>();
	let wakeups = 0;
	let maxTimers = 0;
	t.mock.method(globalThis, "setTimeout", (callback: () => void, delay: number) => {
		const timer = set(() => { active.delete(timer); wakeups++; callback(); }, delay);
		active.add(timer); maxTimers = Math.max(maxTimers, active.size);
		return timer;
	});
	t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { active.delete(timer); clear(timer); });
	const advance = (ms: number) => { f.advance(ms); t.mock.timers.tick(ms); };
	let uiRenders = 0;
	const renderUi = () => { uiRenders++; f.tui.requestRender(); };
	const state = { workingSince: f.now() as number | undefined, lastRun: undefined };
	const workline = createWorklineRenderer(() => state, () => f.config, () => hostTheme.theme, f.now);
	const stopWorkline = f.refresh.subscribe(250, () => f.refresh.requestRender(renderUi));
	const lifecycle = new SessionLifecycle(); lifecycle.start();
	const message = { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "## Verify" }] };
	const thinking = new AssistantMessageComponent(message, true);
	f.tui.addChild(thinking);
	const bridge = new ThinkingLabelTarget(f.tui);
	const ctx = { ui: { setHiddenThinkingLabel: () => thinking.setHiddenThinkingLabel("Thinking..."), notify: (text: string) => assert.fail(text) } } as unknown as ExtensionContext;
	const editor = { getViewportWidth: () => 100, setLatestHiddenThinkingLabel: (text: string, render?: boolean) => bridge.set(text, render), resetHiddenThinkingLabelTarget: () => bridge.reset() };
	const controller = new PeekController({
		getConfig: () => f.config, getEditor: () => editor, getContext: () => ctx,
		isActive: () => true, isTuiContext: () => true, lifecycle,
		refresh: f.refresh, requestRender: renderUi, now: f.now,
	});
	t.after(() => { controller.resetAndClear(ctx); stopWorkline(); });
	controller.messageUpdate(message, ctx);
	f.presentation.start("clock-a");
	const a = f.component("read", "clock-a", { path: "a" }); a.markExecutionStarted(); frame(a);
	advance(100);
	f.presentation.start("clock-b");
	const b = f.component("read", "clock-b", { path: "b" }); b.markExecutionStarted(); frame(b);
	const before = uiRenders;
	advance(150); advance(250);
	assert.match(frame(a), /500ms/);
	assert.match(frame(b), /400ms/);
	assert.match(stripTerminalSequences(thinking.render(100).join("\n")), /0\.5s/);
	assert.match(stripTerminalSequences(workline.render(100)), /working 0s/);
	advance(250); advance(250);
	assert.equal(wakeups, 4);
	assert.equal(maxTimers, 1);
	assert.equal(uiRenders - before, 4, "Workline/thinking use one shared render channel per round");
	assert.match(frame(a), /1\.0s/);
	assert.match(frame(b), /900ms/);
	f.config.thinkingPeek.lines = 0; controller.configChanged(1, ctx);
	f.config.toolPresentation = false; f.presentation.configChanged();
	const afterDisable = uiRenders;
	advance(250);
	assert.equal(uiRenders, afterDisable + 1, "Workline survives other features disabling");
	f.config.toolPresentation = true; f.presentation.configChanged();
	advance(250);
	assert.match(frame(b), /1\.4s/);
	f.presentation.start("unmounted"); // No rendered component: no periodic UI demand.
	f.presentation.end("clock-a"); f.presentation.end("clock-b");
	stopWorkline();
	assert.equal(active.size, 0);
	const stopped = wakeups;
	advance(5000);
	assert.equal(wakeups, stopped, "no extension-owned idle periodic wakeups remain");
});

test("pure preview policy keeps parent output, child evidence and expansion limits independent", () => {
	const calls = [
		{ id: "p/0", name: "future", args: "host summary", status: "ok" as const },
		{ id: "p/1", name: "read", args: "missing", status: "error" as const, error: "caught child" },
	];
	for (const call of calls) Object.freeze(call);
	Object.freeze(calls);
	const parent = result("Script completed\nWall time 1.2 seconds\nOutput:\nfirst\n\nsecond\nthird\nOUTPUT-END", Object.freeze({ calls }));
	Object.freeze(parent.content[0]); Object.freeze(parent.content); Object.freeze(parent);
	const args = Object.freeze({ code: "return 'parent';" });
	const snapshot = JSON.stringify(parent);
	const policy = toolPolicy("codemode", args, true, parent);
	assert.equal(policy.special, true); assert.equal(policy.calls, calls);
	assert.equal(toolPolicy("codemode", args, false, parent).special, false);
	assert.equal(toolPolicy("codemode", args, true, result("parent", { calls: [{ status: "error" }] })).special, false);
	for (let repeat = 0; repeat < 2; repeat++) {
		assert.deepEqual(compactContent("codemode", true, parent, false, false, calls), { kind: "output", lines: ["first", "second", "third"] });
		assert.deepEqual(compactContent("codemode", true, parent, true, false, calls), { kind: "output", lines: [] });
		const activity = stripTerminalSequences(renderChildActivity(calls, hostTheme.theme, "ascii", 100).join("\n"));
		assert.match(activity, /Observed 2 calls: 1 ok, 1 error/); assert.match(activity, /caught child/);
		const header = stripTerminalSequences(renderCallSummary({
			name: "codemode", args, special: true, result: parent, isPartial: false, isError: false,
			status: "ok", scriptHint: "expand script",
		}, hostTheme.theme, "ascii", 100).join("\n"));
		assert.equal(header, "+ ok codemode script", "child error does not change the parent verdict or fabricate timing");
	}
	assert.equal(JSON.stringify(parent), snapshot);
	assert.match(expansionHint([], "EXPAND"), /EXPAND · script, output & host child summaries \(no raw child results\)/);
	assert.equal(expansionHint(undefined, "EXPAND"), "EXPAND · arguments & result");
	assert.deepEqual(compactContent("future", false, result("one\ntwo\nthree\nhidden\n\u001b[31mactionable tail\u001b[0m"), false, true, undefined),
		{ kind: "output", lines: ["one", "two", "three", "actionable tail"] });
	assert.deepEqual(compactContent("edit", true, result("native edit error", { diff: "diff" }), false, true, undefined), { kind: "native-edit" });
	assert.deepEqual(compactContent("edit", true, result("edited", { diff: "diff" }), false, false, undefined), { kind: "diff", diff: "diff" });
	assert.ok(defaultOutputLines(parent, true).includes("OUTPUT-END"));
	assert.equal(defaultOutputLines(parent, false).at(-1), "More output — expand for details");
});

test("important overflow remains discoverable and selected rows retain call order", () => {
	const calls = Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, name: "read", args: "{}", status: i % 3 === 0 ? "ok" : "error" as "ok" | "error" }));
	const { shown, hidden } = selectChildren(calls);
	assert.deepEqual(shown.map((call) => call.id), ["1", "2", "4", "5", "7"]);
	assert.equal(hidden.filter((call) => call.status === "error").length, 3);
	assert.equal(codemodeCalls({ calls: [] })?.length, 0);
});

test("codemode parents keep separate records, no-call scripts and hidden failures remain explicit at narrow widths", async (t) => {
	const f = await fixture(t);
	const a = f.component("codemode", "parent-a", { code: 'return "a";' });
	const b = f.component("codemode", "parent-b", { code: 'return "b";' });
	const calls = Array.from({ length: 8 }, (_, i) => ({ id: `a/${i}`, name: "read", args: "a-only", status: "error" }));
	a.updateResult(result("a output", { calls }), true);
	b.updateResult(result("b output", { calls: [] }));
	assert.match(frame(a), /Observed 8 calls: 8 error/);
	assert.doesNotMatch(frame(b), /a-only|8 error/);
	assert.match(frame(b), /Observed 0 calls/); assert.match(frame(b), /b output/);
	const narrow = frame(a, 22).replace(/\s+/g, " ");
	assert.match(narrow, /Hidden 3: 3 error/);
	const read = f.component("read", "path", { path: "中文/" + "very-long/".repeat(8) });
	read.updateResult(result("preview", { fullOutputPath: "/tmp/" + "long/".repeat(8) + "saved.txt" }));
	assert.match(frame(read, 22).replace(/\s+/g, ""), /saved\.txt/);
});


test("actual shell schema and renderer are enhanced without recreating historical timing", async (t) => {
	const f = await fixture(t);
	const card = f.component("bash", "shell", { command: "echo " + "long-command ".repeat(30) });
	card.updateResult(result("shell output", undefined, false, 2200));
	assert.match(frame(card, 40), /ok bash/); assert.match(frame(card, 40), /2\.2s/);
	card.setExpanded(true); assert.match(frame(card), /shell output/);
	card.updateResult(result("old output"));
	assert.doesNotMatch(frame(card), /Took|Elapsed/);
});

test("native shell refresh timers finish after collapse/completion and branch reset", async (t) => {
	const f = await fixture(t);
	const intervals = new Map<ReturnType<typeof setInterval>, number>();
	const cleared = new Set<ReturnType<typeof setInterval>>();
	const originalSet = globalThis.setInterval;
	const originalClear = globalThis.clearInterval;
	t.mock.method(globalThis, "setInterval", ((callback: () => void, ms: number) => {
		const handle = originalSet(callback, ms);
		intervals.set(handle, ms);
		return handle;
	}) as typeof setInterval);
	t.mock.method(globalThis, "clearInterval", ((handle: ReturnType<typeof setInterval>) => {
		cleared.add(handle);
		originalClear(handle);
	}) as typeof clearInterval);
	for (const action of ["complete", "reset"] as const) {
		f.presentation.start(action);
		const card = f.component("bash", action, { command: "echo running" });
		card.markExecutionStarted(); card.setExpanded(true);
		card.updateResult(result("partial"), true); frame(card);
		const nativeTimer = [...intervals].find(([handle, ms]) => ms === 1000 && !cleared.has(handle))?.[0];
		assert.ok(nativeTimer, "expanded native shell starts its own refresh timer");
		card.setExpanded(false); frame(card);
		if (action === "complete") {
			card.updateResult(result("done", undefined, false, 500)); frame(card);
			f.presentation.end(action);
		} else f.presentation.reset();
		assert.ok(cleared.has(nativeTimer), `${action} clears the timer even after collapse`);
		if (action === "reset") {
			card.setExpanded(true); frame(card);
			assert.equal([...intervals].filter(([handle, ms]) => ms === 1000 && !cleared.has(handle)).length, 0,
				"rendering a detached old card does not resurrect its native timer");
		}
	}
});

test("actual codemode sandbox streams dynamic calls, caught child errors, output and irreversible side effects unchanged", async (t) => {
	const f = await fixture(t);
	await writeFile(join(f.cwd, "secret.txt"), "raw-child-secret-content");
	const tools = [createReadTool(f.cwd), createWriteTool(f.cwd)];
	let next = 0;
	const ctx = {
		tools, sessionManager: SessionManager.inMemory(f.cwd),
		async executeTool(name: string, args: unknown) {
			const toolCall = { type: "toolCall" as const, id: `actual/${++next}`, name, arguments: args };
			try {
				const tool = tools.find((candidate) => candidate.name === name)!;
				const value = await tool.execute(toolCall.id, args as never);
				return { toolCall, result: value, isError: false };
			} catch (error) {
				return { toolCall, result: result(String(error)), isError: true };
			}
		},
	} as unknown as ExtensionToolContext;
	const code = `const results = await Promise.allSettled([tools.read({path:"secret.txt"}), tools.read({path:"missing.txt"})]);\ntext(results.filter(r => r.status === "fulfilled").length);\nawait tools.write({path:"written.txt", content:"side effect"});\nreturn "actual-parent-count";`;
	const card = f.component("codemode", "actual", { code });
	card.markExecutionStarted();
	const updates: number[] = [];
	const returned = await f.codemode.execute("actual", { code }, undefined, (update) => {
		updates.push(codemodeCalls(update.details)?.length ?? -1);
		card.updateResult({ ...update, isError: false }, true);
		frame(card);
	}, ctx);
	assert.ok(updates.includes(1) && updates.includes(2) && updates.includes(3));
	const snapshot = JSON.stringify(returned);
	card.updateResult({ ...returned, isError: false });
	assert.match(frame(card), /1 error/); assert.match(frame(card), /\n1\s*\n/); // Actual parent output preview, not a reconstructed child result.
	assert.doesNotMatch(JSON.stringify(returned), /Script error:/);
	card.setExpanded(true);
	assert.match(frame(card), /actual-parent-count/);
	assert.doesNotMatch(frame(card), /raw-child-secret-content/, "absent child content is never reconstructed");
	assert.equal(JSON.stringify(returned), snapshot);
	const failedCode = `await tools.write({path:"written.txt", content:"mutation survives"}); text("partial output"); throw new Error("parent failed");`;
	const failed = await f.codemode.execute("failed", { code: failedCode }, undefined, undefined, ctx);
	const failedCard = f.component("codemode", "failed", { code: failedCode });
	failedCard.updateResult({ ...failed, isError: true });
	assert.match(frame(failedCard), /partial output/); assert.match(frame(failedCard), /parent failed/);
	const written = await tools[0]!.execute("verify", { path: "written.txt" } as never);
	assert.ok(written.content.some((part) => part.type === "text" && part.text.includes("mutation survives")));
});

test("unsupported public capability preserves native presentation and emits an explicit notice", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "open-tui-unsupported-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(dir, { recursive: true, force: true }); });
	const config = structuredClone(DEFAULT_CONFIG);
	config.thinkingPeek.lines = 0;
	for (const key of Object.keys(config.footerSegments) as Array<keyof typeof config.footerSegments>) config.footerSegments[key] = false;
	await writeFile(join(dir, "open-tui.json"), JSON.stringify(config));
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => unknown>();
	const notices: string[] = [];
	const pi = { on(name: string, handler: (event: any, ctx: ExtensionContext) => unknown) { handlers.set(name, handler); }, registerCommand() {} } as unknown as ExtensionAPI;
	const ctx = { hasUI: true, mode: "tui", cwd: dir, ui: { notify(message: string) { notices.push(message); }, setFooter() {}, setEditorComponent() {}, setHiddenThinkingLabel() {} } } as unknown as ExtensionContext;
	const presentation = new ToolPresentation(() => config, pi);
	assert.equal(presentation.available, false); assert.equal(presentation.resolver, undefined);
	openTui(pi);
	await handlers.get("session_start")!({ type: "session_start" }, ctx);
	assert.ok(notices.some((message) => message.includes("public renderer API") && message.includes("native presentation")));
	await handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: compact Tool rails match current status colors across states, icons and expansion`, async (t) => {
		const f = await fixture(t, mode);
		f.config.messageLayout = "compact";
		t.after(() => initTheme("dark"));
		for (const theme of ["dark", "light"] as const) {
			initTheme(theme);
			for (const icons of ["ascii", "unicode"] as const) {
				f.config.icons.mode = icons;
				const glyph = icons === "ascii" ? "|" : "┃";
				for (const name of ["read", "future-tool"]) for (const status of ["pending", "partial", "running", "ok", "error"] as const) {
					const card = f.component(name, `${theme}-${icons}-${name}-${status}`, { path: "file.txt" });
					if (status === "running") card.markExecutionStarted();
					if (status !== "pending") card.updateResult(result("body output", undefined, status === "error"), status === "partial" || status === "running");
					const expected = styledRuns(hostTheme.theme.fg(status === "error" ? "error" : status === "ok" ? "success" : "warning", glyph))[0]!.fg;
					for (const enhanced of [true, false]) for (const expanded of [true, false]) {
						f.config.toolPresentation = enhanced;
						card.setExpanded(expanded); card.invalidate();
						const lines: string[] = card.render(80);
						assert.equal(lines[0], "", "message gap stays unpainted");
						assert.ok(lines.length > 1);
						for (const line of lines.slice(1)) {
							assert.ok(stripTerminalSequences(line).startsWith(`${glyph} `));
							assert.equal(styledRuns(line)[0]!.fg, expected, `${theme}/${icons}/${name}/${status}/${enhanced}/${expanded}: rail color`);
						}
					}
				}
			}
		}
	});
	test(`${mode}: compact User rail and gap stay outside the background with one inner margin on every row`, async (t) => {
		const f = await fixture(t, mode);
		f.config.messageLayout = "compact";
		const user = new UserMessageComponent("message content ".repeat(12) + "\n\n**bold** and `inline` and [link](https://example.com)\n\n```text\n  indented\n```\n\nfinal");
		if (f.tui instanceof TuiAltScreen) f.tui.setLayoutRoot(new VStack([user]));
		else f.tui.addChild(user);
		const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => assert.fail("unexpected fallback"));
		t.after(() => { adapter.cleanup(); initTheme("dark"); });
		for (const theme of ["dark", "light"] as const) for (const icons of ["unicode", "ascii"] as const) {
			initTheme(theme); user.invalidate(); f.config.icons.mode = icons;
			const glyph = icons === "ascii" ? "|" : "┃";
			const expectedFg = styledRuns(hostTheme.theme.fg("userMessageText", glyph))[0]!.fg;
			const expectedBg = styledRuns(hostTheme.theme.bg("userMessageBg", "x"))[0]!.bg;
			const lines: string[] = user.render(40);
			for (const row of [lines[0]!, lines.at(-1)!]) {
				assert.equal(stripTerminalSequences(row), glyph + " ".repeat(39), "top/bottom padding keeps the rail and a blank colored body");
			}
			assert.ok(lines.length > 3, "includes wrapping and a paragraph gap");
			assert.ok(lines.every((line) => visibleWidth(line) === 40), "background retains full body width");
			const nativeLines: string[] = UserMessageComponent.prototype.render.call(user, 39).map((line: string) => line.replace(/\x1b\]133;[ABC]\x07/g, ""));
			assert.equal(lines.length, nativeLines.length, "keeps exactly the native one-row top/bottom padding");
			for (const [index, line] of lines.entries()) {
				const runs = styledRuns(line.replace(/\x1b\]133;[ABC]\x07/g, ""));
				const cells = runs.flatMap((run) => Array.from(run.text, (text) => ({ ...run, text })));
				assert.equal(cells[0]!.text, glyph);
				assert.equal(cells[0]!.fg, expectedFg, "rail uses the User message foreground");
				assert.equal(cells[0]!.bg, "default", "rail is not on the User background");
				assert.equal(cells[1]!.text, " ");
				assert.equal(cells[1]!.bg, "default", "outside gap is unpainted");
				assert.equal(cells[2]!.text, " ", "one inner left margin");
				assert.ok(cells.slice(2).every((cell) => cell.bg === expectedBg), "inner margin and body use the User background");
				const nativeRuns = styledRuns(sliceByColumn(nativeLines[index]!, 1, 37, true));
				const nativeCells = nativeRuns.flatMap((run) => Array.from(run.text, (text) => ({ ...run, text })));
				assert.deepEqual(cells.slice(3), nativeCells, "native Markdown content, backgrounds, foregrounds and attributes survive layout changes");
			}
			assert.ok(stripTerminalSequences(lines[1]!).startsWith(`${glyph}  message content`));
		}
	});
	test(`${mode}: compact User/Tool layout retains one message gap and leaves Assistant byte-for-byte unchanged`, async (t) => {
		const f = await fixture(t, mode);
		f.config.icons.mode = "unicode";
		const chat = new Container();
		const user = new UserMessageComponent("用户请求\n\n第二段");
		const assistant = new AssistantMessageComponent({
			role: "assistant", content: [{ type: "text", text: "正常回复\n\n**正文保持原样**" }], stopReason: "stop",
		});
		const nativeUser = user.render;
		const nativeAssistant = assistant.render;
		const userBefore = user.render(80);
		const assistantBefore = assistant.render(80);
		const first = f.component("read", "compact-first", { path: "file.txt" });
		const second = f.component("future-tool", "compact-second", { query: "text" });
		first.updateResult(result("file output", undefined, false, 12));
		second.updateResult(result("another output", undefined, false, 20));
		chat.addChild(user); chat.addChild(first); chat.addChild(second); chat.addChild(assistant);
		if (f.tui instanceof TuiAltScreen) f.tui.setLayoutRoot(new VStack([new ScrollView(chat, { primary: true })]));
		else f.tui.addChild(chat);
		const warnings: string[] = [];
		const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => warnings.push("unavailable"));
		t.after(() => adapter.cleanup());
		assert.equal(user.render, nativeUser);
		assert.deepEqual(user.render(80), userBefore, "default mode unchanged");
		const normalTool = first.render(80);
		f.config.messageLayout = "compact";
		adapter.refresh();
		const compactUser: string[] = user.render(80);
		const plainUser = compactUser.map(stripTerminalSequences);
		assert.match(plainUser[1]!, /^┃  用户请求/);
		assert.match(plainUser.at(-2)!, /^┃  第二段/);
		assert.doesNotMatch(plainUser.join("\n"), /YOU/);
		assert.ok(plainUser.some((line) => /^┃ +$/.test(line)), "paragraph blank remains inside the rail");
		assert.ok(compactUser[0]!.startsWith("\x1b]133;A\x07"));
		assert.ok(compactUser.at(-1)!.includes("\x1b]133;B\x07\x1b]133;C\x07"));
		const compactTool = first.render(80).map(stripTerminalSequences);
		assert.equal(compactTool[0], "", "host-owned gap is unpainted");
		assert.ok(compactTool.slice(1).every((line: string) => line.startsWith("┃ ")));
		assert.equal(normalTool.length - compactTool.length, 3, "remove outer tool padding and successful output preview");
		assert.doesNotMatch(compactTool.join("\n"), /file output/);
		assert.deepEqual(assistant.render(80), assistantBefore);
		assert.equal(assistant.render, nativeAssistant);
		const lines: string[] = chat.render(80).map(stripTerminalSequences);
		for (const token of ["read file.txt", "future-tool", "正常回复"]) {
			const index = lines.findIndex((line) => line.includes(token));
			assert.ok(index > 0);
			assert.equal(lines[index - 1]!.trim(), "", `one gap before ${token}`);
			assert.notEqual(lines[index - 2]!.trim(), "", "not stacked blank margins");
		}
		for (const width of [1, 2, 7, 12, 22, 80]) {
			assert.ok(user.render(width).every((line: string) => visibleWidth(line) <= width));
			frame(first, width); frame(second, width);
		}
		first.setExpanded(true); assert.match(frame(first), /file output/);
		f.config.toolPresentation = false;
		assert.match(frame(first), /┃/); assert.doesNotMatch(frame(first), /ok read/);
		f.config.messageLayout = "normal"; adapter.refresh();
		assert.equal(user.render, nativeUser); assert.deepEqual(user.render(80), userBefore);
		assert.doesNotMatch(frame(first), /┃/);
		f.config.messageLayout = "compact"; adapter.refresh();
		f.config.enabled = false; adapter.refresh();
		assert.equal(user.render, nativeUser); assert.deepEqual(user.render(80), userBefore);
		assert.doesNotMatch(frame(first), /┃/);
		assert.deepEqual(warnings, []);
	});
}

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: compact skill cards use an accent rail without shell background or vertical padding`, async (t) => {
		const f = await fixture(t, mode);
		const block = { name: "demo-skill", content: "first paragraph\n\nsecond paragraph" };
		const skill = new SkillInvocationMessageComponent(block);
		const user = new UserMessageComponent("separate user body");
		const chat = new Container();
		chat.addChild(skill); chat.addChild(new Spacer(1)); chat.addChild(user);
		if (f.tui instanceof TuiAltScreen) f.tui.setLayoutRoot(new VStack([new ScrollView(chat, { primary: true })]));
		else f.tui.addChild(chat);
		const nativeRender = skill.render;
		const nativeMouse = skill.handleMouse;
		const warnings: string[] = [];
		const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => warnings.push("fallback"));
		t.after(() => { adapter.cleanup(); initTheme("dark"); });
		assert.equal(skill.render, nativeRender, "normal mode is not patched");
		f.config.messageLayout = "compact"; adapter.refresh();
		for (const theme of ["dark", "light"] as const) {
			initTheme(theme);
			for (const icons of ["unicode", "ascii", "nerd"] as const) {
				f.config.icons.mode = icons;
				const glyph = icons === "ascii" ? "|" : "┃";
				const accent = styledRuns(hostTheme.theme.fg("accent", glyph))[0]!.fg;
				assert.notEqual(accent, styledRuns(hostTheme.theme.fg("userMessageText", glyph))[0]!.fg);
				for (const expanded of [false, true]) {
					skill.setExpanded(expanded); skill.invalidate();
					const native: string[] = nativeRender.call(skill, 78);
					const children = skill.children;
					const lines: string[] = skill.render(80);
					const plain = lines.map(stripTerminalSequences);
					assert.equal(lines.length, native.length - 2, "removes exactly the shell's top/bottom rows");
					assert.deepEqual(plain, native.slice(1, -1).map((line: string) => `${glyph} ${stripTerminalSequences(line)}`), "preserves native content and interior gaps");
					assert.match(plain[0]!, new RegExp(`^[${glyph}]  \\[skill\\]`));
					assert.ok(plain.at(-1)!.trim() !== glyph, "no trailing shell padding");
					for (const line of lines) {
						const runs = styledRuns(line);
						assert.equal(runs[0]!.text, `${glyph} `);
						assert.equal(runs[0]!.fg, accent);
						assert.ok(runs.every((run) => run.bg === "default"), "no full-card background");
					}
					assert.equal(skill.children, children, "keeps the actual native MouseRegion/content");
					if (expanded) assert.ok(plain.some((line) => line.trim() === glyph), "interior paragraph blanks remain");
					else assert.match(plain[0]!, /demo-skill.*to expand/);
					for (const width of [0, 1, 2, 3, 4, 7, 12, 22, 80]) {
						assert.ok(skill.render(width).every((line: string) => visibleWidth(line) <= width), `no overflow at ${width}`);
					}
				}
			}
		}
		skill.setExpanded(false); f.config.icons.mode = "unicode";
		const before: string[] = skill.render(80);
		skill.setOutputPad(3);
		assert.deepEqual(skill.render(80), before, "compact inset does not depend on native output padding");
		assert.equal(skill.paddingX, 3, "does not mutate native padding");
		assert.equal(skill.paddingY, 1);
		assert.equal(typeof skill.bgFn, "function");
		const transcript: string[] = chat.render(80).map(stripTerminalSequences);
		assert.equal(transcript[before.length], "", "host-owned message gap remains unpainted");
		assert.deepEqual(block, { name: "demo-skill", content: "first paragraph\n\nsecond paragraph" });
		f.config.messageLayout = "normal";
		assert.deepEqual(skill.render(80), nativeRender.call(skill, 80), "immediate normal fallback before scan");
		adapter.refresh();
		assert.equal(skill.render, nativeRender); assert.equal(skill.handleMouse, nativeMouse);
		f.config.messageLayout = "compact"; adapter.refresh();
		f.config.enabled = false; adapter.refresh();
		assert.equal(skill.render, nativeRender); assert.equal(skill.handleMouse, nativeMouse);
		f.config.enabled = true; adapter.refresh();
		adapter.cleanup(); adapter.cleanup();
		assert.equal(skill.render, nativeRender); assert.equal(skill.handleMouse, nativeMouse);
		assert.equal(Object.hasOwn(skill, "render"), false);
		assert.equal(Object.hasOwn(skill, "handleMouse"), false);
		assert.deepEqual(warnings, []);
	});

	test(`${mode}: compact skill cards retain native click/expansion behavior and code whitespace`, async (t) => {
		const f = await fixture(t, mode);
		f.config.messageLayout = "compact";
		const skill = new SkillInvocationMessageComponent({ name: "click-skill", content: "```text\n  indent\n\n  end\n```\n\nlast paragraph" });
		const chat = new Container(); chat.addChild(skill);
		if (f.tui instanceof TuiAltScreen) f.tui.setLayoutRoot(new VStack([new ScrollView(chat, { primary: true })]));
		else f.tui.addChild(chat);
		const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => assert.fail("unexpected fallback"));
		t.after(() => adapter.cleanup());
		const event = { type: "click" as const, button: "left" as const, x: 3, y: 0, screenX: 3, screenY: 0, width: 80, height: 1, shift: false, ctrl: false, alt: false };
		assert.equal(skill.render(80).length, 1);
		assert.equal(skill.handleMouse({ ...event, x: 0 }), undefined, "rail is not an expand control");
		assert.equal(skill.expanded, false);
		assert.equal(skill.handleMouse(event)!.handled, true);
		assert.equal(skill.expanded, true);
		const expanded: string[] = skill.render(80);
		const native: string[] = SkillInvocationMessageComponent.prototype.render.call(skill, 78);
		assert.deepEqual(expanded.map(stripTerminalSequences), native.slice(1, -1).map((line: string) => `| ${stripTerminalSequences(line)}`), "code indentation and blank rows survive");
		assert.equal(skill.handleMouse({ ...event, height: expanded.length })!.handled, true);
		assert.equal(skill.expanded, false);
		assert.equal(skill.render(80).length, 1);
		// The native expansion shortcut calls setExpanded, replacing children before the next frame.
		skill.setExpanded(true);
		assert.equal(skill.handleMouse(event)!.handled, true);
		assert.equal(skill.expanded, false, "clicks route to the replacement native MouseRegion");
		skill.setExpanded(true); skill.invalidate();
		assert.match(stripTerminalSequences(skill.render(80).join("\n")), /last paragraph/);
	});
}

test("skill adaptation discovers late cards, releases detached cards and falls back on incompatible shells", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	const warnings: string[] = [];
	const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => warnings.push("fallback"));
	t.after(() => adapter.cleanup());
	const skill = new SkillInvocationMessageComponent({ name: "late-skill", content: "body" });
	const native = skill.render; const mouse = skill.handleMouse;
	const prototype = SkillInvocationMessageComponent.prototype.render;
	const sibling = new SkillInvocationMessageComponent({ name: "unmounted", content: "body" });
	f.tui.addChild(skill); f.tui.start(); f.tui.renderNow(true);
	assert.notEqual(skill.render, native, "new card discovered by host frame");
	assert.match(stripTerminalSequences(f.writes()), /\|  \[skill\] late-skill/);
	assert.equal(sibling.render, native); assert.equal(SkillInvocationMessageComponent.prototype.render, prototype);
	f.tui.removeChild(skill); adapter.refresh();
	assert.equal(skill.render, native); assert.equal(skill.handleMouse, mouse);
	const incompatible = new SkillInvocationMessageComponent({ name: "unsupported", content: "body" });
	incompatible.children = [new Text("CUSTOM SKILL", 0, 0)];
	const before = incompatible.render(80);
	f.tui.addChild(incompatible); adapter.refresh(); adapter.refresh();
	assert.equal(incompatible.render, native); assert.deepEqual(incompatible.render(80), before);
	assert.equal(warnings.length, 1, "incompatible shell warns once");
	f.tui.addChild(skill); adapter.refresh(); skill.render(80);
	skill.children = [new Text("REPLACEMENT SKILL", 0, 0)];
	assert.deepEqual(skill.render(80), native.call(skill, 80), "runtime incompatibility also keeps native shell");
	assert.equal(warnings.length, 1);
	adapter.cleanup();
	assert.equal(skill.render, native); assert.equal(skill.handleMouse, mouse);
});

test("skill adaptation rolls back a partial bind and restores cards across renderer replacement", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	const blocked = new SkillInvocationMessageComponent({ name: "locked-mouse", content: "body" });
	const native = blocked.render; const mouse = blocked.handleMouse;
	Object.defineProperty(blocked, "handleMouse", { value: mouse, configurable: false });
	const oldSkill = new SkillInvocationMessageComponent({ name: "old-renderer", content: "body" });
	const newSkill = new SkillInvocationMessageComponent({ name: "new-renderer", content: "body" });
	const { createInteractiveTuiReference } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/tui-renderer.js")).href);
	let live = f.tui;
	const reference = createInteractiveTuiReference(() => live);
	live.addChild(blocked); live.addChild(oldSkill);
	const warnings: string[] = [];
	const adapter = installUserMessageLayout(reference, () => f.config, () => hostTheme.theme, () => warnings.push("fallback"));
	t.after(() => { adapter.cleanup(); live.stop(); });
	assert.equal(blocked.render, native, "failed mouse patch rolls back the render patch");
	assert.equal(Object.hasOwn(blocked, "render"), false);
	assert.equal(blocked.handleMouse, mouse); assert.equal(warnings.length, 1);
	assert.notEqual(oldSkill.render, native, "other cards remain adaptable");
	oldSkill.render(80);
	const old = live;
	live = new TuiAltScreen(f.terminal);
	live.setLayoutRoot(new VStack([new ScrollView(new VStack([newSkill]), { primary: true })]));
	adapter.refresh();
	assert.equal(oldSkill.render, native); assert.equal(oldSkill.handleMouse, mouse);
	assert.notEqual(newSkill.render, native);
	assert.equal(newSkill.render(80).length, 1);
	assert.equal(SkillInvocationMessageComponent.prototype.render, native);
	adapter.cleanup();
	assert.equal(newSkill.render, native); assert.equal(newSkill.handleMouse, mouse);
	assert.equal(Object.hasOwn(newSkill, "render"), false);
	assert.equal(Object.hasOwn(newSkill, "handleMouse"), false);
	old.stop();
});

test("User adaptation preserves native Markdown transforms, code whitespace, themes and rebuilds", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	const widths: number[] = [];
	const user = new UserMessageComponent("before\n\n```text\n  indent\n\n  end\n```", undefined, 2, [
		(text: string, context: { availableWidth: number; messageType: string }) => {
			assert.equal(context.messageType, "user"); widths.push(context.availableWidth); return text.replace("before", "after");
		},
	]);
	f.tui.addChild(user);
	const originalChildren = user.children;
	const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => assert.fail("unexpected fallback"));
	t.after(() => { adapter.cleanup(); initTheme("dark"); });
	const nativeRender = UserMessageComponent.prototype.render;
	for (const theme of ["dark", "light"] as const) {
		initTheme(theme); user.invalidate();
		const lines: string[] = user.render(80);
		assert.match(stripTerminalSequences(lines.join("\n")), /after/);
		assert.ok(widths.includes(77), "transform gets actual body width, not full terminal width");
		assert.ok(lines.every((line) => visibleWidth(line) <= 80));
		assert.equal(user.children, originalChildren, "keeps real native Markdown");
		const raw: string[] = nativeRender.call(user, 81);
		const expectedBody = raw.slice(1, -1).map((line: string) => stripTerminalSequences(line).slice(2, 79));
		const actualBody = lines.slice(1, -1).map((line) => stripTerminalSequences(line).slice(3));
		assert.deepEqual(actualBody, expectedBody, "retain code and interior blank rows exactly");
	}
	user.setOutputPad(0); assert.match(stripTerminalSequences(user.render(80).join("\n")), /after/);
	const rebuilt = user.children[0];
	assert.ok(rebuilt instanceof Markdown);
	adapter.cleanup(); adapter.cleanup();
	assert.equal(user.render, nativeRender);
	assert.equal(Object.hasOwn(user, "render"), false);
});

test("User adaptation discovers streamed/history components, releases detached users and fails safely", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	const warnings: string[] = [];
	const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => warnings.push("fallback"));
	t.after(() => adapter.cleanup());
	const user = new UserMessageComponent("late history");
	const native = user.render;
	f.tui.addChild(user);
	f.tui.start(); f.tui.renderNow(true);
	assert.notEqual(user.render, native, "discovered before a real host frame");
	assert.match(stripTerminalSequences(f.writes()), /\|  late history/);
	assert.doesNotMatch(stripTerminalSequences(f.writes()), /YOU/);
	f.tui.removeChild(user); adapter.refresh();
	assert.equal(user.render, native, "detached history does not stay retained/patched");
	const incompatible = new UserMessageComponent("unsupported");
	incompatible.children = [new Text("CUSTOM USER", 0, 0)];
	const before = incompatible.render(80);
	f.tui.addChild(incompatible); adapter.refresh(); adapter.refresh();
	assert.deepEqual(incompatible.render(80), before); assert.equal(warnings.length, 1);
	const unsupported = installUserMessageLayout({} as never, () => f.config, () => hostTheme.theme, () => warnings.push("missing host"));
	unsupported.refresh(); unsupported.cleanup();
	assert.equal(warnings.length, 2, "missing host warns once without throwing");
});

test("User adapter rebinds Pi's stable reference and never patches prototypes or another TUI", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	const { createInteractiveTuiReference } = await import(pathToFileURL(join(getPackageDir(), "dist/modes/interactive/tui-renderer.js")).href);
	let live = f.tui;
	const reference = createInteractiveTuiReference(() => live);
	const a = new UserMessageComponent("old"); const b = new UserMessageComponent("new");
	live.addChild(a);
	const original = a.render; const prototype = UserMessageComponent.prototype.render;
	const nativeFrame = Reflect.get(live, "doRender");
	const adapter = installUserMessageLayout(reference, () => f.config, () => hostTheme.theme, () => assert.fail("unexpected fallback"));
	t.after(() => adapter.cleanup());
	const old = live;
	live = new TuiAltScreen(f.terminal);
	live.setLayoutRoot(new VStack([new ScrollView(new VStack([b]), { primary: true })]));
	adapter.refresh();
	assert.equal(a.render, original); assert.equal(Reflect.get(old, "doRender"), nativeFrame);
	assert.notEqual(b.render, original); assert.equal(UserMessageComponent.prototype.render, prototype);
	adapter.cleanup();
	assert.equal(b.render, original);
	assert.equal(Object.getOwnPropertySymbols(live).some((symbol) => symbol.description === "open-tui-user-layout"), false);
});

test("message rail preserves opaque image rows and routes child coordinates, focus and input", () => {
	const events: Array<{ x: number; width: number }> = [];
	const image = "\x1b_Gpayload\x1b\\";
	const child: Component = {
		render: () => [image, "control"], invalidate() {},
		handleMouse(event) { events.push(event); return { handled: true, focus: true }; },
		handleInput() {},
	};
	const rail = new MessageRail(child, (text) => text);
	const lines = rail.render(30);
	assert.equal(lines[0], image); assert.equal(lines[1], "┃ control");
	const event = { type: "click" as const, button: "left" as const, x: 4, y: 1, screenX: 4, screenY: 1, width: 30, height: 2, shift: false, ctrl: false, alt: false };
	const handled = rail.handleMouse(event)!;
	assert.equal(handled.target.component, child); assert.equal(handled.focus, true);
	assert.equal(events[0]!.x, 2); assert.equal(events[0]!.width, 28);
	assert.equal(rail.handleMouse({ ...event, x: 0 }), undefined);
});

test("resolveBorderGlyphs includes matching right edges and corners for every preset", () => {
	for (const [style, top, left, tl, bl, tr, br] of [
		["single", "─", "│", "┌", "└", "┐", "┘"],
		["bold", "━", "┃", "┏", "┗", "┓", "┛"],
		["double", "═", "║", "╔", "╚", "╗", "╝"],
		["dashed", "┄", "┆", "┌", "└", "┐", "┘"],
	] as const) {
		assert.deepEqual(resolveBorderGlyphs(style, false), { top, bottom: top, left, right: left, topLeft: tl, bottomLeft: bl, topRight: tr, bottomRight: br });
		const h = style === "bold" || style === "double" ? "=" : "-";
		assert.deepEqual(resolveBorderGlyphs(style, true), { top: h, bottom: h, left: "|", right: "|", topLeft: "+", bottomLeft: "+", topRight: "+", bottomRight: "+" });
	}
});

test("ToolBoxFrame renders 3-sided open box, handles edge toggles, and routes mouse events", () => {
	const events: Array<{ x: number; y: number; width: number }> = [];
	const child: Component = {
		render: () => ["line 1", "line 2"],
		invalidate() {},
		handleMouse(event) { events.push(event); return { handled: true, focus: true }; },
	};
	const frame = new ToolBoxFrame(child, {
		top: true,
		bottom: true,
		left: true,
		topChar: "─",
		topLeftChar: "┌",
		leftChar: "│",
		bottomChar: "─",
		bottomLeftChar: "└",
		paint: (s) => s,
	});
	const lines = frame.render(20);
	assert.equal(lines.length, 4);
	assert.ok(lines[0]!.startsWith("┌────"));
	assert.equal(lines[1], "│ line 1");
	assert.equal(lines[2], "│ line 2");
	assert.ok(lines[3]!.startsWith("└────"));
	assert.ok(lines.every((l) => visibleWidth(l) <= 20));

	// Mouse click on top border (y = 0) is absorbed
	assert.equal(frame.handleMouse({ type: "click", button: "left", x: 5, y: 0, screenX: 5, screenY: 0, width: 20, height: 4, shift: false, ctrl: false, alt: false }), undefined);
	// Mouse click on left rail (x = 0) is absorbed
	assert.equal(frame.handleMouse({ type: "click", button: "left", x: 0, y: 1, screenX: 0, screenY: 1, width: 20, height: 4, shift: false, ctrl: false, alt: false }), undefined);
	// Mouse click on child (x = 5, y = 1) is translated to x = 3, y = 0
	frame.handleMouse({ type: "click", button: "left", x: 5, y: 1, screenX: 5, screenY: 1, width: 20, height: 4, shift: false, ctrl: false, alt: false });
	assert.equal(events.length, 1);
	assert.equal(events[0]!.x, 3);
	assert.equal(events[0]!.y, 0);

	// Edge toggling: only top and left
	const noBottom = new ToolBoxFrame(child, {
		top: true,
		bottom: false,
		left: true,
		topChar: "─",
		topLeftChar: "┌",
		leftChar: "│",
		bottomChar: "─",
		bottomLeftChar: "└",
		paint: (s) => s,
	});
	const noBottomLines = noBottom.render(20);
	assert.equal(noBottomLines.length, 3);
	assert.ok(noBottomLines[0]!.startsWith("┌────"));
	assert.equal(noBottomLines[1], "│ line 1");
	assert.equal(noBottomLines[2], "│ line 2");
});

test("tool execution renders configurable box borders across styles, edge toggles, and status colors", async (t) => {
	const f = await fixture(t);
	f.config.icons.mode = "unicode";
	f.config.toolBoxBorder = {
		enabled: true,
		style: "single",
		colorMode: "status",
		top: { enabled: true },
		bottom: { enabled: true },
		left: { enabled: true },
	};
	const card = f.component("read", "box-border-test", { path: "test.txt" });
	const initialLines = card.render(80);
	const initialText = stripTerminalSequences(initialLines.join("\n"));
	// Running state: top border + left rail + bottom border rendered
	assert.match(initialText, /^┌─+/m);
	assert.match(initialText, /│\s+/m);
	assert.match(initialText, /└─+/m);
	assert.ok(initialLines.every((l: string) => visibleWidth(l) <= 80));

	// Complete tool: success state
	card.updateResult(result("success output"));
	const completedLines = card.render(80);
	const completedText = stripTerminalSequences(completedLines.join("\n"));
	assert.match(completedText, /^┌─+/m);
	assert.match(completedText, /│\s+/m);
	assert.match(completedText, /└─+/m);
	assert.ok(completedLines.every((l: string) => visibleWidth(l) <= 80));

	// Double line style
	f.config.toolBoxBorder.style = "double";
	const doubleLines = card.render(80);
	const doubleText = stripTerminalSequences(doubleLines.join("\n"));
	assert.match(doubleText, /^╔═+/m);
	assert.match(doubleText, /║\s+/m);
	assert.match(doubleText, /╚═+/m);

	// Bold style
	f.config.toolBoxBorder.style = "bold";
	const boldLines = card.render(80);
	const boldText = stripTerminalSequences(boldLines.join("\n"));
	assert.match(boldText, /^┏━+/m);
	assert.match(boldText, /┃\s+/m);
	assert.match(boldText, /┗━+/m);

	// Custom characters override
	f.config.toolBoxBorder.style = "custom";
	f.config.toolBoxBorder.top.char = "~";
	f.config.toolBoxBorder.left.char = "!";
	f.config.toolBoxBorder.bottom.char = "=";
	const customLines = card.render(80);
	const customText = stripTerminalSequences(customLines.join("\n"));
	assert.match(customText, /^~+/m);
	assert.match(customText, /!\s+/m);
	assert.match(customText, /^=+/m);

	// Selective edge toggling: disable bottom
	f.config.toolBoxBorder.bottom.enabled = false;
	const noBottomLines = card.render(80);
	const noBottomText = stripTerminalSequences(noBottomLines.join("\n"));
	assert.match(noBottomText, /^~+/m);
	assert.doesNotMatch(noBottomText, /^=+/m);

	// ASCII mode check
	f.config.icons.mode = "ascii";
	f.config.toolBoxBorder.style = "single";
	f.config.toolBoxBorder.top.char = undefined;
	f.config.toolBoxBorder.left.char = undefined;
	f.config.toolBoxBorder.bottom.char = undefined;
	f.config.toolBoxBorder.bottom.enabled = true;
	const asciiLines = card.render(80);
	const asciiText = stripTerminalSequences(asciiLines.join("\n"));
	assert.match(asciiText, /^\+-+/m);
	assert.match(asciiText, /\|\s+/m);
	assert.match(asciiText, /^\+-+/m);
});

test("four-edge frames preserve images, align columns, and route only body clicks", () => {
	const image = "\x1b_Gpayload\x1b\\";
	const events: Array<{ x: number; y: number; width: number }> = [];
	const child: Component = { render: () => ["界 é 👩‍💻", image, "short"], invalidate() {}, handleMouse(event) { events.push(event); return { handled: true, focus: true }; } };
	for (let mask = 0; mask < 16; mask++) {
		const border = { ...structuredClone(DEFAULT_USER_BORDER), enabled: true, style: "double" as const,
			top: { enabled: !!(mask & 1) }, bottom: { enabled: !!(mask & 2) },
			left: { enabled: !!(mask & 4) }, right: { enabled: !!(mask & 8) } };
		const frame = new ToolBoxFrame(child, borderFrameOptions(border, false, (s) => s));
		for (const width of [0, 1, 2, 3, 4, 5, 12, 40]) {
			const lines = frame.render(width);
			assert.ok(lines.every((line) => line === image || visibleWidth(line) <= width), `${mask}/${width}`);
			if (width >= 5 && border.right.enabled) for (const line of lines) {
				if (line !== image) assert.equal(visibleWidth(line), width, "right edge stays at the frame width");
			}
			if (width) assert.ok(lines.includes(image), "opaque image payload is untouched");
		}
	}
	const border = { ...structuredClone(DEFAULT_USER_BORDER), enabled: true, top: { enabled: true }, bottom: { enabled: true }, right: { enabled: true, char: "#" } };
	const frame = new ToolBoxFrame(child, borderFrameOptions(border, false, (s) => s));
	const lines = frame.render(20);
	assert.ok(lines[1]!.endsWith("#")); assert.equal(lines[2], image);
	const event = { type: "click" as const, button: "left" as const, x: 5, y: 1, screenX: 5, screenY: 1, width: 20, height: lines.length, shift: false, ctrl: false, alt: false };
	assert.equal(frame.handleMouse({ ...event, y: 0 }), undefined);
	assert.equal(frame.handleMouse({ ...event, y: lines.length - 1 }), undefined);
	assert.equal(frame.handleMouse({ ...event, x: 19 }), undefined);
	assert.equal(frame.handleMouse({ ...event, x: 0 }), undefined);
	assert.equal(frame.handleMouse(event)!.handled, true);
	assert.deepEqual(events.at(-1), { ...event, x: 3, y: 0, width: 16, height: 3 });
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: independent User/Skill frames retain interactions and do not control Tool output`, async (t) => {
		const f = await fixture(t, mode);
		Object.assign(f.config, structuredClone(NEW_DEFAULT_CONFIG));
		f.config.icons.mode = "unicode";
		const user = new UserMessageComponent("中文 body\n\n```text\n  whitespace\n```");
		const skill = new SkillInvocationMessageComponent({ name: "framed-skill", content: "first\n\n```text\n  skill code\n```" });
		const chat = new Container(); chat.addChild(user); chat.addChild(skill);
		if (f.tui instanceof TuiAltScreen) f.tui.setLayoutRoot(new VStack([new ScrollView(chat, { primary: true })]));
		else f.tui.addChild(chat);
		const nativeUser = user.render; const nativeSkill = skill.render;
		const adapter = installUserMessageLayout(f.tui, () => f.config, () => hostTheme.theme, () => assert.fail("unexpected fallback"));
		t.after(() => adapter.cleanup());
		const tool = f.component("read", "independent-output", { path: "file" });
		tool.updateResult(result("SUCCESS PREVIEW"));
		assert.doesNotMatch(frame(tool), /SUCCESS PREVIEW/);
		const toolBefore = tool.render(60);
		assert.match(stripTerminalSequences(user.render(60).join("\n")), /^┃/);
		assert.match(stripTerminalSequences(skill.render(60).join("\n")), /^┃/);
		f.config.userMessageLayout = "normal"; adapter.refresh();
		assert.equal(user.render, nativeUser); assert.equal(skill.render, nativeSkill);
		assert.deepEqual(tool.render(60), toolBefore, "User selection must not reveal Tool previews or change its rail");
		f.config.userBoxBorder = { ...structuredClone(DEFAULT_USER_BORDER), enabled: true, style: "double", top: { enabled: true }, bottom: { enabled: true }, right: { enabled: true } };
		adapter.refresh();
		for (const width of [5, 12, 60]) for (const component of [user, skill]) {
			const lines: string[] = component.render(width);
			assert.ok(lines.every((line) => visibleWidth(line) === width));
			assert.match(stripTerminalSequences(lines[0]!), /^╔═*╗$/);
			assert.match(stripTerminalSequences(lines.at(-1)!), /^╚═*╝$/);
		}
		const event = { type: "click" as const, button: "left" as const, x: 3, y: 1, screenX: 3, screenY: 1, width: 60, height: skill.render(60).length, shift: false, ctrl: false, alt: false };
		assert.equal(skill.handleMouse({ ...event, x: 59 }), undefined); assert.equal(skill.expanded, false);
		assert.equal(skill.handleMouse(event)!.handled, true); assert.equal(skill.expanded, true);
		assert.match(stripTerminalSequences(skill.render(60).join("\n")), /skill code/);
		skill.setExpanded(false); // Replaces MouseRegion before the next frame.
		assert.equal(skill.handleMouse(event)!.handled, true); assert.equal(skill.expanded, true);
		const userBefore = user.render(60); const skillBefore = skill.render(60);
		f.config.toolMessageLayout = "normal";
		assert.match(frame(tool), /SUCCESS PREVIEW/, "Tool preview uses only its own layout");
		f.config.toolBoxBorder.enabled = true; f.config.toolBoxBorder.right = { enabled: true }; f.config.toolBoxBorder.bottom.enabled = true;
		const plain = stripTerminalSequences(tool.render(60).join("\n")).split("\n").filter((line) => line);
		assert.equal(plain.filter((line) => line.startsWith("╔")).length, 1);
		assert.equal(plain.filter((line) => line.startsWith("╚")).length, 1);
		assert.ok(plain.every((line) => visibleWidth(line) === 60));
		assert.deepEqual(user.render(60), userBefore); assert.deepEqual(skill.render(60), skillBefore);
		f.config.userBoxBorder.colorMode = "static"; f.config.userBoxBorder.color = "accent";
		const accent = styledRuns(hostTheme.theme.fg("accent", "║"))[0]!.fg;
		assert.equal(styledRuns(user.render(60)[1]!)[0]!.fg, accent);
		f.config.enabled = false; adapter.refresh();
		assert.equal(user.render, nativeUser); assert.equal(skill.render, nativeSkill);
	});
}

test("Tool rail colors are configurable without activating a frame and legacy dormant colors stay inactive", async (t) => {
	const f = await fixture(t);
	f.config.messageLayout = "compact";
	f.config.icons.mode = "unicode";
	f.config.toolBoxBorder.colorMode = "static";
	f.config.toolBoxBorder.color = "accent";
	const tool = f.component("read", "rail-color", { path: "file" });
	tool.updateResult(result("SUCCESS"));
	const railColor = () => styledRuns(tool.render(60).find((line: string) => stripTerminalSequences(line).startsWith("┃"))!)[0]!.fg;
	const success = styledRuns(hostTheme.theme.fg("success", "┃"))[0]!.fg;
	const accent = styledRuns(hostTheme.theme.fg("accent", "┃"))[0]!.fg;
	assert.equal(railColor(), success, "a legacy disabled box retains its status rail");
	f.config.toolMessageLayout = "compact";
	assert.equal(railColor(), accent, "independent Tool colors affect the selected rail");
	assert.equal(f.config.toolBoxBorder.enabled, false);
	f.config.toolBoxBorder.colorMode = "status";
	assert.equal(railColor(), success);
});
