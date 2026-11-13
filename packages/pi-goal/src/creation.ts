import { randomUUID } from "node:crypto";
import { allowanceValue } from "./controller.ts";

export interface GoalProposalInput {
	objective: string;
	criteria: string[];
	allowance: number;
}

export interface GoalProposal {
	readonly values: Readonly<{
		objective: string;
		criteria: readonly string[];
		allowance: number;
		cwd: string;
	}>;
	readonly signal: AbortSignal;
}

function nonempty(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim())
		throw new Error(`${name} is required`);
	return value.trim();
}

/** Session-local proposals are not execution authority or durable goal state. */
export class GoalCreation {
	private draft?: { id: string; request: string; cwd: string };
	private pending?: {
		proposal: GoalProposal;
		cancellation: AbortController;
		approved: boolean;
		consumed: boolean;
	};

	begin(request: string, cwd: string): void {
		this.cancel();
		this.draft = {
			id: randomUUID(),
			request: nonempty(request, "Goal request"),
			cwd,
		};
	}

	status() {
		return this.draft
			? { ...this.draft, proposal: this.pending?.proposal.values }
			: undefined;
	}

	invalidate(): void {
		this.pending?.cancellation.abort();
		this.pending = undefined;
	}

	cancel(): void {
		this.invalidate();
		this.draft = undefined;
	}

	prepare(
		draftId: string,
		input: GoalProposalInput,
		cwd: string,
	): GoalProposal {
		// Even a malformed replacement must not leave an old confirmation valid.
		this.invalidate();
		if (!this.draft || draftId !== this.draft.id || cwd !== this.draft.cwd)
			throw new Error(
				"No matching goal draft in this working directory; use /goal <objective>",
			);
		const objective = nonempty(input.objective, "Objective");
		if (!Array.isArray(input.criteria) || !input.criteria.length)
			throw new Error("At least one acceptance condition is required");
		const criteria = input.criteria.map((value) =>
			nonempty(value, "Acceptance condition"),
		);
		const allowance = allowanceValue(input.allowance);
		const cancellation = new AbortController();
		const proposal: GoalProposal = Object.freeze({
			values: Object.freeze({
				objective,
				criteria: Object.freeze(criteria),
				allowance,
				cwd,
			}),
			signal: cancellation.signal,
		});
		this.pending = { proposal, cancellation, approved: false, consumed: false };
		return proposal;
	}

	isCurrent(proposal: GoalProposal, cwd: string): boolean {
		return (
			this.pending?.proposal === proposal &&
			!proposal.signal.aborted &&
			this.draft?.cwd === cwd &&
			proposal.values.cwd === cwd
		);
	}

	/** Called only with the result of the runtime-owned user dialog. */
	approve(proposal: GoalProposal, cwd: string): void {
		if (!this.isCurrent(proposal, cwd) || !this.pending)
			throw new Error("Goal confirmation is no longer current");
		this.pending.approved = true;
	}

	consume(
		proposal: GoalProposal,
		cwd: string,
	): GoalProposalInput & { cwd: string } {
		if (
			!this.isCurrent(proposal, cwd) ||
			!this.pending?.approved ||
			this.pending.consumed
		)
			throw new Error("A current user-confirmed goal draft is required");
		this.pending.consumed = true;
		return { ...proposal.values, criteria: [...proposal.values.criteria] };
	}

	prompt(): string | undefined {
		if (!this.draft) return undefined;
		return [
			"Goal creation discussion only: no active execution authorization.",
			`Draft ID: ${this.draft.id}`,
			`Working directory: ${this.draft.cwd}`,
			`Original user request: ${this.draft.request}`,
			"Use this conversation to organize the objective and acceptance conditions. Ask only about material ambiguity or missing required information.",
			"Obtain an explicit positive integer allowance from the user; never invent a default. Clarification is ordinary chat with normal model usage, not goal-authorized automatic continuation.",
			"Explain that execution allowance shares coordinator, worker and reviewer dispatches, not chat turns or an exact model-request/cost ceiling.",
			"Do not execute the task, dispatch workers or use execution tools during drafting. When the objective, criteria and user-supplied allowance are ready, call goal_propose with this draft ID.",
			"The tool presents a runtime-owned Start/Cancel choice. Chat assent and model-supplied approval cannot start work. Do not claim execution has started merely because you proposed a draft.",
		].join("\n");
	}
}

export function confirmationText(proposal: GoalProposal): string {
	const { objective, criteria, allowance, cwd } = proposal.values;
	return [
		"Start this goal?",
		`Objective: ${objective}`,
		"Acceptance conditions:",
		...criteria.map((criterion) => `• ${criterion}`),
		`Allowance: ${allowance} goal dispatches (coordination, workers and independent review).`,
		"Not a chat-turn, provider-request or cost limit.",
		`Working directory: ${cwd}`,
	].join("\n");
}
