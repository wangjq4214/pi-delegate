import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

// A controlled JSONL transport, not a Pi/model-input visibility fake.
const scenario = process.env.PRESSURE_FIXTURE_SCENARIO;
const logPath = process.env.PRESSURE_FIXTURE_LOG;
const log = (record) => appendFileSync(logPath, `${JSON.stringify(record)}\n`);
log({
	kind: "spawn",
	pid: process.pid,
	snapshot: process.env.PI_DELEGATE_SNAPSHOT,
});
let batch;
const send = (record) => {
	const line = `${JSON.stringify(record)}\n`;
	if (batch) batch.push(line);
	else process.stdout.write(line);
};
const reply = (command, data, error) =>
	send({
		type: "response",
		id: command.id,
		command: command.type,
		success: error === undefined,
		...(error === undefined ? { data } : { error }),
	});
const event = (type) => send({ type });
let taskStarted = false;
let settled = false;
let steers = 0;
const settle = () => {
	if (settled) return;
	settled = true;
	event("agent_settled");
};
const usage = {
	input: 2,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 3,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

createInterface({ input: process.stdin })
	.on("line", (line) => {
		const command = JSON.parse(line);
		log({ kind: "command", ...command });
		if (command.type === "prompt" && command.message === "/pi-delegate-init") {
			// Initialization events must be outside the runner's pressure subscription.
			event("agent_start");
			for (let i = 0; i < 100; i++) event("turn_end");
			event("agent_settled");
			reply(command, { disposition: "handled" });
		} else if (command.type === "get_entries" && !taskStarted) {
			reply(command, {
				entries: [
					{
						type: "custom",
						customType: "pi-delegate:init",
						data: { ok: true },
					},
				],
			});
		} else if (command.type === "prompt") {
			batch = []; // One write makes pre-acceptance/settlement ordering deterministic.
			taskStarted = true;
			// Even after initialization, events before actual task onset must not count.
			for (let i = 0; i < 100; i++) event("turn_end");
			event("agent_start");
			if (
				!["abort-held", "timer", "rpc-failure", "prompt-failure"].includes(
					scenario,
				)
			) {
				event("turn_end");
				if (scenario !== "late-steer-failure") event("turn_end");
			}
			event("agent_end"); // Not the settlement boundary.
			if (scenario === "settled-before-steer") settle();
			// Deliberately after first task events.
			if (scenario === "prompt-failure")
				reply(command, undefined, "fixture prompt refused");
			else reply(command, { disposition: "started" });
			if (scenario === "rpc-failure") batch.push("not JSON\n");
			process.stdout.write(batch.join(""));
			batch = undefined;
			log({ kind: "task-started" });
		} else if (command.type === "steer") {
			steers++;
			if (scenario === "steer-failure")
				reply(command, undefined, "fixture steer refused");
			else if (scenario === "late-steer-failure") {
				settle();
				reply(command, undefined, "late fixture steer refused");
			} else {
				reply(command, { disposition: "queued" });
				if (steers === 2) settle();
			}
		} else if (command.type === "get_entries") {
			// Late events during result collection must not restart disposed pressure.
			event("agent_start");
			for (let i = 0; i < 100; i++) event("turn_end");
			reply(command, {
				entries: [
					{
						type: "message",
						message: {
							role: "assistant",
							content: [
								{
									type: "text",
									text: "Report: unfinished work and blockers remain.",
								},
							],
							usage,
							stopReason: "stop",
						},
					},
				],
			});
		} else if (command.type === "get_state") {
			reply(command, { sessionId: String(process.pid) });
		} else reply(command, {});
	})
	.on("close", () => {
		log({ kind: "shutdown" });
		process.exit(0);
	});
