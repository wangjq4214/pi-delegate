import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getPackageDir, initTheme } from "@earendil-works/pi-coding-agent";
import type { GoalState } from "../src/model.ts";
import {
	displayText,
	formatCurrentGoal,
	formatGoalList,
	formatGoalStatus,
} from "../src/presentation.ts";

function state(): GoalState {
	return {
		id: `goal-${"i".repeat(123)}`,
		objective: "Verify the parser 修复解析器",
		cwd: "/projects/中文/é/👩‍💻",
		criteria: ["Regression passes", "Existing behavior preserved"],
		status: "active",
		revision: 4,
		workRevision: 2,
		items: [
			{
				id: "done",
				title: "Verified item",
				acceptance: "Test passes",
				status: "accepted",
				evidence: ["SECRET EVIDENCE"],
				artifacts: [],
			},
			{
				id: "pending",
				title: "Await assessment",
				acceptance: "Inspect actual result",
				status: "pending",
				evidence: [],
				artifacts: [],
			},
		],
		attempts: [
			{
				id: "worker",
				kind: "worker",
				itemId: "pending",
				taskId: "old-task",
				status: "completed",
				summary: "SECRET REPORT",
			},
		],
		checkpoint: "Inspect evidence before acceptance",
		run: { id: "run", allowance: 7, used: 2 },
	};
}

describe("goal human presentation", () => {
	test("list summaries keep full lookup identity, not report/evidence bodies", () => {
		const goal = state();
		const before = structuredClone(goal);
		const output = formatGoalList({
			goals: [
				goal,
				{ ...goal, id: "paused", status: "paused", cwd: "/other-project" },
				{ ...goal, id: "complete", status: "complete" },
			],
			errors: [{ id: "damaged", error: "Unsupported journal" }],
		});
		for (const value of [
			goal.id,
			goal.objective,
			goal.cwd,
			"active",
			"paused",
			"complete",
			"1/2 accepted",
			"damaged",
			"Unsupported journal",
			"not proof of live execution",
		])
			expect(output).toContain(value);
		for (const secret of ["SECRET EVIDENCE", "SECRET REPORT", goal.checkpoint])
			expect(output).not.toContain(secret);
		expect(goal).toEqual(before);
		expect(formatGoalList({ goals: [], errors: [] })).toContain(
			"No saved goals.",
		);
		expect(
			formatGoalList({
				goals: [],
				errors: [{ id: "broken", error: "Torn tail" }],
			}),
		).toContain("Unreadable goal records");
	});

	test("status describes acceptance, allowance and saved/live limitations without inventing observations", () => {
		const goal = state();
		const before = structuredClone(goal);
		const output = formatGoalStatus(goal);
		for (const value of [
			"Saved goal",
			goal.id,
			goal.objective,
			...goal.criteria,
			"1/2 accepted",
			"5 remaining / 7 authorized (2 used)",
			"not model turns, tokens, cost or time",
			"not proof of live execution or ownership",
			"No current assessment",
			"Unknown from saved state",
			"Await assessment",
			"Inspect actual result",
		])
			expect(output).toContain(value);
		expect(output).not.toContain("SECRET REPORT");
		expect(output).not.toContain("SECRET EVIDENCE");
		expect(goal).toEqual(before);
		const current = formatCurrentGoal({
			state: goal,
			runtimeActive: true,
			reinspectionRequired: true,
		});
		expect(current).toContain("Goal coordination authorized in this runtime");
		expect(current).toContain("no current child");
		expect(current).toContain("Required before further work or review");
		expect(
			formatCurrentGoal({
				state: goal,
				runtimeActive: false,
				reinspectionRequired: false,
			}),
		).toContain("Inactive in this runtime");
		delete goal.run;
		goal.items = [];
		expect(formatGoalStatus(goal)).toContain("Unavailable (no saved run)");
		expect(formatGoalStatus(goal)).toContain("No work items planned.");
	});

	test("invalidated assessment retains the latest reviewer report without reusing old approval", () => {
		const goal = state();
		goal.attempts.push(
			{
				id: "earlier-review",
				kind: "reviewer",
				status: "failed",
				summary: "OLD REVIEW ERROR",
			},
			{
				id: "latest-review",
				kind: "reviewer",
				status: "completed",
				summary: "Prior files matched\n<approved/>",
			},
		);
		const output = formatGoalStatus(goal);
		expect(output).toContain("No current assessment");
		expect(output).toContain(
			"Previous reviewer execution: completed (historical; not current approval)",
		);
		expect(output).toContain("Prior files matched\\n<approved/>");
		expect(output).not.toContain("Approved for current work");
		expect(output).not.toContain("OLD REVIEW ERROR");
	});
	for (const approved of [true, false])
		for (const stale of [true, false])
			test(`${approved ? "approved" : "rejected"} ${stale ? "stale" : "current"} assessment remains distinct from goal completion`, () => {
				const goal = state();
				goal.review = {
					attemptId: "review",
					workRevision: stale ? 1 : 2,
					approved,
					summary: "Examined actual files",
				};
				goal.attempts.push({
					id: "review",
					kind: "reviewer",
					status: approved ? "completed" : "failed",
					summary: "Examined actual files",
				});
				goal.stopReason = "Needs user decision";
				const output = formatGoalStatus(goal);
				expect(output).toContain(
					stale
						? "Stale (not current approval)"
						: approved
							? "Approved for current work"
							: "Not approved for current work",
				);
				expect(output).toContain("Saved status: active");
				expect(output).toContain("Review summary: Examined actual files");
				expect(output).toContain("Needs user decision");
			});

	test("draft, submitted proposal and empty current report do not assert execution authority", () => {
		const report = { runtimeActive: false, reinspectionRequired: false };
		expect(formatCurrentGoal(report)).toBe("No current goal or draft.");
		const draft = {
			id: "draft",
			request: "Fix parser",
			cwd: "/project",
			proposal: {
				objective: "Fix regression",
				criteria: ["Test passes"],
				allowance: 7,
				cwd: "/project",
			},
		};
		const output = formatCurrentGoal({ ...report, draft });
		for (const value of [
			"not authorized to execute",
			"draft",
			"Fix parser",
			"Fix regression",
			"Test passes",
			"7 (not yet authorized)",
			"Only runtime Start confirmation",
		])
			expect(output).toContain(value);
		expect(formatCurrentGoal({ ...report, state: state(), draft })).toContain(
			"Current goal",
		);
		expect(formatCurrentGoal({ ...report, state: state(), draft })).toContain(
			"Goal draft",
		);
	});

	test("control/ANSI/OSC/bidi data is visible text, summaries are bounded and exact IDs are not truncated", () => {
		const unsafe =
			"hello\nSaved status: complete\r\t\x1b[2J\x1b]52;c;secret\x07\u009b31m\u202e";
		expect(displayText(unsafe)).toBe(
			"hello\\nSaved status: complete\\r\\t\\u001b[2J\\u001b]52;c;secret\\u0007\\u009b31m\\u202e",
		);
		const goal = state();
		goal.objective = unsafe.repeat(30);
		goal.cwd = unsafe;
		goal.criteria = [unsafe];
		const firstItem = goal.items[0];
		if (!firstItem) throw new Error("Missing fixture item");
		firstItem.title = unsafe;
		goal.review = {
			attemptId: "worker",
			workRevision: 2,
			approved: false,
			summary: unsafe.repeat(100),
		};
		const listing = formatGoalList({
			goals: [goal],
			errors: [{ id: unsafe, error: unsafe }],
		});
		const detail = formatGoalStatus(goal);
		expect(listing).toContain("[truncated]");
		expect(listing).toContain(`ID: ${goal.id}`);
		expect(detail).toContain("[truncated]");
		for (const output of [listing, detail]) {
			expect(output).not.toContain("\x1b");
			expect(output).not.toContain("\r");
			expect(output).not.toContain("\u009b");
			expect(output).not.toContain("\u202e");
			expect(output).not.toContain("\nSaved status: complete");
		}
	});
});

test.serial(
	"real pinned host notification wraps Unicode and long IDs and re-themes on invalidation",
	async () => {
		// The real notify → showStatus → ThemedText path, not a manual TUI/IME test.
		// Resolve the host's own TUI dependency; production formatting adds no dependency.
		const require = createRequire(
			import.meta.resolve("@earendil-works/pi-coding-agent"),
		);
		const { visibleWidth, stripTerminalSequences } = await import(
			pathToFileURL(require.resolve("@earendil-works/pi-tui")).href
		);
		const { InteractiveMode } = await import(
			pathToFileURL(
				join(getPackageDir(), "dist/modes/interactive/interactive-mode.js"),
			).href
		);
		const themes = await import(
			pathToFileURL(
				join(getPackageDir(), "dist/modes/interactive/theme/theme.js"),
			).href
		);
		initTheme("dark");
		type Component = { render(width: number): string[]; invalidate(): void };
		const children: Component[] = [];
		const receiver = {
			chatContainer: {
				children,
				addChild(child: Component) {
					children.push(child);
				},
			},
			ui: { requestRender() {} },
			showStatus: InteractiveMode.prototype.showStatus,
		};
		const goal = state();
		try {
			for (const message of [
				formatGoalList({ goals: [goal], errors: [] }),
				formatGoalStatus(goal),
			]) {
				InteractiveMode.prototype.showExtensionNotify.call(
					receiver,
					message,
					"info",
				);
				for (const width of [8, 12, 20, 40, 80, 160]) {
					const lines = children.flatMap((child) => child.render(width));
					for (const line of lines)
						expect(visibleWidth(line)).toBeLessThanOrEqual(width);
					const plain = stripTerminalSequences(lines.join("\n"));
					// Soft wrapping may split an ID, but must not abbreviate/lose it.
					expect(plain.replace(/\s/g, "")).toContain(goal.id);
				}
			}
			const component = children.at(-1);
			if (!component) throw new Error("No host notification component");
			const dark = component.render(80).join("\n");
			const [darkColor] = themes.theme
				.fg("dim", "Saved goal")
				.split("Saved goal");
			expect(dark).toContain(`${darkColor}Saved goal`);
			expect(themes.setTheme("light").success).toBe(true);
			for (const child of children) child.invalidate();
			const light = component.render(80).join("\n");
			const [lightColor] = themes.theme
				.fg("dim", "Saved goal")
				.split("Saved goal");
			expect(light).toContain(`${lightColor}Saved goal`);
			expect(stripTerminalSequences(light)).toBe(stripTerminalSequences(dark));
			expect(light).not.toBe(dark);
		} finally {
			themes.setTheme("dark");
		}
	},
);
