import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import type {
	ExtensionContext,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { installFooter, shortHostname } from "../src/footer.ts";
import { OpenTuiEditor } from "../src/editor.ts";
import { fitStatusRow } from "../src/extension-status-layout.ts";
import { emptyGitStatus, readGitStatus } from "../src/git.ts";
import { detectNerdFont, resolveGlyphs, resolveIconMode, runtimeSymbol } from "../src/icons.ts";
import { clearRuntimeCache, readRuntimeInfo } from "../src/runtime.ts";
import { getModelMeta, getUsageTotals, invalidateUsageCache, type FooterState } from "../src/state.ts";
import {
	fitSegmentsByPriority,
	sanitizeStatusPreservingStyles,
	stripAnsi,
	truncateBranch,
	truncatePath,
} from "../src/utils.ts";

const theme = {
	fg: (_color: string, text: string) => text,
} as Theme;

test("reads Git status from a nested repository directory", async () => {
	const root = mkdtempSync(join(tmpdir(), "open-tui-git-"));
	const nested = join(root, "packages", "app");
	try {
		execFileSync("git", ["init", "-b", "nested-repo-test"], { cwd: root });
		execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "init"], { cwd: root });
		mkdirSync(nested, { recursive: true });

		assert.equal((await readGitStatus(nested)).branch, "nested-repo-test");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("branch truncation preserves the branch prefix", () => {
	assert.equal(truncateBranch("fix/cwd-footer-truncation", 20), "fix/cwd-footer-tr...");
	assert.equal(truncateBranch("main", 20), "main");
});

test("cwd path truncation keeps head and tail segments", () => {
	assert.equal(truncatePath("~/projects/pi-open-tui", 30), "~/projects/pi-open-tui");
	assert.equal(truncatePath("~/projects/pi-open-tui", 18), "~/.../pi-open-tui");
});

test("cwd path truncation measures display width, not code units", () => {
	const wide = "示例项目";
	assert.equal(visibleWidth(wide), 8);

	for (const budget of [5, 6, 7]) {
		const out = truncatePath(wide, budget);
		assert.ok(visibleWidth(out) <= budget, `width ${visibleWidth(out)} exceeds ${budget}`);
	}
});

type FitScenario = { maxW: number; segments: Array<{ text: string; priority: number; truncate?: "path" | "noop" }> };

function parseFitOutput(value: string): string[][] {
	const parsed: unknown = JSON.parse(value);
	if (!Array.isArray(parsed) || !parsed.every((row) => Array.isArray(row) && row.every((item) => typeof item === "string"))) {
		throw new Error("footer child process returned invalid output");
	}
	return parsed as string[][];
}

// An unfixed fit loop does not fail fast: it spins on the main thread, so a plain
// in-process assertion would hang the whole suite instead of reporting a failure.
// Run each case in a child process with a timeout so the regression is loud.
function runFitInChild(scenarios: readonly FitScenario[]): string[][] {
	const script = `
		import { fitSegmentsByPriority, truncatePath } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, "..", "src", "utils.ts")).href)};
		const scenarios = ${JSON.stringify(scenarios)};
		const out = scenarios.map((s) => {
			const segs = s.segments.map((seg) => {
				if (seg.truncate === "path") return { ...seg, truncate: (text, maxWidth) => truncatePath(text, maxWidth) };
				if (seg.truncate === "noop") return { ...seg, truncate: (text) => text };
				return seg;
			});
			return fitSegmentsByPriority(segs, s.maxW);
		});
		console.log(JSON.stringify(out));
	`;
	try {
		const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
			encoding: "utf8",
			timeout: 15_000,
		});
		return parseFitOutput(output.trim());
	} catch (error) {
		const { code, signal } = error as { code?: string; signal?: string };
		if (code === "ETIMEDOUT" || signal === "SIGTERM") {
			throw new Error("footer layout did not terminate (timed out after 15s)");
		}
		throw error;
	}
}

test("footer layout terminates and drops unshrinkable segments", () => {
	const [fitted, dropped] = runFitInChild([
		{
			maxW: 10,
			segments: [
				{ text: "示例项目", priority: 0, truncate: "path" },
				{ text: "ctx", priority: 4 },
			],
		},
		{
			maxW: 12,
			segments: [
				{ text: "wide-----segment", priority: 0, truncate: "noop" },
				{ text: "keep", priority: 4 },
			],
		},
	]);
	assert.ok(visibleWidth(fitted!.join(" ")) <= 10);
	assert.deepEqual(dropped, ["keep"]);
});

test("footer compacts cwd before truncating lower-priority segments", () => {
	assert.deepEqual(
		fitSegmentsByPriority(
			[
				{ text: "@ ~/projects/pi-open-tui", compactText: "@ pi-open-tui", priority: 0 },
				{ text: "* fix/cwd-footer-truncation", priority: 3 },
				{ text: "node 24.6.0", priority: 4 },
			],
			53,
		),
		["@ pi-open-tui", "* fix/cwd-footer-truncation", "node 24.6.0"],
	);
});

test("narrow footer compacts cwd to its basename before shedding segments", () => {
	let footerFactory: NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]> | undefined;
	const ctx = {
		model: { provider: "openai", contextWindow: 1_000 },
		ui: {
			setFooter(factory: typeof footerFactory) {
				footerFactory = factory;
			},
		},
		sessionManager: {
			getCwd: () => "/work/projects/pi-open-tui",
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		getContextUsage: () => ({ tokens: 0, contextWindow: 1_000, percent: 0 }),
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	const state: FooterState = {
		git: { ...emptyGitStatus(), branch: "main" },
		runtime: { name: "nodejs", version: "24.6.0" },
		workingSince: undefined,
		lastRun: undefined,
	};
	installFooter(
		ctx,
		() => state,
		() => config,
		() => ({ provider: "OpenAI", model: "gpt-5", effort: "off" }),
		{ setRequestRender() {}, scheduleGitRefresh() {} },
	);
	assert.ok(footerFactory);
	const footerData = {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map(),
	} as unknown as ReadonlyFooterDataProvider;
	const component = footerFactory(
		{ requestRender() {} } as TUI,
		theme,
		footerData,
	) as Component;
	// Width 59: the full cwd does not fit alongside git+runtime+context bar.
	// The footer compacts the cwd to its basename before dropping segments.
	const out = component.render(59).join("\n");
	assert.ok(out.includes("pi-o"), `cwd basename prefix missing\n${out}`);
	assert.ok(!out.includes("~/work/projects"), `full cwd should be compacted\n${out}`);
});

test("narrow footer compacts context before truncating segments", () => {
	let footerFactory: NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]> | undefined;
	const ctx = {
		model: { provider: "openai", contextWindow: 1_000 },
		ui: {
			setFooter(factory: typeof footerFactory) {
				footerFactory = factory;
			},
		},
		sessionManager: {
			getCwd: () => "/work/project",
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		getContextUsage: () => ({ tokens: 250, contextWindow: 1_000, percent: 25 }),
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	const state: FooterState = {
		git: { ...emptyGitStatus(), branch: "main" },
		runtime: null,
		workingSince: undefined,
		lastRun: undefined,
	};
	installFooter(
		ctx,
		() => state,
		() => config,
		() => ({ provider: "OpenAI", model: "gpt-5", effort: "off" }),
		{ setRequestRender() {}, scheduleGitRefresh() {} },
	);
	assert.ok(footerFactory);
	const footerData = {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map(),
	} as unknown as ReadonlyFooterDataProvider;
	const component = footerFactory(
		{ requestRender() {} } as TUI,
		theme,
		footerData,
	) as Component;

	// Roomy width: full bar with tokens is right-aligned on line 1.
	const wide = component.render(120).join("\n").split("\n")[0]!;
	assert.ok(wide.includes("250/1.0k"), `full context missing\n${wide}`);

	// Narrow: bar + tokens compact to just icon + pct, cwd survives.
	const narrow = component.render(40).join("\n").split("\n")[0]!;
	assert.ok(narrow.includes("25.0%"), `compact pct missing\n${narrow}`);
	assert.ok(!narrow.includes("250/1.0k"), `token counts should be compacted\n${narrow}`);
	assert.ok(narrow.includes("project"), `cwd should survive\n${narrow}`);

	// Extremely narrow: the context segment is truncated to nothing useful
	// once it no longer fits even alone (everything else is already gone).
	const tiny = component.render(6).join("\n").split("\n")[0]!;
	assert.ok(!tiny.includes("25.0%"), `context should be dropped\n${tiny}`);
});

test("provides inline footer content without duplicating native rows", () => {
	let footerFactory: NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]> | undefined;
	const ctx = {
		model: { provider: "openai", contextWindow: 1_000 },
		ui: {
			setFooter(factory: typeof footerFactory) {
				footerFactory = factory;
			},
		},
		sessionManager: {
			getCwd: () => "/work/project",
			getEntries: () => [],
			getSessionName: () => "session-title",
		},
		getContextUsage: () => ({ tokens: 0, contextWindow: 1_000, percent: 0 }),
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = "ascii";
	const state: FooterState = {
		git: { ...emptyGitStatus(), branch: "main" },
		runtime: null,
		workingSince: undefined,
		lastRun: undefined,
	};
	const handle = installFooter(
		ctx,
		() => state,
		() => config,
		() => ({ provider: "OpenAI", model: "gpt-5", effort: "off" }),
		{ setRequestRender() {}, scheduleGitRefresh() {} },
	);
	assert.ok(footerFactory);
	const footerData = {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => new Map(),
	} as unknown as ReadonlyFooterDataProvider;
	const component = footerFactory({ requestRender() {} } as TUI, theme, footerData) as Component;

	config.footerSegments.sessionName = true;
	const inline = handle.renderInline(100);
	assert.ok(inline);
	assert.match(inline.top.left, /session-title · .*main/);
	assert.match(inline.top.right, /project \| .*0\.0%/);
	assert.ok(inline.top.right.indexOf("project") < inline.top.right.indexOf("%"));
	assert.match(inline.bottom.left, /gpt-5/);

	// The inline top border honors the same toggle as the plain footer.
	config.footerSegments.sessionName = false;
	assert.ok(!handle.renderInline(100)!.top.left.includes("session-title"));

	// Narrow: the model block is shed first, matching the plain row's alignRight.
	const narrow = handle.renderInline(30);
	assert.ok(narrow);
	assert.ok(visibleWidth(narrow.bottom.left) + visibleWidth(narrow.bottom.right) <= 30);
	assert.match(stripAnsi(narrow.bottom.right), /\$/);
	assert.match(stripAnsi(narrow.bottom.left), /\.\.\.$/);
	assert.equal(visibleWidth(handle.renderInline(visibleWidth(narrow.bottom.right) + 1)!.bottom.left), 0);

	config.inlineFooter = true;
	assert.deepEqual(component.render(40), []);
});

test("auto gates Nerd icons by TTY and UTF-8 support", () => {
	const envKeys = ["TERM_PROGRAM", "LC_TERMINAL", "WT_SESSION", "TERM", "LC_ALL", "LC_CTYPE", "LANG", "SSH_CONNECTION", "SSH_TTY"];
	const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
	const hadOwnIsTTY = Object.hasOwn(process.stdout, "isTTY");
	const originalIsTTY = process.stdout.isTTY;

	try {
		for (const key of envKeys) delete process.env[key];
		process.env.TERM = "xterm-256color";
		process.env.LANG = "C.UTF-8";
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		process.env.TERM_PROGRAM = "WezTerm";
		process.env.LANG = "C";
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
		assert.equal(resolveIconMode("auto"), "ascii");

		process.env.LANG = "C.UTF-8";
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });
		assert.equal(resolveIconMode("auto"), "nerd");

		process.env.TERM_PROGRAM = "unknown-runner";
		assert.equal(detectNerdFont(), true);

		process.env.LANG = "C";
		assert.equal(resolveIconMode("auto"), "ascii");

		process.env.LANG = "C.UTF-8";
		process.env.TERM = "dumb";
		assert.equal(resolveIconMode("auto"), "ascii");

		process.env.TERM = "xterm-256color";
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false });
		assert.equal(resolveIconMode("auto"), "ascii");
	} finally {
		for (const key of envKeys) {
			const value = originalEnv.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (hadOwnIsTTY) {
			Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
		} else {
			Reflect.deleteProperty(process.stdout, "isTTY");
		}
	}
});

test("every icon mode provides every footer semantic", () => {
	const keys = [
		"cwd",
		"host",
		"session",
		"git",
		"working",
		"done",
		"context",
		"model",
		"thinking",
		"input",
		"output",
		"cacheHit",
		"cost",
		"speed",
		"latency",
		"stall",
		"extensions",
	] as const;

	for (const mode of ["nerd", "unicode", "ascii"] as const) {
		const glyphs = resolveGlyphs(mode);
		for (const key of keys) assert.notEqual(glyphs[key], "", `${mode}.${key}`);
	}
});

test("auto falls back to unicode icons for SSH sessions", () => {
	const envKeys = ["SSH_CONNECTION", "SSH_TTY", "TERM", "LC_ALL", "LC_CTYPE", "LANG"];
	const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
	const hadOwnIsTTY = Object.hasOwn(process.stdout, "isTTY");
	const originalIsTTY = process.stdout.isTTY;

	try {
		for (const key of envKeys) delete process.env[key];
		process.env.TERM = "xterm-256color";
		process.env.LANG = "C.UTF-8";
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true });

		assert.equal(resolveIconMode("auto"), "nerd");

		process.env.SSH_CONNECTION = "10.0.0.2 51234 10.0.0.1 22";
		process.env.SSH_TTY = "/dev/pts/4";
		assert.equal(resolveIconMode("auto"), "unicode");

		// Explicit modes win over the SSH heuristic.
		assert.equal(resolveIconMode("nerd"), "nerd");
		assert.equal(resolveIconMode("unicode"), "unicode");
		assert.equal(resolveIconMode("ascii"), "ascii");
	} finally {
		for (const key of envKeys) {
			const value = originalEnv.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		if (hadOwnIsTTY) Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalIsTTY });
		else Reflect.deleteProperty(process.stdout, "isTTY");
	}
});

test("can preserve provider name casing", () => {
	const ctx = {
		model: { provider: "openAI", id: "gpt-5", reasoning: false },
	} as unknown as ExtensionContext;
	const thinkingLevel = () => "off";

	assert.equal(getModelMeta(ctx, thinkingLevel, true).provider, "OpenAI");
	assert.equal(getModelMeta(ctx, thinkingLevel, false).provider, "openAI");
});

test("uses the official Nerd Font runtime symbols", () => {
	assert.equal(runtimeSymbol("nodejs", "nerd"), "\uE718");
	assert.equal(runtimeSymbol("bun", "nerd"), "\uE76F");
	assert.equal(runtimeSymbol("bun", "ascii"), "bun");
	assert.equal(runtimeSymbol("bun", "unicode"), "bun");
});

test("unicode glyphs avoid private-use codepoints", () => {
	const glyphs = resolveGlyphs("unicode");
	for (const [key, glyph] of Object.entries(glyphs)) {
		for (const ch of glyph) {
			const cp = ch.codePointAt(0)!;
			const isPrivateUse = (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
			assert.ok(!isPrivateUse, `${key} contains private-use U+${cp.toString(16).toUpperCase()}`);
		}
	}
	assert.equal(resolveGlyphs("unicode").cwd, "\u{1F4C1}");
});

test("prefers Bun lockfiles while preserving the Node fallback", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "open-tui-runtime-"));
	try {
		writeFileSync(join(cwd, "package.json"), "{}");
		assert.equal((await readRuntimeInfo(cwd))?.name, "nodejs");

		writeFileSync(join(cwd, "package-lock.json"), "{}");
		assert.equal((await readRuntimeInfo(cwd))?.name, "nodejs");

		writeFileSync(join(cwd, "bun.lock"), "");
		assert.equal((await readRuntimeInfo(cwd))?.name, "bun");

		rmSync(join(cwd, "bun.lock"));
		writeFileSync(join(cwd, "bun.lockb"), "");
		assert.equal((await readRuntimeInfo(cwd))?.name, "bun");

		rmSync(join(cwd, "bun.lockb"));
		assert.equal((await readRuntimeInfo(cwd))?.name, "nodejs");
	} finally {
		clearRuntimeCache();
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("normalizes invalid usage totals", () => {
	const usage = {
		input: Number.POSITIVE_INFINITY,
		output: undefined,
		cacheRead: 100,
		cacheWrite: null,
		cost: { total: Number.NaN },
	};
	const ctx = {
		sessionManager: {
			getEntries: () => [{ id: "invalid-usage", timestamp: 1, type: "message", message: { role: "assistant", usage } }],
		},
	} as unknown as ExtensionContext;

	invalidateUsageCache();
	assert.deepEqual(getUsageTotals(ctx), {
		input: 0, output: 0, cacheRead: 100, cacheWrite: 0, cost: 0, latestCacheHitRate: 100,
	});
	invalidateUsageCache();
});

test("usage totals count cache-write tokens as input, matching /session's uncached figure", () => {
	// cacheWrite is fresh, near-full-price content; cacheRead is discounted repeat
	// content and stays out of "input".
	const usage = {
		input: 90,
		output: 12,
		cacheRead: 5000,
		cacheWrite: 27009,
		cost: { total: 0.01 },
	};
	const ctx = {
		sessionManager: {
			getEntries: () => [{ id: "cache-write", timestamp: 1, type: "message", message: { role: "assistant", usage } }],
		},
	} as unknown as ExtensionContext;

	invalidateUsageCache();
	const totals = getUsageTotals(ctx);
	assert.equal(totals.input, 27099);
	assert.equal(totals.cacheRead, 5000);
	invalidateUsageCache();
});

test("usage totals include tool result and summary usage", () => {
	const entries = [
		{
			id: "assistant-usage",
			timestamp: 1,
			type: "message",
			message: {
				role: "assistant",
				usage: { input: 90, output: 12, cacheRead: 5000, cacheWrite: 27009, cost: { total: 0.01 } },
			},
		},
		{
			id: "tool-usage",
			timestamp: 2,
			type: "message",
			message: {
				role: "toolResult",
				usage: { input: 40, output: 8, cacheRead: 100, cacheWrite: 20, cost: { total: 0.02 } },
			},
		},
		{
			id: "compaction-usage",
			timestamp: 3,
			type: "compaction",
			usage: { input: 7, output: 3, cacheRead: 200, cacheWrite: 5, cost: { total: 0.03 } },
		},
		{
			id: "branch-summary-usage",
			timestamp: 4,
			type: "branch_summary",
			usage: { input: 11, output: 4, cacheRead: 300, cacheWrite: 9, cost: { total: 0.04 } },
		},
	];
	const ctx = { sessionManager: { getEntries: () => entries } } as unknown as ExtensionContext;

	invalidateUsageCache();
	assert.deepEqual(getUsageTotals(ctx), {
		input: 27_191, output: 27, cacheRead: 5_600, cacheWrite: 27_043, cost: 0.1,
		latestCacheHitRate: (5000 / 32_099) * 100,
	});
	invalidateUsageCache();
});

test("ASCII footer renders icons as semantic labels", () => {
	let footerFactory: NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]> | undefined;
	const entries = [{
		id: "usage-1",
		timestamp: Date.now(),
		type: "message",
		message: {
			role: "assistant",
			usage: {
				input: 90,
				output: 12,
				cacheRead: 5000,
				cacheWrite: 27009,
				cost: { total: 0.01 },
			},
		},
	}];
	const ctx = {
		model: { provider: "openai", contextWindow: 1_000 },
		ui: {
			setFooter(factory: typeof footerFactory) {
				footerFactory = factory;
			},
		},
		sessionManager: {
			getCwd: () => "C:\\work\\project",
			getEntries: () => entries,
			getSessionName: () => undefined,
		},
		getContextUsage: () => ({ tokens: 250, contextWindow: 1_000, percent: 25 }),
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CONFIG);
	config.unifiedFooter = false; // Legacy layout retains the separate extension glyph/rows.
	config.icons.mode = "ascii";
	const state: FooterState = {
		git: { ...emptyGitStatus(), branch: "main", modified: 2 },
		runtime: { name: "nodejs", version: "24.6.0" },
		workingSince: Date.now() - 2_000,
		lastRun: undefined,
	};

	const handle = installFooter(
		ctx,
		() => state,
		() => config,
		() => ({ provider: "OpenAI", model: "gpt-5", effort: "high" }),
		{ setRequestRender() {}, scheduleGitRefresh() {} },
	);
	assert.ok(footerFactory);

	let extensionStatusReads = 0;
	const footerData = {
		onBranchChange: () => () => {},
		getExtensionStatuses: () => {
			extensionStatusReads++;
			return new Map([["goal", "goal active"]]);
		},
	} as unknown as ReadonlyFooterDataProvider;
	const component = footerFactory(
		{ requestRender() {} } as TUI,
		theme,
		footerData,
	) as Component;
	const output = component.render(160).join("\n");

	for (const expected of [
		"@",
		"* main",
		"!2",
		"node 24.6.0",
		"#",
		"M",
		"~ high",
		"↑ 32k (U 27k + R 5.0k)",
		"↓ 12",
		"c 15.6%",
		"$ $0.010",
		"& goal active",
	]) {
		assert.ok(output.includes(expected), `missing ${expected}\n${output}`);
	}
	assert.equal(extensionStatusReads, 1);
	for (const inlineFooter of [false, true]) {
		config.inlineFooter = inlineFooter;
		const assertNoTimer = () => {
			assert.doesNotMatch(component.render(160).join("\n"), /working|done/);
			assert.doesNotMatch(JSON.stringify(handle.renderInline(160)), /working|done/);
		};
		assertNoTimer();
		state.workingSince = undefined;
		state.lastRun = { outcome: "completed", elapsedMs: 2_000 };
		assertNoTimer();
		state.workingSince = Date.now() - 2_000;
		state.lastRun = undefined;
	}
	config.inlineFooter = false;
	const readsBeforeHidden = extensionStatusReads;

	config.footerSegments.extensionStatuses = false;
	const hiddenOutput = component.render(160);
	assert.equal(hiddenOutput.length, 2);
	assert.doesNotMatch(hiddenOutput.join("\n"), /goal active/);
	assert.equal(extensionStatusReads, readsBeforeHidden);
});

function createFooterFixture(opts: {
	mode?: "nerd" | "ascii";
	sessionName?: string | null;
	theme?: Theme;
	context?: Partial<Pick<ExtensionContext, "model" | "getContextUsage">>;
	getModelMeta?: Parameters<typeof installFooter>[3];
	getExtensionStatuses?: ReadonlyFooterDataProvider["getExtensionStatuses"];
} = {}) {
	let footerFactory: NonNullable<Parameters<ExtensionContext["ui"]["setFooter"]>[0]> | undefined;
	const ctx = {
		...(opts.context ?? {
			model: { provider: "openai", contextWindow: 1_000 },
			getContextUsage: () => ({ tokens: 0, contextWindow: 1_000, percent: 0 }),
		}),
		ui: {
			setFooter(factory: typeof footerFactory) {
				footerFactory = factory;
			},
		},
		sessionManager: {
			getCwd: () => "/work/project",
			getEntries: () => [],
			getSessionName: () => opts.sessionName,
		},
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CONFIG);
	config.icons.mode = opts.mode ?? "ascii";
	const state: FooterState = {
		git: emptyGitStatus(),
		runtime: null,
		workingSince: undefined,
		lastRun: undefined,
	};
	const handle = installFooter(
		ctx,
		() => state,
		() => config,
		opts.getModelMeta ?? (() => ({ provider: "OpenAI", model: "gpt-5", effort: "off" })),
		{ setRequestRender() {}, scheduleGitRefresh() {} },
	);
	assert.ok(footerFactory);
	const footerData = {
		onBranchChange: () => () => {},
		getExtensionStatuses: opts.getExtensionStatuses ?? (() => new Map()),
	} as unknown as ReadonlyFooterDataProvider;
	const component = footerFactory(
		{ requestRender() {} } as TUI,
		opts.theme ?? theme,
		footerData,
	) as Component;
	return { config, state, handle, component };
}

function renderFooterWithSession(opts: {
	sessionName?: string | null;
	mode?: "nerd" | "ascii";
	sessionNameEnabled?: boolean;
	width?: number;
}): string {
	const {
		sessionName,
		mode = "ascii",
		sessionNameEnabled = true,
		width = 160,
	} = opts;
	const { config, component } = createFooterFixture({
		mode,
		sessionName: sessionName === undefined ? "test-session" : sessionName,
	});
	config.footerSegments.sessionName = sessionNameEnabled;
	return component.render(width).join("\n");
}

test("footer shows session name next to cwd when set", () => {
	const out = renderFooterWithSession({ sessionName: "my-session" });
	assert.ok(out.includes("my-session"), `missing session name\n${out}`);
});

test("footer hides session name when getSessionName returns empty", () => {
	const out = renderFooterWithSession({ sessionName: null });
	assert.ok(!out.includes("test-session"), `should not render name\n${out}`);
});

test("footer hides session name when footerSegments.sessionName is false", () => {
	const out = renderFooterWithSession({ sessionName: "my-session", sessionNameEnabled: false });
	assert.ok(!out.includes("my-session"), `should be hidden when disabled\n${out}`);
});

test("footer truncates long session names to 24 width units", () => {
	const longName = "x".repeat(60);
	const out = renderFooterWithSession({ sessionName: longName, width: 200 });
	const clean = out.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(!clean.includes(longName), "full name must not appear\n" + clean);
	assert.match(clean, /x{10,}\.\.\./, "truncated name should keep a prefix and ellipsis\n" + clean);
});

test("session name uses matching glyph in nerd and ascii modes", () => {
	const asciiOut = renderFooterWithSession({ mode: "ascii", sessionName: "sess" });
	assert.ok(asciiOut.includes(resolveGlyphs("ascii").session), `ascii glyph missing\n${asciiOut}`);
	const nerdOut = renderFooterWithSession({ mode: "nerd", sessionName: "sess" });
	assert.ok(nerdOut.includes(resolveGlyphs("nerd").session), `nerd glyph missing\n${nerdOut}`);
});

function renderFooterWithHost(opts: {
	mode?: "nerd" | "ascii";
	hostnameEnabled?: boolean;
	width?: number;
} = {}): string {
	const { mode = "ascii", hostnameEnabled = true, width = 160 } = opts;
	const { config, component } = createFooterFixture({ mode });
	config.footerSegments.hostname = hostnameEnabled;
	return component.render(width).join("\n");
}

test("short hostname keeps the first label across host name formats", () => {
	assert.equal(shortHostname("mba.example.com"), "mba");
	assert.equal(shortHostname("OldSun_Laptop"), "OldSun_Laptop");
	assert.equal(shortHostname(""), "");
});

test("footer shows the short host name next to cwd when enabled", () => {
	const expectedHost = shortHostname(hostname());
	const out = renderFooterWithHost();
	assert.ok(out.includes(`${resolveGlyphs("ascii").host} ${expectedHost}`), `missing short host name\n${out}`);
});

test("footer hides host name when footerSegments.hostname is false", () => {
	const expectedHost = shortHostname(hostname());
	const out = renderFooterWithHost({ hostnameEnabled: false });
	assert.ok(!out.includes(`${resolveGlyphs("ascii").host} ${expectedHost}`), `should be hidden when disabled\n${out}`);
});

test("host name uses matching glyph in nerd and ascii modes", () => {
	const asciiOut = renderFooterWithHost({ mode: "ascii" });
	assert.ok(asciiOut.includes(resolveGlyphs("ascii").host), `ascii glyph missing\n${asciiOut}`);
	const nerdOut = renderFooterWithHost({ mode: "nerd" });
	assert.ok(nerdOut.includes(resolveGlyphs("nerd").host), `nerd glyph missing\n${nerdOut}`);
});

// Real SGR codes keep the width maths honest: visibleWidth() must ignore them.
const styledTheme = {
	fg: (color: string, text: string) => {
		const codes: Record<string, string> = { mdLink: "36", dim: "90", muted: "37" };
		return `\x1b[${codes[color] ?? "39"}m${text}\x1b[39m`;
	},
} as Theme;

function renderStatusLines(statuses: Map<string, string>, width = 160): string[] {
	const { config, component } = createFooterFixture({
		theme: styledTheme,
		getExtensionStatuses: () => statuses,
	});
	config.unifiedFooter = false;
	// The two main footer rows come first, status rows follow them.
	return component.render(width).slice(2);
}

test("status sanitising keeps supported SGR colors and rejects other controls", () => {
	assert.equal(sanitizeStatusPreservingStyles("\x1b[32mok\x1b[39m"), "\x1b[32mok\x1b[39m");
	assert.equal(sanitizeStatusPreservingStyles("\x1b[38;5;123mcolor\x1b[0m"), "\x1b[38;5;123mcolor\x1b[0m");
	assert.equal(sanitizeStatusPreservingStyles("\x1b[>4;2mprivate"), "private");
	assert.equal(sanitizeStatusPreservingStyles("\x1b]0;title\x9b31m\x07visible"), "visible");
});

test("status sanitising flattens whitespace and drops cursor sequences", () => {
	assert.equal(sanitizeStatusPreservingStyles("a\tb\nc"), "a b c");
	assert.equal(sanitizeStatusPreservingStyles("a   b"), "a b");
	assert.equal(sanitizeStatusPreservingStyles("\x1b[?25lhidden"), "hidden");
	assert.equal(sanitizeStatusPreservingStyles("\x1b]0;title\x07visible"), "visible");
});

test("status sanitising removes complete string control sequences", () => {
	const controls = [
		"\x1bPpayload\x1b\\",
		"\x90payload\x9c",
		"\x1bXpayload\x1b\\",
		"\x98payload\x9c",
		"\x1b^payload\x1b\\",
		"\x9epayload\x9c",
		"\x1b_payload\x1b\\",
		"\x9fpayload\x9c",
		"\x1b]0;title\x07",
		"\x1b]0;title\x1b\\",
		"\x9d0;title\x07",
		"\x9d0;title\x9c",
	];
	for (const control of controls) {
		assert.equal(sanitizeStatusPreservingStyles(`before${control}after`), "before after");
	}
	assert.equal(sanitizeStatusPreservingStyles("before\x1bPunterminated"), "before");
});

test("status line keeps the colours set by extensions", () => {
	const lines = renderStatusLines(new Map([
		["memory", "\x1b[35mMemory\x1b[39m"],
		["plain", "goal active"],
	]));
	const out = lines.join("\n");

	// The extension's own magenta survives, plain text falls back to muted.
	assert.ok(out.includes("\x1b[35mMemory\x1b[39m"), `extension colour dropped\n${out}`);
	assert.ok(out.includes("\x1b[37mgoal active\x1b[39m"), `muted fallback missing\n${out}`);
	assert.ok(!out.includes("\x1b[37mMemory"), `status must not be repainted muted\n${out}`);
});

test("status line closes an unclosed style before the separator", () => {
	const lines = renderStatusLines(new Map([
		["bold", "\x1b[1mworking"],
		["next", "idle"],
	]));
	const out = lines.join("\n");

	assert.ok(
		out.includes("\x1b[1mworking\x1b[0m \x1b[90m|"),
		`separator inherits the unclosed style\n${out}`,
	);
});

test("status line drops sequences that could rewrite the terminal", () => {
	const lines = renderStatusLines(new Map([
		["mcp", "\x1b[?25lconn\x1b]0;evil\x07ected \x1b[32mdone\x1b[39m"],
	]));
	const out = lines.join("\n");

	assert.equal(stripAnsi(out).includes("conn ected done"), true, `text damaged\n${out}`);
	assert.ok(!out.includes("\x1b[?25l"), `cursor sequence leaked\n${out}`);
	assert.ok(!out.includes("\x1b]0;"), `OSC sequence leaked\n${out}`);
});

test("status line wraps coloured text inside the given width", () => {
	const long = `\x1b[31m${"x".repeat(120)}\x1b[39m`;
	const lines = renderStatusLines(new Map([["long", long]]), 40);

	assert.ok(lines.length > 1, "long status should wrap");
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 40, `width ${visibleWidth(line)} exceeds 40`);
	}
});

function footerRegressionFixture() {
	const reads = { model: 0, statuses: 0 };
	const fixture = createFooterFixture({
		context: { getContextUsage: () => undefined },
		getModelMeta: () => {
			reads.model++;
			return { provider: "fixture", model: "model", effort: "off" };
		},
		getExtensionStatuses: () => {
			reads.statuses++;
			return new Map([["fixture", "extension status"]]);
		},
	});
	return { ...fixture, reads };
}

test("detached Git branch and commit switches are independent in plain and inline layouts", () => {
	const { config, state, handle, component } = footerRegressionFixture();
	state.git.commit = { detached: true, oid: "abcdef123456789", tag: "release-tag" };
	for (const branch of [false, true]) for (const commit of [false, true]) {
		config.footerSegments.gitBranch = branch;
		config.footerSegments.gitCommit = commit;
		for (const out of [component.render(200).join("\n"), handle.renderInline(200)!.top.left]) {
			assert.equal(out.includes("HEAD"), branch, `HEAD: branch=${branch}, commit=${commit}`);
			assert.equal(out.includes("abcdef1"), commit, `hash: branch=${branch}, commit=${commit}`);
			assert.equal(out.includes("release-tag"), commit, `tag: branch=${branch}, commit=${commit}`);
		}
	}
});

test("footer renders only the requested layout and keeps extension status work out of inline borders", () => {
	const { config, handle, component, reads } = footerRegressionFixture();
	config.unifiedFooter = false;
	config.inlineFooter = true;
	assert.match(component.render(100).join("\n"), /extension status/);
	assert.deepEqual(reads, { model: 0, statuses: 1 });
	handle.renderInline(100);
	assert.deepEqual(reads, { model: 1, statuses: 1 });
	config.inlineFooter = false;
	assert.match(component.render(100).join("\n"), /extension status/);
	assert.deepEqual(reads, { model: 2, statuses: 2 });
	config.footerSegments.extensionStatuses = false;
	assert.doesNotMatch(component.render(100).join("\n"), /extension status/);
	assert.deepEqual(reads, { model: 3, statuses: 2 });
});

test("layout preserves higher-priority context/runtime over cwd and Git, in original order", () => {
	const segments = [
		{ text: "cwd", priority: 0 }, { text: "Git", priority: 3 },
		{ text: "runtime", priority: 4 }, { text: "ctx", priority: 4 },
	];
	assert.deepEqual(fitSegmentsByPriority(segments, 11), ["runtime", "ctx"]);
	assert.deepEqual(fitSegmentsByPriority(segments, 7), ["ctx"]);
});

test("new unified footer discovers arbitrary statuses on row two without extra rows", () => {
	const statuses = new Map([["usage", "\x1b[35mUsage 20%\x1b[0m"], ["unfamiliar/key", "Other data"]]);
	const { config, component, handle } = createFooterFixture({ theme: styledTheme, getExtensionStatuses: () => statuses });
	assert.equal(config.unifiedFooter, true);
	const lines = component.render(200);
	assert.equal(lines.length, 2);
	assert.doesNotMatch(lines[0]!, /Usage|Other data/);
	assert.match(lines[1]!, /\x1b\[35mUsage 20%\x1b\[0m/);
	assert.match(lines[1]!, /Other data/);
	assert.deepEqual([...handle.getExtensionStatuses().keys()], ["usage", "unfamiliar/key"]);
	assert.equal(handle.getFoldedStatusKeys().size, 0);
	config.extensionStatusItems = { usage: { visible: true, row: 1, priority: 10 } };
	const moved = component.render(200);
	assert.match(moved[0]!, /Usage/);
	assert.doesNotMatch(moved[1]!, /Usage/);
	assert.match(moved[1]!, /Other data/);
});

test("unified footer counts only current eligible folded items and preserves built-ins", () => {
	const statuses = new Map([
		["low", "LOW"], ["high", "HIGH"], ["hidden", "HIDDEN"],
		["large", "LONG".repeat(80)], ["empty", "\x1b[32m\x1b[0m"],
	]);
	const { config, component, handle } = createFooterFixture({ getExtensionStatuses: () => statuses });
	config.extensionStatusItems = {
		low: { visible: true, row: 2, priority: -10 },
		high: { visible: true, row: 2, priority: 10 },
		hidden: { visible: false, row: 2, priority: 100 },
	};
	config.footerSegments.extensionStatuses = false;
	const builtins = component.render(200)[1]!.trim();
	const builtinWidth = visibleWidth(builtins.replace(/ {2,}/g, " "));
	config.footerSegments.extensionStatuses = true;
	const width = builtinWidth + " | HIGH | +2".length;
	const lines = component.render(width);
	assert.equal(lines.length, 2);
	assert.match(lines[1]!, /HIGH/);
	assert.doesNotMatch(lines[1]!, /LOW|HIDDEN|LONG/);
	assert.match(lines[1]!, /\+2/);
	assert.match(lines[1]!, /gpt-5/);
	assert.match(lines[1]!, /\$0\.000/);
	assert.deepEqual(new Set(handle.getFoldedStatusKeys()), new Set(["low", "large"]));
	statuses.set("high", "UPDATED");
	assert.doesNotMatch(component.render(width).join("\n"), /HIGH/);
	assert.equal(handle.getExtensionStatuses().get("high"), "UPDATED");
	statuses.delete("large");
	statuses.delete("low");
	assert.equal(handle.getFoldedStatusKeys().size, 0, "details recompute from live data without a Footer rerender");
	assert.doesNotMatch(component.render(width).join("\n"), /\+\d/);
	config.footerSegments.extensionStatuses = false;
	assert.doesNotMatch(component.render(width).join("\n"), /UPDATED|HIDDEN|\+\d/);
	assert.equal(handle.getFoldedStatusKeys().size, 0);
	assert.equal(statuses.get("high"), "UPDATED", "hiding must not clear producer data");
});

test("unified regular and inline layouts stay bounded with styles, controls and many items", () => {
	const statuses = new Map(Array.from({ length: 25 }, (_, i) => [`key-${i}`, `\x1b[38;5;123m界e\u0301-${i}\x1b[0m`]));
	statuses.set("unsafe", "safe\x1b[2J\x1b]0;title\x07tail");
	const { config, component, handle } = createFooterFixture({ theme: styledTheme, getExtensionStatuses: () => statuses });
	config.extensionStatusItems = Object.fromEntries([...statuses.keys()].map((key, index) => [key, { visible: true, row: index % 2 ? 1 : 2, priority: index }]));
	for (const width of [0, 1, 2, 3, 4, 9, 20, 40, 80, 120, 200, 500]) {
		config.inlineFooter = false;
		const regular = component.render(width);
		assert.ok(regular.length <= 2);
		for (const line of regular) {
			assert.ok(visibleWidth(line) <= width, `regular width ${width}: ${line}`);
			assert.doesNotMatch(line, /\x1b\[2J|\x1b\]0;/);
		}
		config.inlineFooter = true;
		assert.deepEqual(component.render(width), []);
		const inline = handle.renderInline(width)!;
		for (const line of [inline.top, inline.bottom]) {
			assert.ok(visibleWidth(line.left) + visibleWidth(line.right) + (line.left && line.right ? 1 : 0) <= width, `inline width ${width}`);
			assert.doesNotMatch(line.left + line.right, /\x1b\[2J|\x1b\]0;/);
		}
	}
	config.inlineFooter = false;
	const all = component.render(1000).join("\n");
	assert.match(all, /\x1b\[38;5;123m界e\u0301/);
	assert.match(stripAnsi(all), /safe tail/);
	assert.equal(handle.getFoldedStatusKeys().size, 0);
});

test("inline folding uses each border's budget and never emits separate status rows", () => {
	const statuses = new Map([["top", "TOP-STATUS"], ["bottom", "BOTTOM-STATUS"]]);
	const { config, component, handle } = createFooterFixture({ getExtensionStatuses: () => statuses });
	config.unifiedFooter = true;
	config.inlineFooter = true;
	config.extensionStatusItems = { top: { visible: true, row: 1, priority: 0 } };
	const top = handle.renderInline(2, "top")!.top;
	const bottom = handle.renderInline(200, "bottom")!.bottom;
	assert.match(top.left + top.right, /\+1/);
	assert.match(bottom.left + bottom.right, /BOTTOM-STATUS/);
	assert.deepEqual([...handle.getFoldedStatusKeys()], ["top"]);
	assert.deepEqual(component.render(200), []);
	config.inlineFooter = false;
	const plain = component.render(200);
	assert.match(plain[0]!, /TOP-STATUS/);
	assert.match(plain[1]!, /BOTTOM-STATUS/);
	assert.equal(handle.getFoldedStatusKeys().size, 0);
	config.unifiedFooter = false;
	assert.ok(component.render(20).length > 2, "legacy extension wrapping remains available");
	handle.cleanup();
	assert.equal(handle.getExtensionStatuses().size, 0);
	assert.equal(handle.getFoldedStatusKeys().size, 0);
	assert.equal(handle.renderInline(200), undefined);
});

test("status priority, tie-breaking and digit-changing indicators fit exact column budgets", () => {
	const items = Array.from({ length: 11 }, (_, i) => ({ key: String(i).padStart(2, "0"), text: String(i).padStart(2, "0"), priority: 0 }));
	const empty = () => ({ left: "", right: "" });
	assert.deepEqual(fitStatusRow(items, 3, empty, " | ", (n) => `+${n}`), {
		line: { left: "+11", right: "" }, foldedKeys: items.map((item) => item.key),
	});
	assert.equal(fitStatusRow(items, 12, empty, " | ", (n) => `+${n}`).line.left, "00 | 01 | +9");
	const changed = [...items].reverse().map((item) => item.key === "09" ? { ...item, priority: 10 } : item);
	assert.equal(fitStatusRow(changed, 12, empty, " | ", (n) => `+${n}`).line.left, "09 | 00 | +9");
	assert.equal(fitStatusRow(items, 1, empty, " | ", (n) => `+${n}`).line.left, "");
});

test("actual editor places unified statuses and overflow within both border budgets", () => {
	const statuses = new Map([["top", "TOP-STATUS"], ["bottom", "BOTTOM-STATUS"], ["long", "detail ".repeat(200)]]);
	const { config, handle, component } = createFooterFixture({ getExtensionStatuses: () => statuses });
	config.inlineFooter = true;
	config.extensionStatusItems = { top: { visible: true, row: 1, priority: 0 } };
	const editor = new OpenTuiEditor(
		{ terminal: { rows: 24 }, requestRender() {} } as TUI,
		{ borderColor: (text: string) => text } as ConstructorParameters<typeof OpenTuiEditor>[1],
		{ matches: () => false } as unknown as ConstructorParameters<typeof OpenTuiEditor>[2],
		"block", { enabled: () => config.inlineFooter, render: handle.renderInline },
	);
	editor.setText("input");
	editor.setWorkingStatusIndicator({ renderInBorder: () => "working", renderSpinnerInBorder: () => "*" });
	const wide = editor.render(200).map(stripAnsi);
	assert.match(wide[0]!, /TOP-STATUS/);
	assert.match(wide.at(-1)!, /BOTTOM-STATUS.*\+1/);
	assert.doesNotMatch(wide.slice(1, -1).join("\n"), /TOP-STATUS|BOTTOM-STATUS|detail/);
	for (let width = 2; width <= 160; width++) {
		for (const line of editor.render(width)) assert.ok(visibleWidth(line) <= width, `editor width ${width}: ${line}`);
		assert.deepEqual(component.render(width), []);
	}
});

test("footer uses dots for left groups and pipes for right groups without rewriting producer text", () => {
	const statuses = new Map([["a", "PRODUCER | literal"], ["b", "NEXT"]]);
	const { config, state, handle, component } = createFooterFixture({
		theme: styledTheme, sessionName: "session", getExtensionStatuses: () => statuses,
	});
	config.footerSegments.sessionName = true;
	state.git.branch = "main";
	state.runtime = { name: "nodejs", version: "24.6.0" };
	const regular = component.render(220).map(stripAnsi);
	assert.match(regular[0]!, /project · .*session · .*main · .*24\.6\.0/);
	assert.match(regular[0]!, /0\.0% \| 0\/1\.0k/);
	assert.match(regular[1]!, /gpt-5 · PRODUCER \| literal · NEXT/);
	assert.match(regular[1]!, /↑ .* \| ↓ .* \| \$ /);
	config.inlineFooter = true;
	const inline = handle.renderInline(220)!;
	assert.match(stripAnsi(inline.top.left), /session · .*main/);
	assert.match(stripAnsi(inline.top.right), /project \| .*24\.6\.0 \| .*0\.0% \| 0\/1\.0k/);
	assert.match(stripAnsi(inline.bottom.left), /gpt-5 · PRODUCER \| literal · NEXT/);
	assert.match(stripAnsi(inline.bottom.right), /↑ .* \| ↓ .* \| \$ /);
});
