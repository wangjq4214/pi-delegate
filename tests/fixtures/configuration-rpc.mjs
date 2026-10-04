import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const log = process.env.CONFIGURATION_LOG;
const scenario = process.env.CONFIGURATION_SCENARIO;
let started = false;
const reply = (command, data, error) =>
	process.stdout.write(
		`${JSON.stringify({ type: "response", id: command.id, success: !error, data, error })}\n`,
	);
createInterface({ input: process.stdin })
	.on("line", (line) => {
		const command = JSON.parse(line);
		appendFileSync(log, `${line}\n`);
		if (command.type === "prompt" && command.message === "/pi-delegate-init")
			reply(command, { disposition: "handled" });
		else if (
			command.type === "set_model" ||
			command.type === "set_thinking_level"
		)
			reply(
				command,
				{},
				scenario === command.type ? "configuration command failed" : undefined,
			);
		else if (command.type === "get_state") {
			if (scenario === "cancel" && !started) return;
			reply(
				command,
				{
					sessionId: "configuration-fixture",
					model: {
						provider: "fixture",
						id: scenario === "mismatch" ? "fuzzy-fallback" : "exact/id:variant",
					},
					thinkingLevel: scenario === "invalid-level" ? "invented" : "low",
				},
				scenario === "get_state" ? "readback failed" : undefined,
			);
		} else if (command.type === "get_entries")
			reply(command, {
				entries: started
					? [
							{
								type: "message",
								message: {
									role: "assistant",
									content: [{ type: "text", text: "task output" }],
									stopReason: scenario === "execution-error" ? "error" : "stop",
									errorMessage: "inference failed",
								},
							},
						]
					: [
							{
								type: "custom",
								customType: "pi-delegate:init",
								data: { ok: true },
							},
						],
			});
		else if (command.type === "prompt") {
			started = true;
			process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
			reply(command, { disposition: "started" });
			process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
		} else reply(command, {});
	})
	.on("close", () => process.exit(0));
