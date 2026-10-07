import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/config.ts";

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
	const defaults = structuredClone(DEFAULT_CONFIG);
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
	assert.deepEqual(DEFAULT_CONFIG, defaults);
});

test("valid settings and unknown legacy fields survive load/save", (t) => {
	const { path } = fixture(t);
	const config = structuredClone(DEFAULT_CONFIG);
	config.enabled = false;
	config.icons.mode = "unicode";
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
	assert.deepEqual(loadConfig((message) => warnings.push(message)), DEFAULT_CONFIG);
	assert.equal(warnings.length, 1);
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
