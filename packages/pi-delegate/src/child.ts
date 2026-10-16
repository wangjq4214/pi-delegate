import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	INIT_COMMAND,
	INIT_ENTRY,
	type InheritanceSnapshot,
	SNAPSHOT_ENV,
	validateChild,
} from "./inheritance.ts";
import {
	createInitializationProgressReporter,
	type InitializationProgress,
} from "./initialization-progress.ts";

export function registerChild(pi: ExtensionAPI): void {
	const path = process.env[SNAPSHOT_ENV];
	const report = createInitializationProgressReporter(path);
	pi.registerCommand(INIT_COMMAND, {
		description: "Initialize an RPC child (internal to pi-delegate)",
		handler: async () => {
			let observed: Pick<
				InitializationProgress,
				"expectedTools" | "availableTools" | "missingTools" | "missingToolCount"
			> = {};
			try {
				report({ phase: "waiting-tools" });
				if (!path) throw new Error("Missing child inheritance snapshot");
				const snapshot = JSON.parse(
					readFileSync(path, "utf8"),
				) as InheritanceSnapshot;
				if (
					snapshot.version !== 1 ||
					!Array.isArray(snapshot.tools) ||
					!Array.isArray(snapshot.active)
				) {
					throw new Error("Invalid child inheritance snapshot");
				}
				// MCP connections start asynchronously on session_start. No task is submitted until
				// every inherited tool is available. A missing runtime registration fails explicitly.
				const deadline = Date.now() + 30_000;
				while (true) {
					const available = new Set(pi.getAllTools().map((tool) => tool.name));
					const missing = snapshot.tools
						.filter((tool) => !available.has(tool.name))
						.map((tool) => tool.name);
					observed = {
						expectedTools: snapshot.tools.length,
						availableTools: available.size,
						missingTools: missing,
						missingToolCount: missing.length,
					};
					report({ phase: "waiting-tools", ...observed });
					if (!missing.length || Date.now() >= deadline) break;
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				// Keep schema, exposure, unexpected-tool and activation checks intact.
				report({ phase: "validating", ...observed });
				validateChild(pi, snapshot);
				pi.appendEntry(INIT_ENTRY, { ok: true });
				report({ phase: "ready", ...observed });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				report({ phase: "failed", ...observed, error: message });
				pi.appendEntry(INIT_ENTRY, { ok: false, error: message });
			}
		},
	});
	report({ phase: "extension-loaded" });
}
