import type {
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { GoalController, GoalProgress } from "./controller.ts";
import type { GoalCreation } from "./creation.ts";
import { displayText } from "./presentation.ts";

type Draft = ReturnType<GoalCreation["status"]>;
const widgetKey = "pi-goal:progress";
const terminal = new Set(["completed", "incomplete", "failed", "cancelled"]);

/** A text-only, ephemeral projection; it neither accepts evidence nor owns execution. */
export function renderGoalProgress(
	progress: GoalProgress,
	draft: Draft,
	width: number,
	theme?: Pick<Theme, "fg">,
): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];
	const line = (text: string, color: ThemeColor = "muted") => {
		const safe = truncateToWidth(displayText(text), width);
		lines.push(theme ? theme.fg(color, safe) : safe);
	};
	const state = progress.state;
	if (draft && !progress.runtimeActive) {
		line(`Goal draft · ${draft.request}`, "accent");
		line("Not authorized · no plan or executing subagent");
		return lines;
	}
	if (!state) {
		line("Goal · no current goal or draft");
		return lines;
	}
	line(`Goal · ${state.objective}`, "accent");
	const accepted = state.items.filter(
		(item) => item.status === "accepted",
	).length;
	const allowance = state.run
		? `${state.run.allowance - state.run.used} dispatches remaining / ${state.run.allowance}`
		: "dispatch allowance unavailable";
	line(`${accepted}/${state.items.length} accepted · ${allowance}`);

	const dispatch = progress.dispatch;
	if (progress.stopping) {
		line(
			dispatch && !dispatch.settled
				? "Stopping · cancellation requested; waiting for owned cleanup"
				: "Stopping · settling goal ownership; no running child",
			"warning",
		);
	} else if (dispatch) {
		const role = dispatch.kind === "reviewer" ? "Independent review" : "Worker";
		const task = dispatch.task;
		const activity =
			dispatch.settled || (task && terminal.has(task.phase))
				? "result assessment; execution ended"
				: task?.cancelling || task?.phase === "cleanup"
					? "stopping / cleanup; waiting for settlement"
					: task?.phase === "queued"
						? "queued for admission; child not started"
						: task?.phase === "initializing"
							? "initializing"
							: task?.phase === "running"
								? "running"
								: task
									? "phase unavailable"
									: "waiting for delegate acceptance; subagent unavailable";
		line(`${role} · ${activity}`, "accent");
		if (dispatch.kind === "worker")
			line(`Item: ${dispatch.itemId} · ${dispatch.itemTitle}`);
	} else if (!progress.runtimeActive) {
		line(
			state.status === "complete"
				? "Complete · current independent review approved"
				: "Paused / inactive · no running child",
			state.status === "complete" ? "success" : "warning",
		);
	} else if (progress.reinspectionRequired) {
		line(
			"Recovery · reinspection required before dispatch; no current child",
			"warning",
		);
	} else {
		line(
			!state.items.length
				? "Coordination · no plan yet; no current child"
				: accepted === state.items.length
					? "Coordination · independent review required; no current child"
					: "Coordination · plan / assess evidence; no current child",
		);
	}
	if (dispatch?.task) {
		// Exact accepted query identity, never abbreviated even at narrow widths.
		for (const part of wrapTextWithAnsi(
			`Subagent: ${displayText(dispatch.task.taskId)}`,
			width,
		))
			lines.push(theme ? theme.fg("dim", part) : part);
	}
	if (progress.stopReason || state.stopReason)
		line(`Stop: ${progress.stopReason ?? state.stopReason}`, "warning");
	if (progress.reinspectionRequired && (dispatch || !progress.runtimeActive))
		line("Recovery: reinspection required", "warning");
	const review = state.review;
	const previous = state.attempts
		.filter((attempt) => attempt.kind === "reviewer")
		.at(-1);
	line(
		review
			? `Review: ${review.workRevision !== state.workRevision ? "stale; unfinished" : review.approved ? (state.status === "complete" ? "approved" : "approval recorded; not complete") : "not approved; unfinished"} · ${review.summary}`
			: previous
				? `Review: previous ${previous.status}; no current approval · ${previous.summary}`
				: "Review: not yet assessed",
	);
	const last = state.attempts.at(-1);
	if (
		last &&
		(last.status === "failed" ||
			last.status === "cancelled" ||
			last.status === "incomplete" ||
			last.status === "interrupted")
	)
		line(`Last ${last.kind}: ${last.status} · ${last.summary}`, "warning");
	return lines;
}

/** Owns only its widget and subscription. Disposal is never execution cancellation. */
export class GoalProgressView {
	private ui?: ExtensionContext["ui"];
	private unsubscribe?: () => void;
	private requestRender?: () => void;
	private generation = 0;
	private mounted = false;

	constructor(
		private controller: GoalController,
		private draft: () => Draft,
	) {}

	bind(ctx: Pick<ExtensionContext, "mode" | "ui">): void {
		if (ctx.mode !== "tui") return;
		if (this.ui === ctx.ui) return;
		this.dispose();
		this.ui = ctx.ui;
		this.unsubscribe = this.controller.subscribe(() => this.refresh());
		this.refresh();
	}

	refresh(): void {
		const ui = this.ui;
		if (!ui) return;
		try {
			if (!this.mounted && (this.controller.status() || this.draft())) {
				this.mounted = true;
				const generation = this.generation;
				ui.setWidget(
					widgetKey,
					(tui) => {
						if (generation === this.generation)
							this.requestRender = () => tui.requestRender();
						return {
							render: (width) => {
								if (generation !== this.generation) return [];
								try {
									return renderGoalProgress(
										this.controller.progress(),
										this.draft(),
										width,
										ui.theme,
									);
								} catch {
									return [
										truncateToWidth(
											"Goal progress unavailable; inspect goal_status",
											width,
										),
									];
								}
							},
							invalidate() {},
						};
					},
					{ placement: "aboveEditor" },
				);
			}
			this.requestRender?.();
		} catch {
			/* UI failure cannot dispatch, revoke authority or accept evidence. */
		}
	}

	dispose(): void {
		this.generation++;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.requestRender = undefined;
		try {
			this.ui?.setWidget(widgetKey, undefined);
		} catch {
			/* Already gone. */
		}
		this.ui = undefined;
		this.mounted = false;
	}
}
