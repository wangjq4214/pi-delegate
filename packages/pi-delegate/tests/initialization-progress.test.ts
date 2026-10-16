import { afterEach, expect, spyOn, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createInitializationProgressReporter,
	readInitializationProgress,
} from "../src/initialization-progress.ts";

const directories: string[] = [];
function location(): string {
	const directory = mkdtempSync(join(tmpdir(), "delegate-progress-"));
	directories.push(directory);
	return join(directory, "snapshot.json");
}
afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

test("progress uses a registration-relative clock and writes changes, not elapsed-only polls", async () => {
	const path = location();
	let now = 1000;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	try {
		const report = createInitializationProgressReporter(path);
		report({ phase: "extension-loaded" });
		expect(await readInitializationProgress(path)).toEqual({
			phase: "extension-loaded",
			elapsedMs: 0,
		});
		now += 150;
		const observation = {
			phase: "waiting-tools" as const,
			expectedTools: 2,
			availableTools: 1,
			missingTools: ["late"],
			missingToolCount: 1,
		};
		report(observation);
		expect(await readInitializationProgress(path)).toEqual({
			...observation,
			elapsedMs: 150,
		});
		const contents = `${readFileSync(`${path}.progress.json`, "utf8")}\n`;
		writeFileSync(`${path}.progress.json`, contents);
		now += 500;
		report(observation);
		expect(readFileSync(`${path}.progress.json`, "utf8")).toBe(contents);
		report({ ...observation, phase: "validating" });
		expect((await readInitializationProgress(path))?.elapsedMs).toBe(650);
		expect((await readInitializationProgress(path))?.phase).toBe("validating");
	} finally {
		clock.mockRestore();
	}
});

test("writer bounds names, error and escaped UTF-8 bytes while retaining the full missing count", async () => {
	const path = location();
	const report = createInitializationProgressReporter(path);
	report({
		phase: "failed",
		expectedTools: 200,
		availableTools: 0,
		missingTools: Array.from({ length: 200 }, () => "\u0000".repeat(2000)),
		missingToolCount: 200,
		error: "\u0000".repeat(2000),
	});
	const progress = await readInitializationProgress(path);
	expect(progress?.missingToolCount).toBe(200);
	expect(progress?.missingTools).toHaveLength(16);
	expect(progress?.missingTools?.every((name) => name.length === 128)).toBe(
		true,
	);
	expect(progress?.error).toHaveLength(512);
	expect(statSync(`${path}.progress.json`).size).toBeLessThanOrEqual(16 * 1024);
});

test("absent and unreadable evidence returns undefined and writer failures are best-effort", async () => {
	const path = location();
	expect(await readInitializationProgress(path)).toBeUndefined();
	mkdirSync(`${path}.progress.json`);
	const report = createInitializationProgressReporter(path);
	expect(() => report({ phase: "ready" })).not.toThrow();
	expect(await readInitializationProgress(path)).toBeUndefined();
	expect(() => statSync(`${path}.progress.json.tmp`)).toThrow();
	expect(() =>
		createInitializationProgressReporter(undefined)({ phase: "ready" }),
	).not.toThrow();
});

test("reader rejects corrupt, oversized and invalid fields without throwing", async () => {
	const path = location();
	const good = {
		phase: "failed" as const,
		elapsedMs: 120,
		expectedTools: 4,
		availableTools: 1,
		missingTools: ["a", "b", "c"],
		missingToolCount: 3,
		error: "missing",
	};
	for (const data of [
		"{",
		"null",
		"[]",
		" ".repeat(16 * 1024 + 1),
		JSON.stringify({ ...good, phase: "made-up" }),
		JSON.stringify({ ...good, elapsedMs: -1 }),
		JSON.stringify({ ...good, expectedTools: "4" }),
		JSON.stringify({ ...good, availableTools: 0.5 }),
		JSON.stringify({ ...good, missingToolCount: -1 }),
		JSON.stringify({ ...good, missingTools: [42] }),
		JSON.stringify({ ...good, missingTools: ["a".repeat(129)] }),
		JSON.stringify({ ...good, missingTools: Array(17).fill("a") }),
		JSON.stringify({ ...good, error: "a".repeat(513) }),
		Buffer.from([0xff]),
	]) {
		writeFileSync(`${path}.progress.json`, data);
		expect(await readInitializationProgress(path)).toBeUndefined();
	}
	writeFileSync(`${path}.progress.json`, JSON.stringify(good));
	expect(await readInitializationProgress(path)).toEqual(good);
});
