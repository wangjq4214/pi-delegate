import { isAbsolute } from "node:path";

export type GoalStatus = "active" | "paused" | "complete";

export interface GoalItem {
	id: string;
	title: string;
	acceptance: string;
	status: "pending" | "accepted";
	evidence: string[];
	artifacts: string[];
}

export interface GoalAttempt {
	id: string;
	kind: "worker" | "reviewer" | "coordinator";
	itemId?: string;
	taskId?: string;
	status:
		| "running"
		| "completed"
		| "incomplete"
		| "failed"
		| "cancelled"
		| "interrupted";
	summary: string;
	usage?: unknown;
	partialOutput?: boolean;
}

export interface GoalState {
	id: string;
	cwd: string;
	objective: string;
	criteria: string[];
	status: GoalStatus;
	revision: number;
	workRevision: number;
	items: GoalItem[];
	attempts: GoalAttempt[];
	checkpoint: string;
	stopReason?: string;
	run?: { id: string; allowance: number; used: number };
	review?: {
		attemptId: string;
		workRevision: number;
		approved: boolean;
		summary: string;
	};
}

function requireValue(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Invalid goal state: ${message}`);
}

function object(
	value: unknown,
	keys: string[],
): asserts value is Record<string, unknown> {
	requireValue(
		value !== null && typeof value === "object" && !Array.isArray(value),
		"expected object",
	);
	requireValue(
		Object.keys(value).every((key) => keys.includes(key)),
		"unknown field",
	);
}

function string(value: unknown, nonempty = false): asserts value is string {
	requireValue(
		typeof value === "string" && (!nonempty || value.trim().length > 0),
		"expected string",
	);
}

function strings(value: unknown): asserts value is string[] {
	requireValue(Array.isArray(value), "expected string array");
	for (const entry of value) string(entry);
}

function revision(value: unknown): asserts value is number {
	requireValue(
		typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
		"invalid revision",
	);
}

function json(value: unknown, parents = new Set<unknown>()): void {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	requireValue(
		typeof value === "object" && value !== null && !parents.has(value),
		"usage must be finite JSON data",
	);
	requireValue(
		Array.isArray(value) ||
			Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null,
		"usage must be plain JSON data",
	);
	parents.add(value);
	for (const entry of Object.values(value)) json(entry, parents);
	parents.delete(value);
}

export function validateGoalId(id: string): void {
	requireValue(
		typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id),
		"invalid goal id",
	);
}

/** Validate the durable schema, not controller policy such as review approval. */
export function validateGoalState(value: unknown): asserts value is GoalState {
	object(value, [
		"id",
		"cwd",
		"objective",
		"criteria",
		"status",
		"revision",
		"workRevision",
		"items",
		"attempts",
		"checkpoint",
		"stopReason",
		"run",
		"review",
	]);
	string(value.id, true);
	validateGoalId(value.id);
	string(value.cwd, true);
	requireValue(isAbsolute(value.cwd), "cwd must be absolute");
	string(value.objective, true);
	strings(value.criteria);
	requireValue(
		["active", "paused", "complete"].includes(value.status as string),
		"invalid status",
	);
	revision(value.revision);
	revision(value.workRevision);
	requireValue(
		value.workRevision <= value.revision,
		"workRevision exceeds revision",
	);
	string(value.checkpoint);
	if (value.stopReason !== undefined) string(value.stopReason);
	requireValue(Array.isArray(value.items), "expected items array");
	const itemIds = new Set<string>();
	for (const item of value.items) {
		object(item, [
			"id",
			"title",
			"acceptance",
			"status",
			"evidence",
			"artifacts",
		]);
		string(item.id, true);
		requireValue(!itemIds.has(item.id), "duplicate item id");
		itemIds.add(item.id);
		string(item.title);
		string(item.acceptance);
		requireValue(
			item.status === "pending" || item.status === "accepted",
			"invalid item status",
		);
		strings(item.evidence);
		strings(item.artifacts);
	}
	requireValue(Array.isArray(value.attempts), "expected attempts array");
	const attemptIds = new Set<string>();
	for (const attempt of value.attempts) {
		object(attempt, [
			"id",
			"kind",
			"itemId",
			"taskId",
			"status",
			"summary",
			"usage",
			"partialOutput",
		]);
		string(attempt.id, true);
		requireValue(!attemptIds.has(attempt.id), "duplicate attempt id");
		attemptIds.add(attempt.id);
		requireValue(
			["worker", "reviewer", "coordinator"].includes(attempt.kind as string),
			"invalid attempt kind",
		);
		requireValue(
			[
				"running",
				"completed",
				"incomplete",
				"failed",
				"cancelled",
				"interrupted",
			].includes(attempt.status as string),
			"invalid attempt status",
		);
		string(attempt.summary);
		if (attempt.itemId !== undefined) {
			string(attempt.itemId, true);
			requireValue(itemIds.has(attempt.itemId), "unknown attempt item");
		}
		if (attempt.taskId !== undefined) string(attempt.taskId, true);
		if (attempt.partialOutput !== undefined)
			requireValue(
				typeof attempt.partialOutput === "boolean",
				"invalid partialOutput",
			);
		if (attempt.usage !== undefined) json(attempt.usage);
	}
	if (value.run !== undefined) {
		object(value.run, ["id", "allowance", "used"]);
		string(value.run.id, true);
		requireValue(
			typeof value.run.allowance === "number" &&
				Number.isFinite(value.run.allowance) &&
				value.run.allowance > 0,
			"allowance must be positive and finite",
		);
		requireValue(
			typeof value.run.used === "number" &&
				Number.isFinite(value.run.used) &&
				value.run.used >= 0 &&
				value.run.used <= value.run.allowance,
			"used must be within allowance",
		);
	}
	if (value.review !== undefined) {
		object(value.review, ["attemptId", "workRevision", "approved", "summary"]);
		string(value.review.attemptId, true);
		requireValue(
			attemptIds.has(value.review.attemptId),
			"unknown review attempt",
		);
		revision(value.review.workRevision);
		requireValue(
			value.review.workRevision <= value.workRevision,
			"review revision exceeds workRevision",
		);
		requireValue(
			typeof value.review.approved === "boolean",
			"invalid review approval",
		);
		string(value.review.summary);
	}
}

export function validateGoalTransition(
	previous: GoalState,
	next: GoalState,
): void {
	validateGoalState(next);
	requireValue(
		next.id === previous.id &&
			next.cwd === previous.cwd &&
			next.objective === previous.objective &&
			JSON.stringify(next.criteria) === JSON.stringify(previous.criteria),
		"id/cwd/objective/criteria are immutable",
	);
	requireValue(
		next.revision === previous.revision + 1,
		"revision must advance by one",
	);
	requireValue(
		next.workRevision >= previous.workRevision,
		"workRevision cannot decrease",
	);
	if (next.run && previous.run?.id === next.run.id) {
		requireValue(
			next.run.allowance === previous.run.allowance &&
				next.run.used >= previous.run.used,
			"run allowance is immutable and used cannot decrease",
		);
	}
}
