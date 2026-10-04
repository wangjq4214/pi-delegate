import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export function sumUsage(usages: Iterable<Usage>): Usage {
	const sum: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const usage of usages) {
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"totalTokens",
		] as const)
			sum[key] += usage[key];
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"total",
		] as const)
			sum.cost[key] += usage.cost[key];
		if (usage.reasoning !== undefined)
			sum.reasoning = (sum.reasoning ?? 0) + usage.reasoning;
		if (usage.cacheWrite1h !== undefined)
			sum.cacheWrite1h = (sum.cacheWrite1h ?? 0) + usage.cacheWrite1h;
	}
	return sum;
}

export function entriesUsage(entries: SessionEntry[]): Usage {
	return sumUsage(
		entries.flatMap((entry) => {
			if (entry.type === "message")
				return (entry.message.role === "assistant" ||
					entry.message.role === "toolResult") &&
					entry.message.usage
					? [entry.message.usage]
					: [];
			if (
				entry.type === "usage" ||
				entry.type === "compaction" ||
				entry.type === "branch_summary"
			)
				return entry.usage ? [entry.usage] : [];
			return [];
		}),
	);
}

/** Lifetime belongs to the runtime, never to rows or task handles. */
export class UsageLedger {
	private contributions = new Map<object, Usage>();
	private closed = false;
	constructor(private changed: (total: Usage) => void) {}
	update(task: object, usage: Usage): void {
		if (this.closed) return;
		this.contributions.set(task, structuredClone(usage));
		this.changed(sumUsage(this.contributions.values()));
	}
	close(): void {
		this.closed = true;
		this.contributions.clear();
	}
}

export function formatUsage(usage: Usage): string {
	const tokens = (value: number) =>
		value < 1000 ? String(value) : `${Number((value / 1000).toFixed(1))}k`;
	return `↑${tokens(usage.input)} ↓${tokens(usage.output)} R${tokens(usage.cacheRead)} W${tokens(usage.cacheWrite)} · $${usage.cost.total.toFixed(2)}`;
}
