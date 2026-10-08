import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	Input,
	Key,
	matchesKey,
	ScrollView,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { safeText } from "./progress.ts";
import type { TaskGroup, TaskRecords, TaskSummary } from "./tasks.ts";
import { formatUsage } from "./usage.ts";

interface ActionResult {
	content: readonly { type: string; text?: string }[];
}
export interface PanelActions {
	cancel(taskId: string): Promise<ActionResult>;
	steer(taskId: string, message: string): Promise<ActionResult>;
}
const groups: TaskGroup[] = ["all", "active", "finished"];
const groupNames = { all: "All", active: "Active", finished: "Finished" };
type Page = "list" | "detail" | "confirm" | "compose";

/** One interaction, exact-ID selection and no execution ownership. */
export class TaskPanel {
	private page: Page = "list";
	private group: TaskGroup = "all";
	private selectedId?: string;
	private resultTab = false;
	private input = new Input({ prompt: "> " });
	private content = new Text("", 0, 0);
	private scroll = new ScrollView(this.content, {
		scrollbar: "hidden",
		follow: "none",
	});
	private busy = false;
	private confirmationFits = false;
	private message = "";
	private disposed = false;
	private unsubscribe: () => void;
	private timer: ReturnType<typeof setInterval>;
	private epoch: number;
	private hasFocus = false;
	get focused(): boolean {
		return this.hasFocus;
	}
	set focused(value: boolean) {
		this.hasFocus = value;
		this.input.focused = value && this.page === "compose";
	}

	constructor(
		private records: TaskRecords,
		private actions: PanelActions,
		private theme: () => Theme,
		private height: () => number,
		private redraw: () => void,
		private done: () => void,
	) {
		this.epoch = records.generation;
		this.unsubscribe = records.subscribe(() => {
			if (records.generation !== this.epoch) this.close();
			else if (!this.disposed) this.redraw();
		});
		this.timer = setInterval(() => {
			if (!this.disposed) this.redraw();
		}, 1000);
		this.timer.unref?.();
		this.input.onEscape = () => this.back();
		this.input.onSubmit = (value) => {
			if (value.trim()) this.perform("steer", value);
		};
	}
	dispose = (): void => {
		if (this.disposed) return;
		this.disposed = true;
		clearInterval(this.timer);
		this.unsubscribe();
	};
	close = (): void => {
		if (!this.disposed) {
			this.dispose();
			this.done();
		}
	};
	invalidate(): void {
		this.content.invalidate();
		this.input.invalidate();
		this.scroll.invalidate();
	}
	private summaries(): TaskSummary[] {
		return this.records.summaries(this.group);
	}
	private selected(items = this.summaries()): TaskSummary | undefined {
		let selected = items.find((item) => item.taskId === this.selectedId);
		if (!selected && this.page === "list") {
			selected = items[0];
			this.selectedId = selected?.taskId;
		}
		return selected;
	}
	private back(): void {
		if (this.page === "list") {
			this.close();
			return;
		}
		this.page = this.page === "detail" ? "list" : "detail";
		this.input.focused = false;
		this.scroll.scrollToStart();
		this.redraw();
	}
	private perform(action: "cancel" | "steer", text = ""): void {
		const taskId = this.selectedId;
		if (
			this.disposed ||
			this.busy ||
			!taskId ||
			this.records.generation !== this.epoch
		)
			return;
		const record = this.records.get(taskId);
		const controls = record?.summary().controls;
		if (!controls?.[action]) {
			this.message = controls?.reason ?? "Task is unavailable";
			this.page = "detail";
			this.redraw();
			return;
		}
		this.busy = true;
		this.page = "detail";
		this.input.focused = false;
		this.message =
			action === "cancel"
				? "Cancelling… waiting for owned-resource cleanup."
				: "Submitting instruction…";
		this.redraw();
		// Promise boundary keeps input/redraw live and captures the exact task identity.
		Promise.resolve()
			.then(() => {
				if (this.records.generation !== this.epoch)
					throw new Error("Task scope was invalidated");
				return action === "cancel"
					? this.actions.cancel(taskId)
					: this.actions.steer(taskId, text);
			})
			.then(
				(result) => {
					if (!this.disposed && this.selectedId === taskId)
						this.message = result.content
							.filter((item) => item.type === "text")
							.map((item) => item.text ?? "")
							.join("\n");
				},
				(error: unknown) => {
					if (!this.disposed && this.selectedId === taskId)
						this.message =
							error instanceof Error ? error.message : String(error);
				},
			)
			.finally(() => {
				this.busy = false;
				if (!this.disposed) this.redraw();
			});
	}
	handleInput(data: string): void {
		if (this.disposed) return;
		if (this.page === "compose") {
			this.input.handleInput(data);
			this.redraw();
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, "q")) {
			this.back();
			return;
		}
		if (this.page === "confirm") {
			if (
				matchesKey(data, Key.enter) &&
				this.confirmationFits &&
				this.height() >= 9
			)
				this.perform("cancel");
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
			if (this.page === "list") {
				const step = matchesKey(data, Key.shift("tab")) ? -1 : 1;
				this.group =
					groups[
						(groups.indexOf(this.group) + step + groups.length) % groups.length
					];
			} else this.resultTab = !this.resultTab;
			this.scroll.scrollToStart();
		} else if (this.page === "list") {
			const items = this.summaries();
			const selected = this.selected(items);
			if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
				const index = items.findIndex(
					(item) => item.taskId === selected?.taskId,
				);
				this.selectedId =
					items[
						Math.max(
							0,
							Math.min(
								items.length - 1,
								index + (matchesKey(data, Key.up) ? -1 : 1),
							),
						)
					]?.taskId;
			} else if (matchesKey(data, Key.enter) && selected) {
				this.page = "detail";
				this.resultTab = false;
				this.message = "";
				this.scroll.scrollToStart();
			}
		} else {
			const task = this.selectedId
				? this.records.get(this.selectedId)
				: undefined;
			if (
				matchesKey(data, "c") &&
				!this.busy &&
				task?.summary().controls.cancel
			) {
				this.page = "confirm";
				this.confirmationFits = false;
			} else if (
				matchesKey(data, "s") &&
				!this.busy &&
				task?.summary().controls.steer
			) {
				this.page = "compose";
				this.input.setValue("");
				this.input.focused = this.focused;
			} else if (matchesKey(data, Key.down)) this.scroll.scrollBy(1);
			else if (matchesKey(data, Key.up)) this.scroll.scrollBy(-1);
			else if (matchesKey(data, Key.pageDown))
				this.scroll.scrollBy(this.scroll.viewportHeight);
			else if (matchesKey(data, Key.pageUp))
				this.scroll.scrollBy(-this.scroll.viewportHeight);
		}
		this.redraw();
	}

	render(width: number): string[] {
		this.confirmationFits = false;
		if (this.disposed || width <= 0) return [];
		const theme = this.theme();
		const padding = width >= 8 ? 2 : 0;
		const inner = Math.max(1, width - padding * 2);
		const height = Math.max(1, this.height());
		let heading = "Delegated Tasks";
		let tabs = "";
		let hint = "";
		let body: string[] = [];
		if (this.page === "list") {
			const items = this.summaries();
			const selected = this.selected(items);
			tabs = groups
				.map((group) =>
					theme.fg(
						group === this.group ? "accent" : "dim",
						group === this.group
							? `[${groupNames[group]}]`
							: ` ${groupNames[group]} `,
					),
				)
				.join("  ");
			hint = "↑/↓: select · Enter: details · Tab: filter · Esc: close";
			const count = Math.max(1, Math.floor((height - 7) / 3));
			const index = items.findIndex((item) => item.taskId === selected?.taskId);
			const start = Math.max(0, Math.min(index, items.length - count));
			for (const item of items.slice(start, start + count)) {
				body.push(
					theme.fg(
						item.taskId === selected?.taskId ? "accent" : "text",
						`${item.taskId === selected?.taskId ? "›" : " "} #${item.label}  ${item.title}`,
					),
				);
				const statusRole =
					item.status === "failed"
						? "error"
						: item.status === "completed"
							? "success"
							: item.status === "incomplete"
								? "warning"
								: "muted";
				body.push(
					`  ${inner < 60 ? (item.mode === "background" ? "bg" : "sync") : item.mode} · ${theme.fg(statusRole, item.status)} · ${Math.floor(item.elapsedSeconds)}s · ${item.turns} ${item.turns === 1 ? "turn" : "turns"}${item.cancelling ? " · cancelling" : ""}${item.resultAvailable ? " · result available" : ""}`,
					"",
				);
			}
			// Keep gaps between tasks, not after the last one, so a task fits at height 9.
			if (body.length) body.pop();
			if (!items.length)
				body.push(theme.fg("muted", "No tasks in this scope/filter."));
			body.push(
				theme.fg(
					"dim",
					`${items.length} tasks · showing ${items.length ? start + 1 : 0}–${Math.min(items.length, start + count)}`,
				),
			);
		} else {
			const record = this.selectedId
				? this.records.get(this.selectedId)
				: undefined;
			if (!record) body = ["Task is unavailable in this scope."];
			else {
				const task = record.details();
				heading = `#${task.label}  ${task.title}`;
				if (this.page === "compose") {
					tabs = "Send instruction";
					body = ["Plain-text steering; acceptance does not mean execution."];
					this.input.focused = this.focused;
					body.push(...this.input.render(inner));
					hint = "Enter: submit · Esc: discard and back";
				} else if (this.page === "confirm") {
					tabs = "Cancel task?";
					body = new Text(
						[
							`Task ID: ${task.taskId}`,
							"Cancellation does not roll back file changes or external side effects.",
							"Waits for owned process/initialization cleanup, not workspace removal.",
						].join("\n"),
						0,
						0,
					).render(inner);
					this.confirmationFits = height >= 9 && body.length + 6 <= height;
					hint = "Enter: confirm cancellation · Esc: back";
				} else {
					tabs = this.resultTab
						? " Overview   [Result]"
						: "[Overview]   Result ";
					hint = `Tab: page · ↑/↓/PgUp/PgDn: scroll${task.controls.steer && !this.busy ? " · s: instruct" : ""}${task.controls.cancel && !this.busy ? " · c: cancel" : ""} · Esc: back`;
					const effective = task.configuration.effective;
					const requested = task.configuration.requested;
					const text = this.resultTab
						? record.result
							? `${record.result.content[0].text}${record.result.details.fullOutputPath ? `\n\nFull output: ${record.result.details.fullOutputPath}` : ""}`
							: "No final result available."
						: [
								`Title: ${task.title}`,
								`Task ID: ${task.taskId}`,
								`Mode: ${task.mode}`,
								`Status: ${task.status}${task.cancelling ? " (cancelling)" : ""}`,
								`CWD selected: ${task.cwd.selected}`,
								`CWD effective: ${task.cwd.effective ?? "unconfirmed"}`,
								`Model requested: ${requested.model.provider}/${requested.model.id} · thinking: ${requested.thinkingLevel}`,
								`Model effective: ${effective ? `${effective.model.provider}/${effective.model.id} · thinking: ${effective.thinkingLevel}` : "unconfirmed"}`,
								`Execution: ${Math.floor(task.elapsedSeconds)}s · ${task.turns} ${task.turns === 1 ? "turn" : "turns"} · ${task.activity}`,
								`Current tools: ${task.currentTools.join(", ") || "none observed"}`,
								`Pressure accepted: ${task.pressure.accepted} (not consumption/compliance)`,
								`Warning: ${task.pressure.policy.warning.afterSeconds}s / ${task.pressure.policy.warning.afterTurns} turns; urgent: ${task.pressure.policy.urgent.afterSeconds}s / ${task.pressure.policy.urgent.afterTurns} turns`,
								`Usage: ${formatUsage(task.usage)} (available, possibly partial; cost estimate)`,
								`Delivery: ${task.delivery.status}${task.delivery.error ? ` · ${task.delivery.error}` : ""} (not model consumption)`,
								`Controls: ${task.controls.reason ?? "background control ready"}`,
							].join("\n");
					this.content.setText(
						safeText(text + (this.message ? `\n\n${this.message}` : ""), true),
					);
					const lines = this.scroll.render(inner);
					const viewport = Math.max(1, height - 7 - (this.message ? 1 : 0));
					this.scroll.updateLayout(lines.length, viewport, this.redraw);
					body = lines.slice(
						this.scroll.scrollTop,
						this.scroll.scrollTop + viewport,
					);
					if (this.message)
						body.unshift(
							theme.fg(
								"accent",
								truncateToWidth(
									safeText(this.message.split("\n")[0] ?? ""),
									inner,
								),
							),
						);
					if (lines.length > viewport)
						body.push(
							theme.fg(
								"dim",
								`Lines ${this.scroll.scrollTop + 1}–${Math.min(lines.length, this.scroll.scrollTop + viewport)}/${lines.length}`,
							),
						);
				}
			}
		}
		const lines =
			height < 9 || body.length + 6 > height
				? [
						theme.bold(theme.fg("accent", safeText(heading))),
						theme.fg("muted", "Enlarge terminal · Esc: back/close"),
					].slice(0, height)
				: [
						"",
						theme.bold(
							theme.fg("accent", truncateToWidth(safeText(heading), inner)),
						),
						truncateToWidth(tabs, inner),
						"",
						...body,
						// Centered overlays must not move when body content changes height.
						...Array<string>(height - 6 - body.length).fill(""),
						theme.fg("dim", hint),
						"",
					];
		while (lines.length < height) lines.push("");
		return lines.map((line) => {
			const clipped = truncateToWidth(line, inner);
			return theme.bg(
				"customMessageBg",
				" ".repeat(padding) +
					clipped +
					" ".repeat(Math.max(0, width - padding - visibleWidth(clipped))),
			);
		});
	}
}

export function registerTaskPanel(
	pi: ExtensionAPI,
	records: TaskRecords,
	actions: PanelActions,
): void {
	let open = false;
	pi.registerCommand?.("delegates", {
		description: "Open the floating delegated-task list and details",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					"The task panel requires TUI mode; use delegate_list and delegate_status.",
					"info",
				);
				return;
			}
			if (open) {
				ctx.ui.notify("The task panel is already open.", "info");
				return;
			}
			open = true;
			try {
				await ctx.ui.custom<void>(
					(tui, _theme, _kb, done) =>
						new TaskPanel(
							records,
							actions,
							() => ctx.ui.theme,
							() => Math.floor(tui.terminal.rows * 0.8),
							() => tui.requestRender(),
							() => done(undefined),
						),
					{
						overlay: true,
						overlayOptions: { width: "85%", anchor: "center", margin: 1 },
					},
				);
			} finally {
				open = false;
			}
		},
	});
}
