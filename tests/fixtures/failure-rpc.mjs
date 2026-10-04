import { createInterface } from "node:readline";

const scenario = process.env.FAILURE_SCENARIO;
const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const usage = (n) => ({
	input: n,
	output: n,
	cacheRead: n,
	cacheWrite: n,
	totalTokens: n * 4,
	reasoning: n,
	cacheWrite1h: n,
	cost: { input: n, output: n, cacheRead: n, cacheWrite: n, total: n * 4 },
});
const assistant = (n) => ({
	role: "assistant",
	content: [{ type: "text", text: "result" }],
	usage: usage(n),
	stopReason: "stop",
});
const tool = { role: "toolResult", toolCallId: "tool", usage: usage(3) };
const messages = [assistant(2), tool, assistant(5)];
let started = false;
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	const command = JSON.parse(line);
	const reply = (data) =>
		send({ type: "response", id: command.id, success: true, data });
	if (command.type === "get_entries") {
		if (started && scenario === "usage-entries-failure") {
			send({
				type: "response",
				id: command.id,
				success: false,
				error: "entries failed",
			});
			return;
		}
		reply({
			entries: started
				? (scenario === "usage-readback" ? [assistant(13)] : messages).map(
						(message) => ({ type: "message", message }),
					)
				: [
						{
							type: "custom",
							customType: "pi-delegate:init",
							data: { ok: true },
						},
					],
		});
	} else if (command.type === "get_state") {
		if (scenario === "usage-state-failure") {
			process.exit(7);
		} else reply({ sessionId: "fixture-session" });
	} else if (command.type === "prompt") {
		if (command.message.startsWith("/"))
			return reply({ disposition: "handled" });
		started = true;
		send({ type: "agent_start" });
		reply({ disposition: "started" });
		if (scenario.startsWith("ui-")) {
			send({
				type: "extension_ui_request",
				id: "dialog",
				method: process.env.UI_METHOD ?? "input",
				title: "Fixture",
				options: ["yes"],
				message: "Continue?",
			});
			if (scenario === "ui-exit") setTimeout(() => process.exit(7), 20);
			else if (scenario === "ui-completed") send({ type: "agent_settled" });
			return;
		}
		send({ type: "message_start", message: assistant(0) });
		send({ type: "message_update", usage: usage(1) });
		send({ type: "message_update", usage: usage(2) });
		send({ type: "message_end", message: messages[0] });
		// Nested tool execution usage is already included in the top-level toolResult.
		send({
			type: "tool_execution_end",
			toolCallId: "tool/nested",
			result: { usage: usage(3) },
		});
		send({ type: "message_start", message: tool });
		if (
			scenario === "usage-tool-start-cancel" ||
			scenario === "usage-tool-start-exit"
		) {
			if (scenario.endsWith("cancel")) send({ type: "fixture_ready" });
			else setTimeout(() => process.exit(7), 20);
			return;
		}
		send({ type: "message_end", message: tool });
		send({ type: "message_start", message: assistant(0) });
		send({ type: "message_update", usage: usage(4) });
		if (
			scenario === "usage-stream-cancel" ||
			scenario === "usage-stream-exit"
		) {
			if (scenario.endsWith("cancel")) send({ type: "fixture_ready" });
			else setTimeout(() => process.exit(7), 20);
			return;
		}
		send({ type: "message_end", message: messages[2] });
		send({ type: "turn_end", message: messages[2], toolResults: [tool] });
		send({ type: "agent_end", messages });
		if (scenario === "usage-cancel") send({ type: "fixture_ready" });
		else if (scenario === "usage-exit") setTimeout(() => process.exit(7), 20);
		else send({ type: "agent_settled" });
	}
});
input.on("close", () => process.exit(0));
