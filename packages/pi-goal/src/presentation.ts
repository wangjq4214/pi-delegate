import type { GoalCreation } from "./creation.ts";
import type { GoalState } from "./model.ts";
import type { GoalStore } from "./store.ts";

/** Plain text for native notifications, never ANSI/OSC or injected display rows. */
export function displayText(value: string): string {
	return value.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: escape terminal controls rather than executing them
		/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g,
		(character) => {
			if (character === "\n") return "\\n";
			if (character === "\r") return "\\r";
			if (character === "\t") return "\\t";
			return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
		},
	);
}

function excerpt(value: string, limit: number): string {
	const characters = Array.from(displayText(value));
	return characters.length > limit
		? `${characters.slice(0, limit).join("")}… [truncated]`
		: characters.join("");
}

function progress(state: GoalState): string {
	const accepted = state.items.filter(
		(item) => item.status === "accepted",
	).length;
	return `${accepted}/${state.items.length} accepted · ${state.items.length - accepted} pending`;
}

function allowance(state: GoalState): string {
	return state.run
		? `${state.run.allowance - state.run.used} remaining / ${state.run.allowance} authorized (${state.run.used} used)`
		: "Unavailable (no saved run)";
}

function review(state: GoalState): string[] {
	const assessment = state.review;
	if (!assessment) {
		const previous = state.attempts
			.filter((attempt) => attempt.kind === "reviewer")
			.at(-1);
		return [
			"Independent review: No current assessment",
			...(previous
				? [
						`Previous reviewer execution: ${previous.status} (historical; not current approval)`,
						`Previous review report: ${excerpt(previous.summary, 600) || "Unavailable"}`,
					]
				: []),
		];
	}
	const outcome =
		assessment.workRevision !== state.workRevision
			? "Stale (not current approval)"
			: assessment.approved
				? "Approved for current work"
				: "Not approved for current work";
	const attempt = state.attempts.find(
		(entry) => entry.id === assessment.attemptId,
	);
	return [
		`Independent review: ${outcome}`,
		...(attempt ? [`Reviewer execution: ${attempt.status}`] : []),
		`Review summary: ${excerpt(assessment.summary, 600) || "Unavailable"}`,
	];
}

/** Native notify owns Unicode wrapping, current-theme styling and redraws. */
export function formatGoalList(
	listing: Awaited<ReturnType<GoalStore["list"]>>,
): string {
	const lines = ["Saved goals", "Saved status is not proof of live execution."];
	if (!listing.goals.length) lines.push("No saved goals.");
	for (const state of listing.goals) {
		lines.push(
			"",
			`Goal: ${excerpt(state.objective, 120)}`,
			`ID: ${displayText(state.id)}`,
			`Saved status: ${state.status} · ${progress(state)}`,
			`Working directory: ${displayText(state.cwd)}`,
		);
	}
	if (listing.errors.length) {
		lines.push("", "Unreadable goal records (not repaired):");
		for (const error of listing.errors)
			lines.push(
				`ID: ${displayText(error.id)}`,
				`Error: ${displayText(error.error)}`,
			);
	}
	return lines.join("\n");
}

export function formatGoalStatus(
	state: GoalState,
	current?: { runtimeActive: boolean; reinspectionRequired: boolean },
): string {
	const lines = [
		current ? "Current goal" : "Saved goal",
		`ID: ${displayText(state.id)}`,
		`Objective: ${displayText(state.objective)}`,
		`Working directory: ${displayText(state.cwd)}`,
		`Saved status: ${state.status}`,
		current
			? current.runtimeActive
				? "Runtime: Goal coordination authorized in this runtime; child activity is not observed here."
				: "Runtime: Inactive in this runtime; saved status is not proof of live execution."
			: "Saved observation only; not proof of live execution or ownership.",
		`Progress: ${progress(state)}`,
		"Worker completion is not item acceptance; all items accepted is not goal completion.",
		`Dispatch allowance: ${allowance(state)}`,
		"Allowance counts coordinator, worker and reviewer dispatches, not model turns, tokens, cost or time.",
		`Stop reason: ${state.stopReason ? displayText(state.stopReason) : "None recorded"}`,
		current
			? current.reinspectionRequired
				? "Reinspection: Required before further work or review"
				: "Reinspection: Not currently required; explicit resume rechecks saved work."
			: "Reinspection: Unknown from saved state; explicit resume requires inspection.",
		...review(state),
		"",
		"Acceptance conditions:",
		...(state.criteria.length
			? state.criteria.map((criterion) => `- ${displayText(criterion)}`)
			: ["None recorded"]),
		"",
		"Work items:",
	];
	if (!state.items.length) lines.push("No work items planned.");
	for (const item of state.items)
		lines.push(
			`- ${displayText(item.id)} · ${item.status}: ${displayText(item.title)}`,
			`  Acceptance: ${displayText(item.acceptance)}`,
		);
	if (state.checkpoint)
		lines.push("", `Checkpoint: ${excerpt(state.checkpoint, 600)}`);
	return lines.join("\n");
}

export function formatCurrentGoal(report: {
	draft?: ReturnType<GoalCreation["status"]>;
	state?: GoalState;
	runtimeActive: boolean;
	reinspectionRequired: boolean;
}): string {
	const sections: string[] = [];
	if (report.state) sections.push(formatGoalStatus(report.state, report));
	if (report.draft) {
		const { id, request, cwd, proposal } = report.draft;
		sections.push(
			[
				"Goal draft (not authorized to execute)",
				`Draft ID: ${displayText(id)}`,
				`Request: ${displayText(request)}`,
				`Working directory: ${displayText(cwd)}`,
				...(proposal
					? [
							`Proposed objective: ${displayText(proposal.objective)}`,
							"Proposed acceptance conditions:",
							...proposal.criteria.map(
								(criterion) => `- ${displayText(criterion)}`,
							),
							`Proposed dispatch allowance: ${proposal.allowance} (not yet authorized)`,
						]
					: ["Proposal/dispatch allowance: Not yet submitted"]),
				"Only runtime Start confirmation authorizes execution.",
			].join("\n"),
		);
	}
	return sections.join("\n\n") || "No current goal or draft.";
}
