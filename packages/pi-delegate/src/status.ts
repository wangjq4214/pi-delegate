import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DelegationStatus } from "./delegate.ts";
import type { PressureClock } from "./pressure.ts";
import {
	type AcceptedPressure,
	type StatusObserver,
	safeText,
	TaskProgress,
	taskClock,
} from "./progress.ts";
import type { Capacity } from "./scheduling.ts";
import { formatUsage } from "./usage.ts";

const pressureColors: Record<AcceptedPressure, ThemeColor> = {
	none: "dim",
	warning: "warning",
	urgent: "error",
};
const outcomeColors: Record<DelegationStatus, ThemeColor> = {
	completed: "success",
	incomplete: "warning",
	failed: "error",
	cancelled: "muted",
};

export type { AcceptedPressure, StatusObserver } from "./progress.ts";

/** Visual owner only: handles are invalid after scope changes; results live elsewhere. */
export class AgentStatus {
	private rows = new Map<number, TaskProgress>();
	private next = 0;
	private generation = 0;
	private ui?: ExtensionContext["ui"];
	private requestRender?: () => void;
	private cancelTimer?: () => void;

	private pool?: Capacity;
	private delegated?: Usage;
	constructor(private time: PressureClock = taskClock) {}

	capacity(capacity: Capacity): void {
		this.pool = capacity;
		this.mount();
		this.refresh();
	}
	total(usage: Usage): void {
		this.delegated = structuredClone(usage);
		this.mount();
		this.refresh();
	}

	private mount(): void {
		if (!this.ui || this.requestRender || (!this.rows.size && !this.delegated))
			return;
		const generation = this.generation;
		this.ui.setWidget(
			"pi-delegate:agents",
			(tui, theme) => {
				if (generation === this.generation)
					this.requestRender = () => tui.requestRender();
				return {
					render: (width) =>
						generation === this.generation ? this.render(width, theme) : [],
					invalidate() {},
				};
			},
			{ placement: "aboveEditor" },
		);
	}

	bind(ctx: Pick<ExtensionContext, "mode" | "ui">): void {
		this.clear(true);
		this.ui = ctx.mode === "tui" ? ctx.ui : undefined;
		this.mount();
		this.refresh();
	}

	clear(resetNumbers = false): void {
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.rows.clear();
		this.ui?.setWidget("pi-delegate:agents", undefined);
		this.requestRender = undefined;
		if (resetNumbers) this.next = 0;
		this.mount();
		this.refresh();
	}
	close(): void {
		this.delegated = undefined;
		this.clear();
		this.ui = undefined;
	}

	add(task: string, title?: string): StatusObserver | undefined {
		if (!this.ui) return undefined;
		const generation = this.generation;
		const row = new TaskProgress(
			++this.next,
			truncateToWidth(
				safeText((title?.trim() || task).split(/\r?\n/)[0] ?? ""),
				60,
			),
			this.time,
			() => generation === this.generation && this.rows.get(row.id) === row,
			this.refresh,
		);
		this.show(row);
		return row;
	}

	/** Display a shared record without taking ownership of its lifetime. */
	show(row: TaskProgress): void {
		if (!this.ui) return;
		this.next = Math.max(this.next, row.id);
		this.rows.set(row.id, row);
		this.mount();
		this.refresh();
	}
	update = (): void => this.refresh();

	render(width: number, theme?: Pick<Theme, "fg">): string[] {
		if ((!this.rows.size && !this.delegated) || width <= 0) return [];
		const fg = (color: ThemeColor, text: string) =>
			theme ? theme.fg(color, text) : text;
		const summaries = [...this.rows.values()].map((row) => {
			const seconds =
				row.startedAt === undefined
					? 0
					: Math.max(
							0,
							Math.floor((row.stoppedAt ?? this.time.now()) - row.startedAt),
						);
			return {
				row,
				prefix: `${row.id}  `,
				metadata: ` · ${seconds}s · ${row.turns} ${row.turns === 1 ? "turn" : "turns"} · `,
				pressure: `pressure: ${row.pressure}`,
			};
		});
		// Shrink insets before sacrificing identity/summary metadata to spacing.
		const minimumWidth = Math.max(
			visibleWidth("Agents"),
			...summaries.map(({ prefix, metadata, pressure }) =>
				visibleWidth(prefix + metadata + pressure),
			),
		);
		const padding = Math.min(
			2,
			Math.max(0, Math.floor((width - minimumWidth) / 2)),
		);
		const contentWidth = width - padding * 2;
		const line = (text: string, ellipsis = "") =>
			" ".repeat(padding) + truncateToWidth(text, contentWidth, ellipsis);
		const lines = [
			line(
				this.pool
					? `Agents · active: ${this.pool.occupied}/${this.pool.maximum} · queued: ${this.pool.queued}`
					: "Agents",
				"…",
			),
		];
		if (this.delegated)
			lines.push(
				line(
					fg("muted", `  Delegated total · ${formatUsage(this.delegated)}`),
					"…",
				),
			);
		for (const { row, prefix, metadata, pressure } of summaries) {
			const title = truncateToWidth(
				row.title,
				Math.max(0, contentWidth - visibleWidth(prefix + metadata + pressure)),
			);
			lines.push(
				line(
					fg("text", prefix + title) +
						fg("muted", metadata) +
						fg(pressureColors[row.pressure], pressure),
				),
			);
			const configuration = row.configuration;
			lines.push(
				line(
					fg(
						"muted",
						"  │  " +
							(configuration
								? `model: ${safeText(configuration.model.provider)}/${safeText(configuration.model.id)} · thinking: ${safeText(configuration.thinkingLevel)}`
								: "model: unconfirmed · thinking: unconfirmed"),
					),
					"…",
				),
			);
			lines.push(line(fg("muted", `  │  ${formatUsage(row.usageValue)}`), "…"));
			const tool = [...row.tools.values()].at(-1);
			const activity =
				row.status ??
				(tool
					? `toolcall · ${tool}${row.tools.size > 1 ? ` (+${row.tools.size - 1})` : ""}`
					: row.activity);
			const color = row.status
				? outcomeColors[row.status]
				: !tool &&
						(row.activity === "queued" ||
							row.activity === "initializing…" ||
							row.activity === "finishing…")
					? "muted"
					: "accent";
			lines.push(line(fg("muted", "  └─ ") + fg(color, activity), "…"));
		}
		// Pi's aboveEditor container supplies the top gap; add only the bottom gap.
		lines.push("");
		return lines;
	}

	private refresh = (): void => {
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		const now = this.time.now();
		for (const row of this.rows.values()) {
			if (row.terminalAt !== undefined && now >= row.terminalAt + 5)
				this.rows.delete(row.id);
		}
		this.requestRender?.();
		if (!this.rows.size && !this.delegated) {
			this.ui?.setWidget("pi-delegate:agents", undefined);
			this.requestRender = undefined;
			return;
		}
		if (!this.rows.size) return;
		const generation = this.generation;
		const expiry = Math.min(
			...[...this.rows.values()].map((row) =>
				row.terminalAt === undefined ? Infinity : row.terminalAt + 5 - now,
			),
		);
		this.cancelTimer = this.time.schedule(
			() => {
				if (generation === this.generation) this.refresh();
			},
			Math.min(1000, Math.max(1, expiry * 1000)),
		);
	};
}
