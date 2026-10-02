import { expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { formatDelegationOutput } from "../src/output.ts";

for (const [name, text] of [
	["empty", ""],
	["small UTF-8", "你好\nanswer\n"],
	["exact byte boundary", "x".repeat(DEFAULT_MAX_BYTES)],
	["exact line boundary", "x\n".repeat(DEFAULT_MAX_LINES)],
]) {
	test(`output remains unchanged: ${name}`, async () => {
		expect(await formatDelegationOutput(text)).toEqual({ text });
	});
}

for (const [name, text, reason] of [
	["line limit", "x\n".repeat(DEFAULT_MAX_LINES + 1), "lines"],
	["byte limit", `${"x".repeat(DEFAULT_MAX_BYTES)}\ny`, "bytes"],
	["UTF-8 bytes", `${"中文😀".repeat(10)}\n`.repeat(600), "bytes"],
	["oversized first line", "中".repeat(DEFAULT_MAX_BYTES), "bytes"],
] as const) {
	test(`oversized output is bounded and saved in full: ${name}`, async () => {
		const result = await formatDelegationOutput(text);
		const path = result.fullOutputPath;
		if (!path) throw new Error("Missing full output path");
		try {
			const metadata = result.truncation;
			if (!metadata) throw new Error("Missing truncation metadata");
			expect(metadata?.truncated).toBe(true);
			expect(metadata?.truncatedBy).toBe(reason);
			expect(metadata?.maxBytes).toBe(DEFAULT_MAX_BYTES);
			expect(metadata?.maxLines).toBe(DEFAULT_MAX_LINES);
			expect(metadata?.outputBytes).toBeLessThanOrEqual(DEFAULT_MAX_BYTES);
			expect(metadata?.outputLines).toBeLessThanOrEqual(DEFAULT_MAX_LINES);
			expect(metadata).not.toHaveProperty("content");
			expect(await readFile(path, "utf8")).toBe(text);
			expect(result.text).toContain("[Output truncated:");
			expect(result.text).toContain(path);
			expect(result.text).not.toContain("�");
			const preview = result.text
				.split("[Output truncated:")[0]
				.replace(/\n\n$/, "");
			expect(text.startsWith(preview)).toBe(true);
			expect(Buffer.byteLength(preview, "utf8")).toBe(metadata?.outputBytes);
			if (name === "oversized first line") {
				expect(metadata?.firstLineExceedsLimit).toBe(true);
				expect(preview).toBe("");
			}
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
}

test("concurrent outputs use independent complete files", async () => {
	const inputs = ["a", "b"].map((char) => char.repeat(DEFAULT_MAX_BYTES + 1));
	const results = await Promise.all(
		inputs.map((text) => formatDelegationOutput(text)),
	);
	try {
		expect(results[0].fullOutputPath).not.toBe(results[1].fullOutputPath);
		for (const [index, result] of results.entries()) {
			if (!result.fullOutputPath) throw new Error("Missing full output path");
			expect(await readFile(result.fullOutputPath, "utf8")).toBe(inputs[index]);
		}
	} finally {
		await Promise.all(
			results.map((result) =>
				result.fullOutputPath
					? rm(dirname(result.fullOutputPath), { recursive: true, force: true })
					: undefined,
			),
		);
	}
});

test("cancelled output formatting does not return success", async () => {
	await expect(
		formatDelegationOutput("answer", AbortSignal.abort()),
	).rejects.toThrow();
});
