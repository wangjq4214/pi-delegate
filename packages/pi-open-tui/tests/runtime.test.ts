import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { clearRuntimeCache, readRuntimeInfo } from "../src/runtime.ts";

for (const [file, expected] of [
	["app.csproj", "dotnet"], ["app.fsproj", "dotnet"], ["app.cabal", "haskell"],
	["app.nimble", "nim"], ["app.opam", "ocaml"], ["app.Rproj", "r"], ["app.scala", "scala"], ["app.kt", "kotlin"],
] as const) {
	test(`runtime matches file suffix ${file}`, async (t) => {
		const cwd = mkdtempSync(join(tmpdir(), "open-tui-runtime-suffix-"));
		t.after(() => { clearRuntimeCache(); rmSync(cwd, { recursive: true, force: true }); });
		writeFileSync(join(cwd, file), "");
		assert.equal((await readRuntimeInfo(cwd))?.name, expected);
		rmSync(join(cwd, file));
		assert.notEqual((await readRuntimeInfo(cwd))?.name, expected, "removed markers invalidate selection");
	});
}

test("runtime keeps Java for Gradle Kotlin DSL and uses source evidence for C vs C++", async (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "open-tui-runtime-priority-"));
	t.after(() => { clearRuntimeCache(); rmSync(cwd, { recursive: true, force: true }); });
	writeFileSync(join(cwd, "build.gradle.kts"), "");
	assert.equal((await readRuntimeInfo(cwd))?.name, "java");
	rmSync(join(cwd, "build.gradle.kts"));
	writeFileSync(join(cwd, "settings.gradle.kts"), "");
	assert.equal((await readRuntimeInfo(cwd))?.name, "java");
	rmSync(join(cwd, "settings.gradle.kts"));
	writeFileSync(join(cwd, "CMakeLists.txt"), "");
	assert.equal((await readRuntimeInfo(cwd))?.name, "cpp", "ambiguous build files keep the existing fallback");
	writeFileSync(join(cwd, "main.c"), "");
	assert.equal((await readRuntimeInfo(cwd))?.name, "c");
	writeFileSync(join(cwd, "main.cpp"), "");
	assert.equal((await readRuntimeInfo(cwd))?.name, "cpp", "mixed C/C++ prefers C++");
});

test("runtime reads versions emitted on stderr and caches unchanged markers", (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "open-tui-runtime-version-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	writeFileSync(join(cwd, "pom.xml"), "");
	// Isolate the process boundary stub so other tests keep the real built-ins.
	const module = pathToFileURL(join(import.meta.dirname, "..", "src", "runtime.ts")).href;
	const script = `
		import childProcess from "node:child_process";
		import {syncBuiltinESMExports} from "node:module";
		import {promisify} from "node:util";
		let calls = 0;
		const fake = () => {};
		fake[promisify.custom] = async () => { calls++; return {stdout: "", stderr: 'openjdk version "21.0.8"'}; };
		childProcess.execFile = fake; syncBuiltinESMExports();
		const {readRuntimeInfo} = await import(${JSON.stringify(module)});
		const first = await readRuntimeInfo(${JSON.stringify(cwd)});
		await readRuntimeInfo(${JSON.stringify(cwd)});
		console.log(JSON.stringify({first, calls}));
	`;
	const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 15_000 });
	assert.deepEqual(JSON.parse(output), { first: { name: "java", version: "21.0.8" }, calls: 1 });
});
