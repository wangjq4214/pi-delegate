import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DEFAULT_CONFIG, LEGACY_DEFAULT_CONFIG, getUserMessageLayout, getToolMessageLayout, loadConfig, saveConfig } from "../src/config.ts";

function fixture(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), "open-tui-config-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	});
	return { dir, path: join(dir, "open-tui.json") };
}

test("normalizes every config field and nested object without sharing defaults", (t) => {
	const { path } = fixture(t);
	const defaults = structuredClone(LEGACY_DEFAULT_CONFIG);
	for (const value of [null, [], false, "invalid", 42]) {
		writeFileSync(path, JSON.stringify(value));
		assert.deepEqual(loadConfig(), defaults);
	}
	for (const key of Object.keys(defaults) as Array<keyof typeof defaults>) {
		for (const value of [null, [], "invalid", 42]) {
			writeFileSync(path, JSON.stringify({ [key]: value }));
			assert.deepEqual(loadConfig(), defaults, `${key}: ${JSON.stringify(value)}`);
		}
	}
	for (const group of ["footerSegments", "telemetry", "workline"] as const) {
		for (const key of Object.keys(defaults[group])) {
			writeFileSync(path, JSON.stringify({ [group]: { [key]: "false" } }));
			assert.deepEqual(loadConfig(), defaults, `${group}.${key}`);
		}
	}
	for (const invalid of [{ icons: { mode: "invalid" } }, { thinkingPeek: { lines: 9 } }, { icons: { mode: false } }]) {
		writeFileSync(path, JSON.stringify(invalid));
		assert.deepEqual(loadConfig(), defaults);
	}
	writeFileSync(path, '{}');
	const loaded = loadConfig();
	loaded.icons.mode = "ascii";
	loaded.telemetry.enabled = false;
	assert.deepEqual(LEGACY_DEFAULT_CONFIG, defaults);
});

test("valid settings and unknown legacy fields survive load/save", (t) => {
	const { path } = fixture(t);
	const config = structuredClone(DEFAULT_CONFIG);
	config.enabled = false;
	config.icons.mode = "unicode";
	config.toolPresentation = false;
	config.messageLayout = "compact";
	config.footerSegments.cwd = false;
	config.telemetry.tps = false;
	config.thinkingPeek.lines = 2;
	config.workline.marquee = false;
	writeFileSync(path, JSON.stringify({ ...config, fullscreen: { wheelScrollLines: 10 } }));
	const loaded = loadConfig();
	assert.deepEqual(loaded, { ...config, fullscreen: { wheelScrollLines: 10 } });
	saveConfig(loaded);
	assert.deepEqual(loadConfig(), loaded);
});

test("legacy thinking On/Off interpretation preserves startup bytes and unknown nested preferences", (t) => {
	const { path } = fixture(t);
	for (const lines of [0, 1, 2] as const) {
		const raw = JSON.stringify({ thinkingPeek: { lines, futureStyle: "keep" }, unrelated: { retain: true } }, null, 3) + "\n";
		writeFileSync(path, raw);
		const config = loadConfig();
		assert.equal(config.thinkingPeek.lines > 0, lines !== 0);
		assert.deepEqual(config.thinkingPeek, { lines, futureStyle: "keep" });
		assert.equal(readFileSync(path, "utf8"), raw);
		assert.deepEqual((config as unknown as { unrelated: object }).unrelated, { retain: true });
	}
});

test("failed saves are observable and preserve the previous file without temp leftovers", (t) => {
	const { dir, path } = fixture(t);
	writeFileSync(path, '{"enabled":false}\n');
	const before = readFileSync(path, "utf8");
	const cyclic = structuredClone(DEFAULT_CONFIG) as typeof DEFAULT_CONFIG & { self?: unknown };
	cyclic.self = cyclic;
	assert.throws(() => saveConfig(cyclic));
	assert.equal(readFileSync(path, "utf8"), before);
	assert.deepEqual(readdirSync(dir), ["open-tui.json"]);
	rmSync(path);
	mkdirSync(path);
	assert.throws(() => saveConfig(DEFAULT_CONFIG));
	assert.deepEqual(readdirSync(dir), ["open-tui.json"]);
});

test("load warns on unreadable JSON and failed initial persistence", (t) => {
	const { dir, path } = fixture(t);
	const warnings: string[] = [];
	writeFileSync(path, '{');
	assert.deepEqual(loadConfig((message) => warnings.push(message)), LEGACY_DEFAULT_CONFIG);
	assert.equal(warnings.length, 1);
	assert.equal(readFileSync(path, "utf8"), "{");
	rmSync(dir, { recursive: true });
	writeFileSync(dir, "not a directory");
	assert.deepEqual(loadConfig((message) => warnings.push(message)), DEFAULT_CONFIG);
	assert.equal(warnings.length, 2);
});

test("a replacement failure preserves a real existing configuration and cleans the staged write", (t) => {
	const { dir, path } = fixture(t);
	writeFileSync(path, '{"enabled":false}\n');
	const before = readFileSync(path, "utf8");
	const replacement = t.mock.method(fs, "renameSync", () => { throw new Error("replacement failed"); });
	syncBuiltinESMExports();
	try {
		assert.throws(() => saveConfig(DEFAULT_CONFIG), /replacement failed/);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.deepEqual(readdirSync(dir), ["open-tui.json"]);
	} finally {
		replacement.mock.restore();
		syncBuiltinESMExports();
	}
});

test("new installations store the captured baseline with independent rails and dormant double box", (t) => {
	const { path } = fixture(t);
	const config = loadConfig();
	assert.deepEqual(config, DEFAULT_CONFIG);
	assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), DEFAULT_CONFIG);
	assert.equal(config.cursorStyle, "bar"); assert.equal(config.editorBorderStyle, "minimal");
	assert.deepEqual(config.workline, { marquee: true, attachToBorder: false });
	assert.equal(getUserMessageLayout(config), "compact"); assert.equal(getToolMessageLayout(config), "compact");
	assert.equal(config.toolBoxBorder.enabled, false); assert.equal(config.toolBoxBorder.style, "double");
	assert.equal(config.toolBoxBorder.bottom.enabled, false); assert.equal(config.toolBoxBorder.right?.enabled, false);
	assert.equal(config.userBoxBorder?.enabled, false); assert.equal(config.userBoxBorder?.right?.enabled, false);
});

test("existing partial and customized legacy files remain byte-for-byte untouched across loads", (t) => {
	const { path } = fixture(t);
	for (const input of [
		{}, { enabled: false }, { messageLayout: "compact", toolPresentation: false, custom: { keep: true } },
		{ messageLayout: "normal", toolBoxBorder: { enabled: true, style: "custom", colorMode: "static", color: "accent", top: { enabled: false, char: "#" }, left: { enabled: false } } },
	]) {
		const bytes = JSON.stringify(input, null, 3) + "\n\n";
		writeFileSync(path, bytes);
		for (let i = 0; i < 3; i++) {
			const config = loadConfig();
			assert.equal(readFileSync(path, "utf8"), bytes);
			assert.equal(config.cursorStyle, "block"); assert.equal(config.editorBorderStyle, "surround");
			assert.equal(config.workline.attachToBorder, true);
			const layout = "messageLayout" in input ? input.messageLayout : "normal";
			assert.equal(getUserMessageLayout(config), layout); assert.equal(getToolMessageLayout(config), layout);
			assert.equal(config.userMessageLayout, undefined); assert.equal(config.toolMessageLayout, undefined);
			assert.equal(config.toolBoxBorder.right?.enabled ?? false, false);
		}
	}
});

test("independent explicit edits survive reload without changing legacy or other-category preferences", (t) => {
	const { path } = fixture(t);
	writeFileSync(path, JSON.stringify({ messageLayout: "compact", toolBoxBorder: { enabled: true, style: "double", bottom: { enabled: false } }, future: { keep: true } }));
	const old = loadConfig();
	saveConfig({ ...old, userMessageLayout: "normal" });
	const next = loadConfig();
	assert.equal(getUserMessageLayout(next), "normal"); assert.equal(getToolMessageLayout(next), "compact");
	assert.deepEqual(next.toolBoxBorder, old.toolBoxBorder); assert.equal(next.messageLayout, old.messageLayout);
	saveConfig({ ...next, toolMessageLayout: "normal", toolBoxBorder: { ...next.toolBoxBorder, right: { enabled: true, char: "#" } } });
	const independent = loadConfig();
	assert.equal(getUserMessageLayout(independent), "normal"); assert.equal(getToolMessageLayout(independent), "normal");
	assert.deepEqual(independent.userBoxBorder, next.userBoxBorder);
	assert.equal(independent.toolBoxBorder.right?.char, "#");
	assert.deepEqual((independent as unknown as { future: unknown }).future, { keep: true });
});

test("normalizes new independent layouts and all User/Skill border fields without shared defaults", (t) => {
	const { path } = fixture(t);
	writeFileSync(path, JSON.stringify({ userMessageLayout: "bad", toolMessageLayout: 1, userBoxBorder: { enabled: true, style: "bad", colorMode: "status", color: 4, top: { enabled: "true", char: 3 }, right: { enabled: true, char: "#", future: 1 } } }));
	const config = loadConfig();
	assert.equal(getUserMessageLayout(config), "normal"); assert.equal(getToolMessageLayout(config), "normal");
	assert.equal(config.userBoxBorder?.style, "bold"); assert.equal(config.userBoxBorder?.colorMode, "theme");
	assert.equal(config.userBoxBorder?.top.enabled, false); assert.equal(config.userBoxBorder?.top.char, undefined);
	assert.equal(config.userBoxBorder?.right?.char, "#");
	config.userBoxBorder!.left.enabled = false;
	assert.equal(DEFAULT_CONFIG.userBoxBorder!.left.enabled, true);
});
