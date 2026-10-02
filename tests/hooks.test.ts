import { expect, test } from "bun:test";
import {
	copyFileSync,
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function withRepository(check: (cwd: string) => void) {
	const cwd = mkdtempSync(join(tmpdir(), "pi-delegate-hook-"));
	try {
		for (const file of [
			"package.json",
			"tsconfig.json",
			"biome.json",
			"lefthook.yml",
			".gitignore",
		]) {
			copyFileSync(join(root, file), join(cwd, file));
		}
		cpSync(join(root, "src"), join(cwd, "src"), { recursive: true });
		symlinkSync(
			join(root, "node_modules"),
			join(cwd, "node_modules"),
			"junction",
		);
		run(cwd, ["git", "init", "--quiet"]);
		run(cwd, ["git", "config", "user.name", "Hook test"]);
		run(cwd, ["git", "config", "user.email", "hook-test@example.invalid"]);
		run(cwd, ["git", "config", "core.autocrlf", "false"]);
		run(cwd, [process.execPath, "run", "hooks:install"]);
		check(cwd);
	} finally {
		// Remove the junction before recursive cleanup; never traverse project dependencies.
		rmSync(join(cwd, "node_modules"), { force: true, recursive: true });
		rmSync(cwd, { force: true, recursive: true });
	}
}

function execute(cwd: string, cmd: string[]) {
	const result = Bun.spawnSync(cmd, {
		cwd,
		env: { ...process.env, LEFTHOOK: "1", LEFTHOOK_VERBOSE: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: result.exitCode,
		output: result.stdout.toString() + result.stderr.toString(),
	};
}

function run(cwd: string, cmd: string[]) {
	const result = execute(cwd, cmd);
	if (result.code !== 0) throw new Error(`${cmd.join(" ")}\n${result.output}`);
	return result.output;
}

function commit(cwd: string, file: string, source: string) {
	writeFileSync(join(cwd, file), source);
	run(cwd, ["git", "add", "--", file]);
	return execute(cwd, ["git", "commit", "-m", "Hook integration test"]);
}

test("pre-commit formats and safely fixes nested paths with spaces, then stages the result", () => {
	withRepository((cwd) => {
		const file = "src/a fixture.ts";
		const result = commit(
			cwd,
			file,
			"export function answer(){let value=42;return value}\n",
		);
		expect(result.code, result.output).toBe(0);
		const source = readFileSync(join(cwd, file), "utf8");
		expect(source).toContain("const value = 42;");
		expect(source).toContain("\n\treturn value;\n");
		expect(run(cwd, ["git", "show", `HEAD:${file}`])).toBe(source);
		expect(run(cwd, ["git", "diff", "--", file])).toBe("");
	});
}, 30_000);

test("pre-commit blocks unfixable lint errors without applying unsafe fixes", () => {
	withRepository((cwd) => {
		const file = "src/lint.ts";
		const result = commit(cwd, file, "export const value: any = 1;\n");
		expect(result.code).not.toBe(0);
		expect(result.output).toContain("noExplicitAny");
		expect(readFileSync(join(cwd, file), "utf8")).toContain(": any");
	});
}, 30_000);

test("pre-commit blocks type errors after applying formatting", () => {
	withRepository((cwd) => {
		const file = "src/type.ts";
		const result = commit(cwd, file, "export const value:string=42\n");
		expect(result.code).not.toBe(0);
		expect(result.output).toContain("TS2322");
		expect(readFileSync(join(cwd, file), "utf8")).toContain(
			"export const value: string = 42;",
		);
	});
}, 30_000);

test("pre-commit typechecks even when no Biome-supported file is staged; no pre-push is configured", () => {
	withRepository((cwd) => {
		const config = run(cwd, [process.execPath, "run", "lefthook", "dump"]);
		expect(config).not.toContain("pre-push");
		writeFileSync(
			join(cwd, "src/type.ts"),
			"export const value: string = 42;\n",
		);
		const result = commit(cwd, "note.md", "# Only Markdown is staged\n");
		expect(result.code).not.toBe(0);
		expect(result.output).toContain("TS2322");
	});
}, 30_000);
