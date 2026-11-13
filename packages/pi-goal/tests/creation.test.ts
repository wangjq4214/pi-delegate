import { describe, expect, spyOn, test } from "bun:test";
import {
	confirmationText,
	GoalCreation,
	type GoalProposalInput,
} from "../src/creation.ts";

const cwd = "/workspace/parser";
const values = (): GoalProposalInput => ({
	objective: "Fix the parser regression",
	criteria: ["Parser regression passes", "Existing tests still pass"],
	allowance: 7,
});
function draft() {
	const creation = new GoalCreation();
	creation.begin(
		"Fix the parser regression and keep existing tests passing",
		cwd,
	);
	const id = creation.status()?.id;
	if (!id) throw new Error("Expected a root draft");
	return { creation, id };
}

describe("R7 session-local draft lifecycle", () => {
	test("ordinary discussion has context but no proposal or execution authority", () => {
		const creation = new GoalCreation();
		expect(creation.status()).toBeUndefined();
		expect(creation.prompt()).toBeUndefined();
		creation.begin("  Fix the parser  ", cwd);
		expect(creation.status()).toMatchObject({ request: "Fix the parser", cwd });
		expect(creation.status()?.proposal).toBeUndefined();
		const prompt = creation.prompt();
		expect(prompt).toContain("no active execution authorization");
		expect(prompt).toContain("explicit positive integer allowance");
		expect(prompt).toContain("never invent a default");
		expect(prompt).toContain("normal model usage");
		expect(prompt).toContain("coordinator, worker and reviewer dispatches");
		expect(prompt).toContain("Ask only about material ambiguity");
		expect(prompt).toContain("Do not execute the task");
		expect(prompt).toContain(creation.status()?.id ?? "missing-id");
		creation.cancel();
		expect(creation.prompt()).toBeUndefined();
	});

	test.each([
		undefined,
		null,
		0,
		-1,
		1.5,
		Infinity,
		NaN,
		"7",
		true,
		Number.MAX_SAFE_INTEGER + 1,
	])(
		"allowance %p cannot offer valid start or silently default",
		(allowance) => {
			const { creation, id } = draft();
			expect(() =>
				creation.prepare(
					id,
					{ ...values(), allowance } as GoalProposalInput,
					cwd,
				),
			).toThrow("explicit positive safe integer");
			expect(creation.status()?.proposal).toBeUndefined();
		},
	);

	test.each([1, 7, Number.MAX_SAFE_INTEGER])(
		"explicit allowance %p is preserved",
		(allowance) => {
			const { creation, id } = draft();
			expect(
				creation.prepare(id, { ...values(), allowance }, cwd).values.allowance,
			).toBe(allowance);
		},
	);

	test.each([
		{ objective: " " },
		{ criteria: [] },
		{ criteria: [" "] },
		{ criteria: [42] },
		{ criteria: "passes" },
	])("incomplete structured values fail closed: %p", (invalid) => {
		const { creation, id } = draft();
		expect(() =>
			creation.prepare(
				id,
				{ ...values(), ...invalid } as GoalProposalInput,
				cwd,
			),
		).toThrow();
		expect(creation.status()?.proposal).toBeUndefined();
	});

	test("no root draft, absent/stale ID or mismatched cwd can prepare", () => {
		expect(() => new GoalCreation().prepare("invented", values(), cwd)).toThrow(
			"No matching goal draft",
		);
		const { creation, id } = draft();
		for (const badId of [undefined, "", "invented"]) {
			expect(() => creation.prepare(badId as string, values(), cwd)).toThrow(
				"No matching goal draft",
			);
		}
		expect(() => creation.prepare(id, values(), "/elsewhere")).toThrow(
			"No matching goal draft",
		);
	});

	test("displayed values are trimmed, copied and deeply immutable", () => {
		const { creation, id } = draft();
		const input = {
			objective: "  Fix parser  ",
			criteria: ["  Regression passes  "],
			allowance: 7,
		};
		const proposal = creation.prepare(id, input, cwd);
		const expected = {
			objective: "Fix parser",
			criteria: ["Regression passes"],
			allowance: 7,
			cwd,
		};
		expect(proposal.values).toEqual(expected);
		expect(proposal.values.criteria).not.toBe(input.criteria);
		expect(Object.isFrozen(proposal)).toBe(true);
		expect(Object.isFrozen(proposal.values)).toBe(true);
		expect(Object.isFrozen(proposal.values.criteria)).toBe(true);
		input.objective = "Changed behind the dialog";
		input.criteria.push("Unshown condition");
		input.allowance = 99;
		const status = creation.status();
		if (status) status.cwd = "/changed-status-copy";
		expect(Reflect.set(proposal.values, "allowance", 99)).toBe(false);
		expect(Reflect.set(proposal.values.criteria, "0", "Changed")).toBe(false);
		expect(proposal.values).toEqual(expected);
		expect(confirmationText(proposal)).toBe(
			[
				"Start this goal?",
				"Objective: Fix parser",
				"Acceptance conditions:",
				"• Regression passes",
				"Allowance: 7 goal dispatches (coordination, workers and independent review).",
				"Not a chat-turn, provider-request or cost limit.",
				`Working directory: ${cwd}`,
			].join("\n"),
		);
		creation.approve(proposal, cwd);
		const consumed = creation.consume(proposal, cwd);
		expect(consumed).toEqual(expected);
		consumed.criteria.push("Mutated returned copy");
		expect(proposal.values).toEqual(expected);
	});

	test("model confirmed:true does not grant approval; consumption requires runtime approval and is single-use", () => {
		const { creation, id } = draft();
		const proposal = creation.prepare(
			id,
			{ ...values(), confirmed: true } as GoalProposalInput,
			cwd,
		);
		expect(() => creation.consume(proposal, cwd)).toThrow("user-confirmed");
		creation.approve(proposal, cwd);
		expect(creation.consume(proposal, cwd)).toEqual({ ...values(), cwd });
		expect(() => creation.consume(proposal, cwd)).toThrow("user-confirmed");
		creation.approve(proposal, cwd);
		expect(() => creation.consume(proposal, cwd)).toThrow("user-confirmed");
	});

	test.each([
		"invalidate",
		"cancel",
		"begin",
		"replace",
		"malformed replacement",
	])("%s revokes approved snapshots and stale callbacks", (action) => {
		const { creation, id } = draft();
		const proposal = creation.prepare(id, values(), cwd);
		creation.approve(proposal, cwd);
		if (action === "invalidate") creation.invalidate();
		if (action === "cancel") creation.cancel();
		if (action === "begin") creation.begin("Replacement request", cwd);
		if (action === "replace")
			creation.prepare(id, { ...values(), objective: "Revised parser" }, cwd);
		if (action === "malformed replacement") {
			expect(() =>
				creation.prepare(id, { ...values(), allowance: 0 }, cwd),
			).toThrow();
		}
		expect(proposal.signal.aborted).toBe(true);
		expect(creation.isCurrent(proposal, cwd)).toBe(false);
		expect(() => creation.approve(proposal, cwd)).toThrow("no longer current");
		expect(() => creation.consume(proposal, cwd)).toThrow("user-confirmed");
	});

	test.each([
		{ objective: "Different objective" },
		{ criteria: ["Different condition"] },
		{ allowance: 8 },
	] as Partial<GoalProposalInput>[])(
		"revising %p needs a fresh approval",
		(change) => {
			const { creation, id } = draft();
			const old = creation.prepare(id, values(), cwd);
			creation.approve(old, cwd);
			const replacement = creation.prepare(id, { ...values(), ...change }, cwd);
			expect(old.signal.aborted).toBe(true);
			expect(() => creation.consume(replacement, cwd)).toThrow(
				"user-confirmed",
			);
			creation.approve(replacement, cwd);
			expect(creation.consume(replacement, cwd)).toEqual({
				...values(),
				...change,
				cwd,
			});
		},
	);

	test("working directory mismatch and lookalike proposals cannot reuse authority", () => {
		const { creation, id } = draft();
		const proposal = creation.prepare(id, values(), cwd);
		expect(() => creation.approve(proposal, "/elsewhere")).toThrow(
			"no longer current",
		);
		creation.approve(proposal, cwd);
		expect(() => creation.consume(proposal, "/elsewhere")).toThrow(
			"user-confirmed",
		);
		expect(() => creation.consume({ ...proposal }, cwd)).toThrow(
			"user-confirmed",
		);
	});

	test("authorization assertion detects a test-side bypass counterexample", () => {
		const { creation, id } = draft();
		const proposal = creation.prepare(id, values(), cwd);
		const rejectsUnconfirmed = (consume: () => unknown) => {
			expect(consume).toThrow("user-confirmed");
		};
		rejectsUnconfirmed(() => creation.consume(proposal, cwd));
		// Deliberately remove approval/identity checks on this instance only. The
		// same rejection oracle must fail for this real-method fault injection.
		const bypass = spyOn(creation, "consume").mockImplementation(() => ({
			...proposal.values,
			criteria: [...proposal.values.criteria],
		}));
		try {
			expect(() =>
				rejectsUnconfirmed(() => creation.consume(proposal, cwd)),
			).toThrow();
		} finally {
			bypass.mockRestore();
		}
		rejectsUnconfirmed(() => creation.consume(proposal, cwd));
	});
});
