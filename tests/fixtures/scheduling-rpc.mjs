import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const directory = process.env.SCHEDULING_DIR;
const name = process.env.SCHEDULING_TASK;
const path = (suffix) => join(directory, `${name}-${suffix}`);
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const wait = async (suffix) => {
	while (!existsSync(path(suffix)))
		await new Promise((resolve) => setTimeout(resolve, 5));
};
const usage = {
	input: 8,
	output: 2,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 10,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const message = {
	role: "assistant",
	content: [{ type: "text", text: "done" }],
	usage,
	stopReason: "stop",
};
let started = false;
writeFileSync(path("spawned"), String(process.pid));
const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
	const command = JSON.parse(line);
	const reply = (data) =>
		send({ type: "response", id: command.id, success: true, data });
	if (command.type === "prompt" && command.message.startsWith("/")) {
		await wait("initialize");
		reply({ disposition: "handled" });
	} else if (command.type === "get_entries") {
		reply({
			entries: started
				? [{ type: "message", message }]
				: [
						{
							type: "custom",
							customType: "pi-delegate:init",
							data: { ok: true },
						},
					],
		});
	} else if (command.type === "get_state") reply({ sessionId: name });
	else if (command.type === "prompt") {
		started = true;
		send({ type: "agent_start" });
		reply({ disposition: "started" });
		writeFileSync(path("running"), "");
		await wait("finish");
		send({ type: "message_end", message });
		send({ type: "agent_settled" });
	}
});
input.on("close", () => process.exit(0));
