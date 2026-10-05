import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	opendirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { selectCwd } from "../src/cwd.ts";
import { runDelegation } from "../src/delegate.ts";

const system32 = join(process.env.SystemRoot ?? "C:/Windows", "System32");
const icacls = join(system32, "icacls.exe");
const whoami = join(system32, "whoami.exe");
const fixture = resolve("tests/fixtures/cwd-permissions-rpc-spec0008.mjs");

function command(executable: string, args: string[]) {
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: 5_000,
		windowsHide: true,
	});
	if (result.error || result.status !== 0) {
		throw new Error(
			`${executable} ${args.join(" ")}: ${result.error?.message ?? result.stderr} (exit ${result.status})`,
		);
	}
	return result.stdout;
}

function directoryReadError(path: string, read = true): string | undefined {
	try {
		const directory = opendirSync(path);
		try {
			// Bun can defer the OS directory read until readSync, unlike Node.
			if (read) directory.readSync();
		} finally {
			directory.closeSync();
		}
		return undefined;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code;
	}
}

// /deny must not subtract permissions from preexisting explicit user grants.
// These fixtures are fresh directories with only inherited ACEs for this SID.
function inheritedUserAces(acl: string, sid: string): string[] {
	const aces = [...acl.matchAll(/\([^)]*\)/g)].map(([ace]) => ace);
	const userAces = aces.filter((ace) => ace.endsWith(`;;;${sid})`));
	if (
		!userAces.length ||
		userAces.some(
			(ace) => !ace.startsWith("(A;") || !ace.split(";")[1]?.includes("ID"),
		)
	) {
		throw new Error(
			"ACL fixture must have only inherited user grants before /deny",
		);
	}
	return aces;
}

// This is an ACL integration regression, not a chmod simulation or a sandbox.
// Missing Windows utilities are explicit prerequisites, not evidence of denial.
test.skipIf(
	process.platform !== "win32" || !existsSync(icacls) || !existsSync(whoami),
)(
	"Windows ACL-inaccessible cwd fails before the original task (real Node child, no fallback)",
	async () => {
		const identity = command(whoami, ["/user", "/fo", "csv", "/nh"]);
		const sid = identity.match(/S-1-5-21-\d+-\d+-\d+-\d+/)?.[0];
		if (!sid) throw new Error("Unable to obtain the current token's user SID");
		const node = command("node", ["-p", "process.execPath"]).trim();
		const originalParentCwd = process.cwd();
		const root = mkdtempSync(join(tmpdir(), "pi-cwd-permissions-spec0008-"));
		const target = join(root, "denied workspace");
		const beforeAcl = join(root, "before.acl");
		const afterAcl = join(root, "after.acl");
		const witness = join(root, "original-task.json");
		let denyAttempted = false;
		let originalAces: string[] = [];
		try {
			mkdirSync(target);
			expect(selectCwd(root, target)).toBe(target);
			expect(directoryReadError(target)).toBeUndefined();
			command(icacls, [target, "/save", beforeAcl]);
			originalAces = inheritedUserAces(readFileSync(beforeAcl, "utf16le"), sid);
			// No inheritance flags: only this disposable directory is denied.
			// Keep WRITE_DAC/DELETE available so cleanup needs no elevation.
			denyAttempted = true;
			command(icacls, [target, "/deny", `*${sid}:(RD,X)`]);

			const hostOpenError = directoryReadError(target, false);
			const hostReadError = directoryReadError(target);
			expect(hostReadError).toBeDefined();
			// Windows can bypass traverse checks and start the process anyway.
			// Require a real Node child's relative read to prove unusability.
			const probe = spawnSync(
				node,
				[
					"-e",
					'const fs=require("node:fs"); try { fs.opendirSync(".").closeSync(); process.exit(24); } catch (e) { console.log(JSON.stringify({cwd:process.cwd(),code:e.code})); process.exit(23); }',
				],
				{ cwd: target, encoding: "utf8", timeout: 5_000, windowsHide: true },
			);
			expect(probe.error).toBeUndefined();
			expect(probe.status).toBe(23);
			expect(JSON.parse(probe.stdout)).toMatchObject({ cwd: target });
			expect(["EPERM", "EACCES"]).toContain(JSON.parse(probe.stdout).code);

			let selectionError: string | undefined;
			try {
				selectCwd(root, target);
			} catch (error) {
				selectionError = (error as Error).message;
			}
			const result = await runDelegation({
				cwd: target,
				args: [],
				task: "List the selected working directory using a relative path",
				snapshot: { version: 1, tools: [], active: [] },
				cliPath: fixture,
				env: { CWD_PERMISSIONS_WITNESS: witness },
				signal: AbortSignal.timeout(5_000),
			});
			expect(result.isError).toBe(true);
			expect(result.details.status).toBe("failed");
			expect(result.details.error).toBeTruthy();
			expect(process.cwd()).toBe(originalParentCwd);
			const taskObservation = existsSync(witness)
				? JSON.parse(readFileSync(witness, "utf8"))
				: undefined;
			if (taskObservation) {
				// Diagnostic path for the current bug: actual task access failed
				// in the selected directory, never in a fallback parent directory.
				expect(taskObservation.cwd).toBe(target);
				expect(["EPERM", "EACCES"]).toContain(taskObservation.access);
				expect(result.details.cwd).toBe(target); // A child really spawned.
			} else {
				expect(result.details.cwd).toBeUndefined(); // No execution claim.
			}
			console.info("Windows cwd ACL evidence", {
				hostOpenError,
				hostReadError,
				selectionError,
				runner: result.details,
				taskObservation,
			});
			// Both submission selection and admitted startup must reject a cwd
			// whose directory-read capability was lost. Do not mask this with
			// a passing assertion that stat/access accept the inaccessible cwd.
			expect({
				selectionError,
				originalTaskStarted: !!taskObservation,
			}).toEqual({
				selectionError: expect.stringContaining("Cannot use delegation cwd"),
				originalTaskStarted: false,
			});
		} finally {
			if (denyAttempted) {
				// /restore requires privileges unavailable to ordinary tokens here.
				// Remove only our explicit deny; all original grants were inherited.
				command(icacls, [target, "/remove:d", `*${sid}`]);
				command(icacls, [target, "/save", afterAcl]);
				expect(
					inheritedUserAces(readFileSync(afterAcl, "utf16le"), sid),
				).toEqual(originalAces);
				expect(directoryReadError(target)).toBeUndefined();
				readdirSync(target);
			}
			rmSync(root, { recursive: true, force: true });
			expect(existsSync(root)).toBe(false);
		}
	},
	20_000,
);
