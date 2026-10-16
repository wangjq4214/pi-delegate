import type { StartupDiagnostics } from "./delegation.ts";

const duration = (ms: number) => `${(ms / 1_000).toFixed(2)}s`;

/** Observations, not a guessed root cause; shared by tool results and the task panel. */
export function formatStartupDiagnostics(
	diagnostics: StartupDiagnostics,
): string {
	const lines = [`Startup stage: ${diagnostics.stage}`];
	if (diagnostics.elapsedMs !== undefined)
		lines.push(
			`Startup elapsed: ${duration(diagnostics.elapsedMs)} (before cleanup)`,
		);
	if (diagnostics.operation)
		lines.push(`Last operation: ${diagnostics.operation}`);
	if (diagnostics.timings?.length)
		lines.push(
			`Startup timings: ${diagnostics.timings.map((step) => `${step.operation}=${duration(step.elapsedMs)}`).join(" · ")}`,
		);
	const timeout = diagnostics.timeout;
	if (timeout) {
		lines.push(
			`RPC timeout: ${timeout.command} [${timeout.id}] · limit ${duration(timeout.timeoutMs)} · observed ${duration(timeout.elapsedMs)} · pipe write ${timeout.writeState}`,
		);
		lines.push(
			timeout.writeState === "written"
				? "The pipe write completed, but no matching RPC response arrived. Host acceptance is unknown; the request was not retried."
				: "The pipe write had not completed at timeout. Child startup or pipe backpressure may be pending; the request was not retried.",
		);
	}
	const init = diagnostics.initialization;
	if (init) {
		lines.push(
			`Initialization checkpoint: ${init.phase} · checkpoint at ${duration(init.elapsedMs)} since child extension registration`,
		);
		if (init.expectedTools !== undefined)
			lines.push(
				`Inherited tools expected: ${init.expectedTools} · available in child: ${init.availableTools ?? "unknown"}`,
			);
		if (init.missingTools?.length)
			lines.push(
				`Missing inherited tools (${init.missingToolCount ?? init.missingTools.length}): ${init.missingTools.join(", ")}${(init.missingToolCount ?? 0) > init.missingTools.length ? " (names truncated)" : ""}`,
			);
		if (init.error) lines.push(`Initialization error: ${init.error}`);
	}
	if (timeout && diagnostics.stage === "initialize") {
		if (init?.phase === "waiting-tools")
			lines.push(
				"Tool registration/discovery had not completed at the last checkpoint. Missing names identify the waiting tools, not a proven failing server.",
			);
		else if (init?.phase === "extension-loaded")
			lines.push(
				"The child extension loaded, but its initialization handler was not observed to start. Extension/session startup or RPC dispatch may still be pending; the exact blocker is unknown.",
			);
		else if (!init)
			lines.push(
				"No child initialization checkpoint was captured. The child may not have reached pi-delegate initialization; the exact blocking extension/server is unknown.",
			);
	}
	if (diagnostics.lastRecord)
		lines.push(
			`Last RPC record: ${diagnostics.lastRecord.type}${diagnostics.lastRecord.command ? ` (${diagnostics.lastRecord.command})` : ""} · ${duration(diagnostics.lastRecord.ageMs)} before diagnostic capture`,
		);
	else if (timeout)
		lines.push("No RPC protocol records were observed during startup.");
	if (diagnostics.exitCode !== undefined || diagnostics.signal !== undefined)
		lines.push(
			`Unexpected child exit: code=${diagnostics.exitCode ?? "none"} · signal=${diagnostics.signal ?? "none"}`,
		);
	for (const error of diagnostics.extensionErrors ?? [])
		lines.push(
			`Extension error: ${error.extensionPath} · ${error.event}\n${error.error}`,
		);
	if (diagnostics.stderr)
		lines.push(
			`\nChild stderr${diagnostics.stderrTruncated ? " (tail truncated to 16 KiB)" : ""}:\n${diagnostics.stderr}`,
		);
	return lines.join("\n");
}
