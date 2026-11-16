import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import type { getDelegateClient } from "../../../pi-delegate/src/api.ts";

// The caller supplies the real SOURCE or BUILT public API, never a fake API.
export function registerProbe(
	pi: ExtensionAPI,
	discover: typeof getDelegateClient,
): void {
	let pending: ExtensionToolContext | undefined;
	// A command queries the pending native tool context, not a private goal controller.
	// Nested public calls emit tool events but add no model/transcript messages.
	pi.registerCommand("host-call", {
		description: "Test-only read-only observation while a goal tool is pending",
		async handler(raw) {
			const request = JSON.parse(raw);
			const client = discover(pi);
			let result: unknown;
			if (request.name === "api_list")
				result = { ...client.list(), capabilities: client.capabilities };
			else if (request.name === "api_status")
				result = client.status(request.args.taskId);
			else {
				if (!pending) throw new Error("No pending fixture tool context");
				if (
					![
						"goal_status",
						"delegate_list",
						"delegate_status",
						"delegate_cancel",
					].includes(request.name)
				)
					throw new Error("Unsupported fixture observation");
				const outcome = await pending.executeTool(
					request.name,
					request.args ?? {},
				);
				result = { ...outcome.result, isError: outcome.isError };
			}
			const logs = process.env.GOAL_HOST_LOGS;
			if (!logs) throw new Error("Missing isolated GOAL_HOST_LOGS");
			appendFileSync(
				join(logs, `${process.pid}.jsonl`),
				`${JSON.stringify({ type: "probe", id: request.id, result })}\n`,
			);
		},
	});
	pi.registerTool({
		name: "host_api",
		label: "Public delegate API probe",
		description:
			"Observe the real public runtime or execute an ordinary fixture task",
		parameters: Type.Object({
			execute: Type.Optional(Type.Boolean()),
			goalTool: Type.Optional(
				Type.Union([Type.Literal("goal_work"), Type.Literal("goal_review")]),
			),
			goalArgs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
		}),
		async execute(_id, args, signal, _update, ctx) {
			const client = discover(pi);
			if (args.goalTool) {
				pending = ctx;
				try {
					const outcome = await ctx.executeTool(
						args.goalTool,
						args.goalArgs ?? {},
						{ signal },
					);
					// Pi accounts nested usage automatically; do not return it a second time.
					return {
						content: outcome.result.content,
						isError: outcome.isError,
						terminate: outcome.result.terminate,
						details: {
							...(outcome.result.details as object),
							hostTool: args.goalTool,
						},
					};
				} finally {
					pending = undefined;
				}
			}
			if (args.execute)
				return client.execute(
					{ task: "ORDINARY source/built API consumer" },
					ctx,
					signal,
				);
			const value = client.list();
			return {
				content: [{ type: "text", text: JSON.stringify(value) }],
				details: value,
			};
		},
	});
}
