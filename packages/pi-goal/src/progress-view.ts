import type {
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { GoalController, GoalProgress } from "./controller.ts";
import type { GoalCreation } from "./creation.ts";
import { describeGoalActivity, displayText } from "./presentation.ts";

type Draft = ReturnType<GoalCreation["status"]>;
const widgetKey = "pi-goal:progress";
const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** A bounded first-clause summary; the original objective stays in details. */
function title(value: string): string {
	const clause =
		value.trim().split(/(?:[!?。！？;；，,]\s*|\.(?:\s|$)|\r?\n)/u, 1)[0] ||
		value;
	return displayText(clause);
}

/** A text-only, ephemeral projection; it neither accepts evidence nor owns execution. */
export function renderGoalProgress(
	progress: GoalProgress,
	draft: Draft,
	width: number,
	theme?: Pick<Theme, "fg">,
	frame = 0,
): string[] {
	if (width <= 0) return [];
	const lines: string[] = [];
	const paint = (text: string, color?: ThemeColor) => {
		const safe = displayText(text);
		return color && theme ? theme.fg(color, safe) : safe;
	};
	const line = (text: string) => lines.push(truncateToWidth(text, width));
	const state = progress.state;
	if (draft && !progress.runtimeActive && !progress.stopping) {
		line(
			`${paint("◇ Goal draft", "accent")} · ${truncateToWidth(paint(title(draft.request)), 56)}`,
		);
		line(paint("Not authorized · no plan or executing subagent", "muted"));
		return lines;
	}
	if (!state) {
		line(paint("Goal · no current goal or draft", "muted"));
		return lines;
	}
	const accepted = state.items.filter(
		(item) => item.status === "accepted",
	).length;
	const prefix = `${paint("◆ Goal", "accent")} · `;
	const count = `${paint(`${accepted}/${state.items.length}`, "accent")}${paint(" accepted", "muted")}`;
	const titleWidth = width - visibleWidth(prefix) - visibleWidth(count) - 2;
	if (titleWidth >= 4) {
		const heading =
			prefix +
			truncateToWidth(paint(title(state.objective)), Math.min(56, titleWidth));
		line(
			heading +
				" ".repeat(
					Math.max(2, width - visibleWidth(heading) - visibleWidth(count)),
				) +
				count,
		);
	} else {
		line(prefix + paint(title(state.objective)));
		line(count);
	}

	const activity = describeGoalActivity(progress);
	const symbol = activity.animated
		? (frames[frame % frames.length] ?? frames[0])
		: activity.symbol;
	const dispatch = progress.dispatch;
	const item =
		dispatch?.kind === "worker" && (progress.runtimeActive || progress.stopping)
			? ` · ${dispatch.itemId ?? "item unavailable"} · ${dispatch.itemTitle ?? "title unavailable"}`
			: "";
	line(`${paint(`${symbol} ${activity.text}`, activity.color)}${paint(item)}`);
	const remaining = state.run
		? state.run.allowance - state.run.used
		: undefined;
	line(
		state.run
			? `${paint(`${remaining}/${state.run.allowance}`, remaining !== undefined && remaining <= 1 ? "warning" : "muted")}${paint(" dispatches left", "dim")}`
			: paint("Dispatch allowance unavailable", "muted"),
	);

	if (progress.stopReason || state.stopReason)
		line(paint(`Stop: ${progress.stopReason ?? state.stopReason}`, "warning"));
	if (progress.reinspectionRequired && (dispatch || !progress.runtimeActive))
		line(paint("Recovery: reinspection required", "warning"));
	const review = state.review;
	if (review && activity.color !== "success") {
		const outcome =
			review.workRevision !== state.workRevision
				? "stale; unfinished"
				: review.approved
					? "approval recorded; not complete"
					: "not approved; unfinished";
		line(
			`${paint(`Review: ${outcome}`, "warning")} · ${paint(review.summary, "muted")}`,
		);
	} else if (!review) {
		const previous = state.attempts
			.filter((attempt) => attempt.kind === "reviewer")
			.at(-1);
		if (previous)
			line(
				`${paint(`Review: previous ${previous.status}; no current approval`, "warning")} · ${paint(previous.summary, "muted")}`,
			);
	}
	const last = state.attempts.at(-1);
	if (
		last &&
		["failed", "cancelled", "incomplete", "interrupted"].includes(last.status)
	)
		line(
			`${paint(`Last ${last.kind}: ${last.status}`, last.status === "failed" ? "error" : "warning")} · ${paint(last.summary, "muted")}`,
		);
	return lines;
}

function scheduleAnimation(tick: () => void): () => void {
	const timer = setInterval(tick, 120);
	timer.unref();
	return () => clearInterval(timer);
}

/** Owns only its widget, observations and animation. Disposal never cancels execution. */
export class GoalProgressView {
	private ui?: ExtensionContext["ui"];
	private unsubscribe?: () => void;
	private requestRender?: () => void;
	private generation = 0;
	private mounted = false;
	private snapshot?: GoalProgress;
	private frame = 0;
	private animation?: { cancel: () => void };

	constructor(
		private controller: GoalController,
		private draft: () => Draft,
		private schedule: (tick: () => void) => () => void = scheduleAnimation,
	) {}

	bind(ctx: Pick<ExtensionContext, "mode" | "ui">): void {
		if (ctx.mode !== "tui") {
			this.dispose();
			return;
		}
		if (this.ui === ctx.ui) return;
		this.dispose();
		this.ui = ctx.ui;
		this.unsubscribe = this.controller.subscribe(() => this.refresh());
		this.refresh();
	}

	private animate(active: boolean): void {
		if (!active) {
			const old = this.animation;
			this.animation = undefined;
			old?.cancel();
			this.frame = 0;
			return;
		}
		if (this.animation) return;
		const generation = this.generation;
		const animation = { cancel: () => {} };
		this.animation = animation;
		animation.cancel = this.schedule(() => {
			if (generation !== this.generation || this.animation !== animation)
				return;
			this.frame = (this.frame + 1) % frames.length;
			try {
				this.requestRender?.();
			} catch {
				/* Presentation cannot affect execution. */
			}
		});
	}

	refresh(): void {
		const ui = this.ui;
		if (!ui) return;
		try {
			// Clone authoritative state only on observation changes, never on animation ticks.
			this.snapshot = this.controller.progress();
			if (!this.mounted && (this.snapshot.state || this.draft())) {
				const generation = this.generation;
				ui.setWidget(
					widgetKey,
					(tui) => {
						if (generation === this.generation)
							this.requestRender = () => tui.requestRender();
						return {
							render: (width) => {
								if (generation !== this.generation || !this.snapshot) return [];
								try {
									return renderGoalProgress(
										this.snapshot,
										this.draft(),
										width,
										ui.theme,
										this.frame,
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
				this.mounted = true;
			}
			this.animate(
				this.mounted && describeGoalActivity(this.snapshot).animated,
			);
			this.requestRender?.();
		} catch {
			this.animate(false);
			/* UI failure cannot dispatch, revoke authority or accept evidence. */
		}
	}

	dispose(): void {
		this.generation++;
		this.animate(false);
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.requestRender = undefined;
		try {
			this.ui?.setWidget(widgetKey, undefined);
		} catch {
			/* Already gone. */
		}
		this.ui = undefined;
		this.snapshot = undefined;
		this.mounted = false;
	}
}
