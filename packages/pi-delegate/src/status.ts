import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PressureClock } from "./pressure.ts";
import {
	type AcceptedPressure,
	safeText,
	type TaskProgress,
	taskClock,
} from "./progress.ts";
import type { Capacity } from "./scheduling.ts";
import { outcomeColor, taskActivity } from "./task-presentation.ts";
import { formatUsage } from "./usage.ts";

const pressureColors: Record<AcceptedPressure, ThemeColor> = {
	none: "dim",
	warning: "warning",
	urgent: "error",
};

export type { AcceptedPressure, StatusObserver } from "./progress.ts";

/** Visual owner only: handles are invalid after scope changes; results live elsewhere. */
export class AgentStatus {
	private rows = new Map<number, TaskProgress>();
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
		if (!this.ui || this.requestRender || !this.rows.size) return;
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
		this.clear();
		this.ui = ctx.mode === "tui" ? ctx.ui : undefined;
		this.mount();
		this.refresh();
	}

	clear(): void {
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.rows.clear();
		this.ui?.setWidget("pi-delegate:agents", undefined);
		this.requestRender = undefined;
		this.mount();
		this.refresh();
	}
	close(): void {
		this.delegated = undefined;
		this.clear();
		this.ui = undefined;
	}

	/** Display a shared record without taking ownership of its lifetime. */
	show(row: TaskProgress): void {
		if (!this.ui) return;
		this.rows.set(row.id, row);
		this.mount();
		this.refresh();
	}
	update = (): void => this.refresh();

	render(width: number, theme?: Pick<Theme, "fg">): string[] {
		if (!this.rows.size || width <= 0) return [];
		const fg = (color: ThemeColor, text: string) =>
			theme ? theme.fg(color, text) : text;
		const summaries = [...this.rows.values()].map((row) => {
			const tool = row.latestTool;
			const color: ThemeColor = row.status
				? outcomeColor(row.status)
				: !tool &&
						(row.activity === "queued" ||
							row.activity === "initializing…" ||
							row.activity === "finishing…")
					? "muted"
					: "accent";
			const icon = row.status
				? { completed: "✓", incomplete: "!", failed: "×", cancelled: " " }[
						row.status
					]
				: row.activity === "queued"
					? "◷"
					: color === "accent"
						? "●"
						: " ";
			return {
				row,
				color,
				icon,
				metadata: ` · ${Math.floor(row.elapsedSeconds)}s · ${row.turns} ${row.turns === 1 ? "turn" : "turns"}`,
				pressure: `pressure: ${row.pressure}`,
				activity: taskActivity(row, "compact"),
				tool: !!tool && !row.status,
			};
		});
		// Give identity, time/turns and pressure space before padding or ornamentation.
		const minimumWidth = Math.max(
			visibleWidth("Agents"),
			...summaries.map(({ row, metadata, pressure }) =>
				Math.max(
					visibleWidth(`${row.id}  ${metadata}`),
					visibleWidth(pressure),
				),
			),
		);
		const padding = Math.min(
			2,
			Math.max(0, Math.floor((width - minimumWidth) / 2)),
		);
		const contentWidth = width - padding * 2;
		const decorated = contentWidth >= minimumWidth + visibleWidth("● #");
		const line = (text: string, ellipsis = "") =>
			" ".repeat(padding) + truncateToWidth(text, contentWidth, ellipsis);
		const lines = [
			line(
				fg("accent", "Agents") +
					(this.pool
						? `   ${fg("accent", "●")} ${fg("muted", `${this.pool.occupied}/${this.pool.maximum} active · ◷ ${this.pool.queued} queued`)}`
						: ""),
				"…",
			),
		];
		if (this.delegated) {
			lines.push(
				line(
					fg("muted", `  Σ Delegated total · ${formatUsage(this.delegated)}`),
					"…",
				),
				"",
			);
		}
		for (const [
			index,
			{ row, color, icon, metadata, pressure, activity, tool },
		] of summaries.entries()) {
			if (index) lines.push("");
			const prefix = decorated
				? `${fg(color, icon)} ${fg("mdLink", `#${row.id}`)}  `
				: fg("text", `${row.id}  `);
			const chrome = decorated ? visibleWidth(prefix) : 0;
			// Continue the branch directly below #, using Open TUI's Git branch role.
			const rail = fg(
				"mdLink",
				decorated ? `  │${" ".repeat(chrome - 3)}` : "",
			);
			const end = fg(
				"mdLink",
				decorated ? `  └─${" ".repeat(chrome - 4)}` : "",
			);
			const title = truncateToWidth(
				row.title,
				Math.max(0, contentWidth - visibleWidth(prefix + metadata)),
			);
			lines.push(line(prefix + fg("text", title) + fg("muted", metadata)));
			const configuration = row.configuration;
			lines.push(
				line(
					rail +
						fg(
							"muted",
							configuration
								? `model: ${safeText(configuration.model.provider)}/${safeText(configuration.model.id)} · thinking: ${safeText(configuration.thinkingLevel)}`
								: "model: unconfirmed · thinking: unconfirmed",
						),
					"…",
				),
			);
			// Reserve the acknowledged pressure label before clipping usage on narrow screens.
			const usage = truncateToWidth(
				formatUsage(row.usageValue),
				Math.max(0, contentWidth - chrome - visibleWidth(` · ${pressure}`)),
			);
			lines.push(
				line(
					rail +
						fg("muted", usage + (usage ? " · " : "")) +
						fg(pressureColors[row.pressure], pressure),
				),
			);
			lines.push(
				line(end + (tool ? fg(color, "⚙ ") : "") + fg(color, activity), "…"),
			);
		}
		// Pi supplies the top gap; this bottom gap exists only while task rows do.
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
		if (!this.rows.size) {
			this.ui?.setWidget("pi-delegate:agents", undefined);
			this.requestRender = undefined;
			return;
		}
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
