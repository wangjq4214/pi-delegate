import type { DelegationResult } from "../../src/delegate.ts";
import { resolvePressure } from "../../src/pressure.ts";
import type { TaskInput } from "../../src/tasks.ts";
import { sumUsage } from "../../src/usage.ts";

export const taskInput: TaskInput = {
	task: "first line\nPRIVATE TASK BODY",
	title: "Review",
	mode: "background",
	cwd: process.cwd(),
	configuration: {
		model: { provider: "fixture", id: "fixture-model" },
		thinkingLevel: "high",
	},
	pressure: resolvePressure(),
};
export function taskResult(
	status: DelegationResult["details"]["status"] = "completed",
): DelegationResult {
	return {
		content: [{ type: "text", text: "available result" }],
		details: { status },
		usage: sumUsage([]),
		isError: status === "failed" || status === "cancelled",
	};
}
