import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	const command = JSON.parse(line);
	if (command.type === "get_state") {
		send({ type: "response", id: command.id, success: true, data: {} });
		return;
	}
	const phase = process.env.STARTUP_CHECKPOINT;
	const snapshot = process.env.PI_DELEGATE_SNAPSHOT;
	if (snapshot && phase && phase !== "absent") {
		writeFileSync(
			`${snapshot}.progress.json`,
			JSON.stringify({
				phase,
				elapsedMs: 120,
				...(phase === "waiting-tools"
					? {
							expectedTools: 3,
							availableTools: 1,
							missingTools: ["mcp__slow__search", "mcp__slow__read"],
							missingToolCount: 2,
						}
					: {}),
			}),
		);
	}
	if (process.env.STARTUP_EXTENSION_ERRORS === "1") {
		for (let i = 0; i < 12; i++)
			send({
				type: "extension_error",
				extensionPath: "fixture/mcp.ts",
				event: "session_start",
				error: `Connection refused ${i}: ${"x".repeat(4_000)}`,
			});
	}
	process.stderr.write("fixture: initialization is stalled\n");
	// An unmatched response must not acknowledge this request.
	send({
		type: "response",
		id: "unrelated-request",
		command: "prompt",
		success: true,
	});
});
input.on("close", () => process.exit(0));
