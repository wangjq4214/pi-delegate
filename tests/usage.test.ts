import { expect, test } from "bun:test";
import {
	entriesUsage,
	formatUsage,
	sumUsage,
	UsageLedger,
} from "../src/usage.ts";

export function usage(input: number) {
	return {
		input,
		output: 1100,
		cacheRead: 20000,
		cacheWrite: 0,
		totalTokens: input + 21100,
		reasoning: 100,
		cacheWrite1h: 0,
		cost: {
			input: 0.01,
			output: 0.03,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0.04,
		},
	};
}

test("selected compact format preserves separate host token categories", () => {
	expect(formatUsage(usage(8200))).toBe("↑8.2k ↓1.1k R20k W0 · $0.04");
	expect(formatUsage(sumUsage([]))).toBe("↑0 ↓0 R0 W0 · $0.00");
});

test("authoritative entries include auxiliary usage, not nested or subset duplicate charges", () => {
	const u = usage(8200);
	const entries = [
		{ type: "message", message: { role: "assistant", usage: u } },
		{
			type: "message",
			message: { role: "toolResult", usage: u, content: [{ usage: u }] },
		},
		{ type: "usage", usage: u },
		{ type: "compaction", usage: u },
		{ type: "branch_summary", usage: u },
		{ type: "custom", data: { usage: u } },
	] as unknown as Parameters<typeof entriesUsage>[0];
	expect(entriesUsage(entries)).toEqual(sumUsage(Array(5).fill(u)));
	expect(entriesUsage(entries).output).toBe(5500);
});

test("ledger replaces contributions independent of rows and ignores observations after closure", () => {
	const totals: ReturnType<typeof usage>[] = [];
	const ledger = new UsageLedger((u) =>
		totals.push(u as ReturnType<typeof usage>),
	);
	const first = {},
		second = {};
	const snapshot = usage(100);
	ledger.update(first, snapshot);
	snapshot.input = 999;
	ledger.update(second, usage(200));
	expect(totals.at(-1)?.input).toBe(300);
	ledger.update(first, usage(300));
	ledger.update(first, usage(300));
	expect(totals.at(-1)?.input).toBe(500);
	ledger.close();
	ledger.update(first, usage(500));
	expect(totals.at(-1)?.input).toBe(500);
});
