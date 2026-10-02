import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const scenario = process.env.FIXTURE_SCENARIO ?? "fast";
const snapshot = process.env.PI_DELEGATE_SNAPSHOT;
if (process.env.FIXTURE_LOG_DIR)
	writeFileSync(
		join(process.env.FIXTURE_LOG_DIR, `${process.pid}.json`),
		JSON.stringify({ pid: process.pid, snapshot }),
	);
const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const reply = (command, data) =>
	send({
		type: "response",
		command: command.type,
		id: command.id,
		success: true,
		data,
	});
let prompt = "";
const usage = {
	input: 2,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 3,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function command(record) {
	if (record.type === "prompt" && record.message === "/pi-delegate-init") {
		reply(record, { disposition: "handled" });
		return;
	}
	if (record.type === "get_entries") {
		reply(record, {
			entries: [
				{
					type: "custom",
					customType: "pi-delegate:init",
					data: {
						ok: scenario !== "init-failed",
						error: "fixture init failed",
					},
				},
			],
		});
		return;
	}
	if (record.type === "prompt") {
		prompt = record.message;
		if (scenario === "invalid") {
			process.stdout.write("not JSON\n");
			return;
		}
		if (scenario === "exit-held") {
			const sidecar = spawn(
				process.execPath,
				["-e", "setInterval(() => {}, 1000)"],
				{ stdio: ["ignore", "inherit", "inherit"] },
			);
			writeFileSync(
				join(process.env.FIXTURE_LOG_DIR, "sidecar.pid"),
				String(sidecar.pid),
			);
			process.exit(7);
		}
		if (scenario === "exit") {
			process.exit(7);
		}
		if (scenario === "fast") send({ type: "agent_settled" }); // deliberately before acceptance
		reply(record, {
			disposition: scenario === "handled" ? "handled" : "started",
		});
		if (scenario === "slow")
			setTimeout(() => send({ type: "agent_settled" }), 200);
		if (scenario === "error") send({ type: "agent_settled" });
		return;
	}
	if (record.type === "get_messages") {
		const data = {
			type: "response",
			command: record.type,
			id: record.id,
			success: true,
			data: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: `${prompt}\n雪\u2028\u2029` }],
						usage,
						stopReason: scenario === "error" ? "error" : "stop",
						errorMessage: "fixture model failure",
					},
				],
			},
		};
		// Split in the middle of a multi-byte character and use CRLF, not Unicode separators.
		const bytes = Buffer.from(`${JSON.stringify(data)}\r\n`);
		const split = bytes.indexOf(Buffer.from("雪")) + 1;
		process.stdout.write(bytes.subarray(0, split));
		setImmediate(() => process.stdout.write(bytes.subarray(split)));
		return;
	}
	if (record.type === "get_state") {
		reply(record, { sessionId: String(process.pid) });
		return;
	}
	if (record.type === "inspect") {
		send({
			type: "extension_ui_request",
			id: "ui-proof",
			method: "confirm",
			title: "Fixture",
			message: "Continue?",
		});
		reply(record, {});
		return;
	}
	if (record.type === "extension_ui_response") {
		send({ type: "agent_settled" });
		return;
	}
	reply(record, record.value);
}
let buffer = "";
const decoder = new StringDecoder("utf8");
process.stdin.on("data", (chunk) => {
	buffer += decoder.write(chunk);
	let newline = buffer.indexOf("\n");
	while (newline >= 0) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		if (line) command(JSON.parse(line));
		newline = buffer.indexOf("\n");
	}
});
process.stdin.on("end", () => {
	if (scenario === "ignore-end") setInterval(() => {}, 1_000);
	else process.exit(0);
});
