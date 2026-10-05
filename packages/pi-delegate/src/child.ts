import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	INIT_COMMAND,
	INIT_ENTRY,
	type InheritanceSnapshot,
	SNAPSHOT_ENV,
	validateChild,
} from "./inheritance.ts";

export function registerChild(pi: ExtensionAPI): void {
	pi.registerCommand(INIT_COMMAND, {
		description: "Initialize an RPC child (internal to pi-delegate)",
		handler: async () => {
			try {
				const path = process.env[SNAPSHOT_ENV];
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
				while (
					snapshot.tools.some(
						(tool) =>
							!pi.getAllTools().some((actual) => actual.name === tool.name),
					)
				) {
					if (Date.now() >= deadline) break;
					await new Promise((resolve) => setTimeout(resolve, 50));
				}
				validateChild(pi, snapshot);
				pi.appendEntry(INIT_ENTRY, { ok: true });
			} catch (error) {
				pi.appendEntry(INIT_ENTRY, {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	});
}
