import { Type } from "typebox";

import { budgetInstructions, type ExecutionBudget } from "./budget.ts";
export type ResultFormat = "handoff";

export const resultFormatParameter = Type.Literal("handoff", {
	description:
		"Request a concise advisory handoff: completed/unfinished work, changed paths, available artifacts, performed/omitted checks, and blockers/parent decisions. Omitted keeps free-text behavior. Explicit task output requirements prevail; grants no extra action permissions. Not validated; completion is not acceptance.",
});

export function validateResultFormat(
	value: unknown,
): asserts value is ResultFormat | undefined {
	if (value !== undefined && value !== "handoff")
		throw new Error('resultFormat must be "handoff" when supplied');
}

const HANDOFF_INSTRUCTIONS = `Result reporting convention (advisory):
Explicit task-specific output requirements take precedence over this convention. If they conflict (for example, return only JSON), follow those requirements instead of adding handoff sections.
Otherwise, finish with a concise, readable handoff covering:
- Completion: completed work and main conclusions; separately state unfinished work or remaining scope.
- Changes: changed file paths with short descriptions, or explicitly state no file changes.
- Deliverables: available commit references, patch paths or other artifact paths, or explicitly state none are available.
- Verification: checks actually performed, their commands and results; checks not performed and the reasons.
- Blockers and decisions: blockers and decisions needed from the parent, with options/recommendation when applicable, or explicitly state none are needed.
Report facts only: unknown information is unknown, unperformed checks are unperformed, and unavailable artifacts are unavailable. Do not invent paths, results or completion claims to fill sections. Analysis/review/testing tasks need not change files or use Git.
This convention grants no extra permission for file edits, commits, patch generation or other artifact creation; act only within the actual task's authorized scope.
The report is a navigation aid, not an integration artifact or proof of correctness, passing checks or acceptance. The parent owns artifact inspection, acceptance, integration and necessary validation. This is a reporting request, not an enforced schema.`;

export function delegationPrompt(
	task: string,
	context?: string,
	resultFormat?: ResultFormat,
	budget?: ExecutionBudget,
): string {
	validateResultFormat(resultFormat);
	// Prefixing keeps tasks beginning with '/' from becoming extension commands.
	const prompt = `Task:\n${task}${context === undefined ? "" : `\n\nSupplementary context:\n${context}`}`;
	const report =
		resultFormat === "handoff"
			? `${prompt}\n\n${HANDOFF_INSTRUCTIONS}`
			: prompt;
	return budget ? `${report}\n\n${budgetInstructions(budget)}` : report;
}
