import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const dir = process.env.STATUS_FIXTURE_DIR;
const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const event = (type, fields = {}) => send({ type, ...fields });
const reply = (command, data, error) =>
	send({
		type: "response",
		id: command.id,
		success: error === undefined,
		data,
		error,
	});
let started = false;
let timer;
createInterface({ input: process.stdin })
	.on("line", (line) => {
		const command = JSON.parse(line);
		if (command.type === "prompt" && command.message === "/pi-delegate-init") {
			event("agent_start");
			event("turn_end");
			event("agent_settled");
			reply(command, { disposition: "handled" });
		} else if (command.type === "prompt") {
			started = true;
			event("turn_end"); // Not task execution before actual onset.
			event("agent_start");
			event("message_update", {
				assistantMessageEvent: {
					type: "thinking_start",
					delta: "PRIVATE THOUGHT",
				},
			});
			event("tool_execution_start", {
				toolCallId: "read",
				toolName: "read",
				args: { secret: "PRIVATE ARGS" },
			});
			event("tool_execution_end", {
				toolCallId: "read",
				result: "PRIVATE RESULT",
			});
			event("turn_end");
			event("turn_end");
			reply(command, { disposition: "started" });
		} else if (command.type === "steer") {
			const stage = command.message.includes("pressure: urgent")
				? "urgent"
				: "warning";
			writeFileSync(join(dir, `${stage}-pending`), "pending");
			timer = setInterval(() => {
				if (!existsSync(join(dir, `${stage}-release`))) return;
				clearInterval(timer);
				const rejected =
					stage === "urgent" && process.env.STATUS_FIXTURE_REJECT === "1";
				reply(
					command,
					{ disposition: "queued" },
					rejected ? "fixture refused urgent" : undefined,
				);
				if (stage === "urgent" && !rejected) event("agent_settled");
			}, 5);
		} else if (command.type === "get_entries") {
			reply(command, {
				entries: started
					? [
							{
								type: "message",
								message: {
									role: "assistant",
									content: [{ type: "text", text: "PRIVATE OUTPUT" }],
									stopReason: "stop",
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
		} else if (command.type === "get_state")
			reply(command, {
				sessionId: "fixture",
				model: { provider: "fixture", id: "fixture-model" },
				thinkingLevel: "off",
			});
		else reply(command, {});
	})
	.on("close", () => {
		clearInterval(timer);
		process.exit(0);
	});
