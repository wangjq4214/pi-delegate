import { accessSync, constants, opendirSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** Validate before host argument conversion can erase null optional fields. */
export function validateCwdInput(value: unknown): void {
	if (value !== undefined && (typeof value !== "string" || !value.trim()))
		throw new Error("Delegation cwd must be a non-blank directory path");
}

/** Resolve at submission, before admission can defer execution. */
export function selectCwd(parentCwd: string, override?: string): string {
	validateCwdInput(override);
	const cwd = resolve(parentCwd, override ?? ".");
	validateCwd(cwd);
	return cwd;
}

/** Recheck at startup; selection may have become unusable while queued. */
export function validateCwd(cwd: string): void {
	try {
		if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
		accessSync(cwd, constants.R_OK | constants.X_OK);
		// Windows access() does not check ACLs; Bun may defer denial until read.
		const directory = opendirSync(cwd);
		try {
			directory.readSync();
		} finally {
			directory.closeSync();
		}
	} catch (error) {
		throw new Error(
			`Cannot use delegation cwd ${JSON.stringify(cwd)}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
