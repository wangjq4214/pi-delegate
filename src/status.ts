import type {
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { DelegationStatus } from "./delegate.ts";
import type { PressureClock } from "./pressure.ts";

export type AcceptedPressure = "none" | "warning" | "urgent";
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
export interface StatusObserver {
	observe(record: Record<string, unknown>): void;
	accepted(stage: Exclude<AcceptedPressure, "none">): void;
	finish(status: DelegationStatus): void;
}
interface Row {
	id: number;
	title: string;
	startedAt?: number;
	stoppedAt?: number;
	terminalAt?: number;
	turns: number;
	pressure: AcceptedPressure;
	activity: string;
	tools: Map<string, string>;
	status?: DelegationStatus;
}
const clock: PressureClock = {
	now: () => performance.now() / 1000,
	schedule: (callback, ms) => {
		const timer = setTimeout(callback, ms);
		return () => clearTimeout(timer);
	},
};
// Only one line of display metadata; control/ANSI sequences cannot manipulate the terminal.
function clean(text: string): string {
	return (
		text
			// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately remove terminal escape sequences.
			.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
			.replace(/[\p{Cc}\p{Cf}]/gu, " ")
			.trim()
	);
}

/** Visual owner only: handles are invalid after scope changes; results live elsewhere. */
export class AgentStatus {
	private rows = new Map<number, Row>();
	private next = 0;
	private generation = 0;
	private ui?: ExtensionContext["ui"];
	private requestRender?: () => void;
	private cancelTimer?: () => void;

	constructor(private time: PressureClock = clock) {}

	bind(ctx: Pick<ExtensionContext, "mode" | "ui">): void {
		this.clear(true);
		this.ui = ctx.mode === "tui" ? ctx.ui : undefined;
	}

	clear(resetNumbers = false): void {
		this.generation++;
		this.cancelTimer?.();
		this.cancelTimer = undefined;
		this.rows.clear();
		this.ui?.setWidget("pi-delegate:agents", undefined);
		this.requestRender = undefined;
		if (resetNumbers) this.next = 0;
	}
	close(): void {
		this.clear();
		this.ui = undefined;
	}

	add(task: string, title?: string): StatusObserver | undefined {
		if (!this.ui) return undefined;
		const row: Row = {
			id: ++this.next,
			title: truncateToWidth(
				clean((title?.trim() || task).split(/\r?\n/)[0] ?? ""),
				60,
			),
			turns: 0,
			pressure: "none",
			activity: "initializing…",
			tools: new Map(),
		};
		const generation = this.generation;
		const valid = () =>
			generation === this.generation && this.rows.get(row.id) === row;
		this.rows.set(row.id, row);
		if (this.rows.size === 1) {
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
		this.refresh();
		return {
			observe: (record) => {
				if (!valid() || row.status || row.stoppedAt !== undefined) return;
				if (record.type === "agent_start" && row.startedAt === undefined) {
					row.startedAt = this.time.now();
					row.activity = "running…";
				}
				if (row.startedAt === undefined) return;
				switch (record.type) {
					case "message_update": {
						const event = record.assistantMessageEvent as
							| { type?: string }
							| undefined;
						if (
							event?.type === "thinking_start" ||
							event?.type === "thinking_delta"
						)
							row.activity = "thinking…";
						else if (
							event?.type === "thinking_end" ||
							event?.type === "text_start" ||
							event?.type === "text_delta" ||
							event?.type === "toolcall_start"
						)
							row.activity = "running…";
						break;
					}
					case "message_start":
					case "message_end":
						row.activity = "running…";
						break;
					case "tool_execution_start":
						if (
							typeof record.toolCallId === "string" &&
							typeof record.toolName === "string"
						)
							row.tools.set(record.toolCallId, clean(record.toolName));
						row.activity = "running…";
						break;
					case "tool_execution_end":
						if (typeof record.toolCallId === "string")
							row.tools.delete(record.toolCallId);
						row.activity = "running…";
						break;
					case "turn_end":
						row.turns++;
						row.tools.clear();
						row.activity = "running…";
						break;
					case "agent_settled":
					case "rpc_failure":
						row.stoppedAt = this.time.now();
						row.tools.clear();
						row.activity = "finishing…";
				}
				this.refresh();
			},
			accepted: (stage) => {
				if (!valid() || row.status) return;
				if (row.pressure !== "urgent") row.pressure = stage;
				this.refresh();
			},
			finish: (status) => {
				if (!valid() || row.status) return;
				row.status = status;
				row.stoppedAt ??= this.time.now();
				row.terminalAt = this.time.now();
				row.tools.clear();
				this.refresh();
			},
		};
	}

	render(width: number, theme?: Pick<Theme, "fg">): string[] {
		if (!this.rows.size || width <= 0) return [];
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
		const lines = [line("Agents", "…")];
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
			const tool = [...row.tools.values()].at(-1);
			const activity =
				row.status ?? (tool ? `toolcall · ${tool}` : row.activity);
			const color = row.status
				? outcomeColors[row.status]
				: !tool &&
						(row.activity === "initializing…" || row.activity === "finishing…")
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
