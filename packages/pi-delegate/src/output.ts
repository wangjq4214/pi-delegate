import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	type TruncationResult,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

interface DelegationOutput {
	text: string;
	truncation?: Omit<TruncationResult, "content">;
	fullOutputPath?: string;
}

export async function formatDelegationOutput(
	text: string,
	signal?: AbortSignal,
): Promise<DelegationOutput> {
	signal?.throwIfAborted();
	const { content, ...truncation } = truncateHead(text, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	if (!truncation.truncated) return { text };

	// This directory must outlive the child and its initialization snapshot.
	const directory = await mkdtemp(join(tmpdir(), "pi-delegate-output-"));
	const fullOutputPath = join(directory, "output.txt");
	try {
		await writeFile(fullOutputPath, text, { encoding: "utf8", mode: 0o600 });
		signal?.throwIfAborted();
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}

	const notice = `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}. Use read to retrieve the complete output.]`;
	return {
		text: content ? `${content}\n\n${notice}` : notice,
		truncation,
		fullOutputPath,
	};
}
