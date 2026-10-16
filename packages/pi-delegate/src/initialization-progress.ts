import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";

export interface InitializationProgress {
	phase:
		| "extension-loaded"
		| "waiting-tools"
		| "validating"
		| "ready"
		| "failed";
	elapsedMs: number;
	expectedTools?: number;
	availableTools?: number;
	missingTools?: string[];
	missingToolCount?: number;
	error?: string;
}

const MAX_BYTES = 16 * 1024;
const MAX_NAMES = 16;
const MAX_NAME_LENGTH = 128;
const MAX_ERROR_LENGTH = 512;
const phases = new Set<InitializationProgress["phase"]>([
	"extension-loaded",
	"waiting-tools",
	"validating",
	"ready",
	"failed",
]);
const count = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Temporary, failure-only evidence, never a prerequisite for initialization. */
export function createInitializationProgressReporter(
	snapshotPath: string | undefined,
): (progress: Omit<InitializationProgress, "elapsedMs">) => void {
	const started = Date.now();
	let previous: string | undefined;
	return (progress) => {
		if (!snapshotPath) return;
		const path = `${snapshotPath}.progress.json`;
		const temporary = `${path}.tmp`;
		try {
			const bounded = {
				...progress,
				...(progress.missingTools && {
					missingTools: progress.missingTools
						.slice(0, MAX_NAMES)
						.map((name) => name.slice(0, MAX_NAME_LENGTH)),
				}),
				...(progress.error !== undefined && {
					error: progress.error.slice(0, MAX_ERROR_LENGTH),
				}),
			};
			const state = JSON.stringify(bounded);
			if (state === previous) return;
			// Do not retry an unchanged observation on every poll, even if I/O fails.
			previous = state;
			const data = JSON.stringify({
				...bounded,
				elapsedMs: Math.max(0, Date.now() - started),
			});
			if (Buffer.byteLength(data) > MAX_BYTES) return;
			writeFileSync(temporary, data, { mode: 0o600 });
			renameSync(temporary, path);
		} catch {
			try {
				unlinkSync(temporary);
			} catch {
				// The owning parent removes the temporary directory in all cases.
			}
		}
	};
}

/** Ignore absent, malformed, oversized or unreadable evidence; bound even raced reads. */
export async function readInitializationProgress(
	snapshotPath: string,
): Promise<InitializationProgress | undefined> {
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await open(`${snapshotPath}.progress.json`, "r");
		const stat = await file.stat();
		if (!stat.isFile() || stat.size > MAX_BYTES) return undefined;
		const buffer = Buffer.alloc(MAX_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await file.read(
				buffer,
				length,
				buffer.length - length,
				null,
			);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > MAX_BYTES) return undefined;
		const value = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				buffer.subarray(0, length),
			),
		);
		if (
			!value ||
			!phases.has(value.phase) ||
			typeof value.elapsedMs !== "number" ||
			!Number.isFinite(value.elapsedMs) ||
			value.elapsedMs < 0
		)
			return undefined;
		for (const key of ["expectedTools", "availableTools", "missingToolCount"]) {
			if (value[key] !== undefined && !count(value[key])) return undefined;
		}
		if (
			value.missingTools !== undefined &&
			(!Array.isArray(value.missingTools) ||
				value.missingTools.length > MAX_NAMES ||
				value.missingTools.some(
					(name: unknown) =>
						typeof name !== "string" || name.length > MAX_NAME_LENGTH,
				))
		)
			return undefined;
		if (
			value.error !== undefined &&
			(typeof value.error !== "string" || value.error.length > MAX_ERROR_LENGTH)
		)
			return undefined;
		return {
			phase: value.phase,
			elapsedMs: value.elapsedMs,
			...(value.expectedTools !== undefined && {
				expectedTools: value.expectedTools,
			}),
			...(value.availableTools !== undefined && {
				availableTools: value.availableTools,
			}),
			...(value.missingTools !== undefined && {
				missingTools: value.missingTools,
			}),
			...(value.missingToolCount !== undefined && {
				missingToolCount: value.missingToolCount,
			}),
			...(value.error !== undefined && { error: value.error }),
		};
	} catch {
		return undefined;
	} finally {
		await file?.close().catch(() => {});
	}
}
