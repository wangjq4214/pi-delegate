import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type * as PublicAPI from "../../src/api.ts";

export default async function consumer(pi: ExtensionAPI): Promise<void> {
	const path = process.env.API_FIXTURE_ENTRY;
	if (!path) throw new Error("Missing API fixture entry");
	const api = (await import(pathToFileURL(path).href)) as typeof PublicAPI;
	// Deliberately register even in children: exercise the host exclusion allowlist
	// against an accidentally unguarded inherited tool, not only the marker guard.
	for (const exposure of ["direct", "deferred"] as const) {
		pi.registerTool(
			defineTool({
				name: `fixture_parent_${exposure}`,
				label: "Parent-only fixture",
				description: "Must not be inherited by children",
				exposure,
				parameters: Type.Object({}),
				async execute() {
					throw new Error("Parent-only fixture must not execute");
				},
			}),
		);
	}
	if (api.isDelegatedChild()) {
		pi.on("session_start", () => {
			let error = "";
			try {
				api.getDelegateClient(pi);
			} catch (cause) {
				error = String(cause);
			}
			writeFileSync(
				join(process.env.FIXTURE_LOG_DIR ?? "", `${process.pid}.api-child`),
				error,
			);
		});
		return;
	}
	api.registerParentOnlyTools(pi, [
		"fixture_parent_direct",
		"fixture_parent_deferred",
	]);
	pi.registerCommand("api-execute", {
		handler: async (task, ctx) => {
			const client = api.getDelegateClient(pi);
			const signal = task.includes("hang")
				? AbortSignal.timeout(2500)
				: undefined;
			const result = await client.execute(
				{
					task,
					title: "goal-like API work",
					context: "consumer explicit context",
					resultFormat: "handoff",
				},
				ctx,
				signal,
			);
			pi.appendEntry("api:result", {
				result,
				list: client.list(),
				status: result.details.taskId
					? client.status(result.details.taskId)
					: undefined,
			});
		},
	});
}
