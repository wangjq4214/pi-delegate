import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const scenario = process.env.DIAGNOSTICS_SCENARIO;
const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const input = createInterface({ input: process.stdin });
let started = false;

if (scenario === "exit") {
	process.stderr.write("Error: fixture startup root cause\n", () =>
		process.exit(7),
	);
}
if (scenario === "held-pipe") {
	const sidecar = spawn(
		process.execPath,
		[
			"-e",
			'setTimeout(() => process.stderr.write("late sidecar diagnostic\\n"), 100); setInterval(() => {}, 1000);',
		],
		{ stdio: ["ignore", "inherit", "inherit"] },
	);
	writeFileSync(
		join(process.env.DIAGNOSTICS_LOG_DIR, "sidecar.pid"),
		String(sidecar.pid),
	);
	process.stderr.write("startup before held pipe\n", () => process.exit(7));
}

input.on("line", async (line) => {
	const command = JSON.parse(line);
	const reply = (data) =>
		send({ type: "response", id: command.id, success: true, data });
	const reject = (error) =>
		send({ type: "response", id: command.id, success: false, error });
	if (command.type === "prompt" && command.message.startsWith("/")) {
		if (scenario === "startup-cancel") {
			process.stderr.write("private cancellation noise\n");
			send({
				type: "extension_ui_request",
				id: "cancel-probe",
				method: "input",
				title: "Cancel startup",
			});
			return;
		}
		if (scenario === "split") {
			const bytes = Buffer.from("启动失败：雪🌱\n");
			const split = bytes.indexOf(Buffer.from("雪")) + 1;
			process.stderr.write(bytes.subarray(0, split));
			await new Promise((resolve) => setTimeout(resolve, 20));
			process.stderr.write(bytes.subarray(split));
			return reject("fixture init rejection");
		}
		if (scenario === "large") {
			process.stderr.write(
				`discarded prefix\n${"雪".repeat(30_000)}\nROOT CAUSE\n`,
				() => reject("fixture init rejection"),
			);
			return;
		}
		if (scenario === "late") return reject("fixture primary error");
		if (scenario === "empty") return reject("fixture primary error");
		if (scenario === "init") {
			process.stderr.write("init diagnostic\n");
		}
		if (
			[
				"success",
				"runtime",
				"cancel",
				"configure",
				"submit",
				"started-rejection",
				"started-only",
			].includes(scenario)
		) {
			process.stderr.write("private startup noise\n");
		}
		return reply({ disposition: "handled" });
	}
	if (command.type === "get_entries") {
		if (!started) {
			return reply({
				entries: [
					{
						type: "custom",
						customType: "pi-delegate:init",
						data: {
							ok: scenario !== "init",
							error: "fixture handshake failure",
						},
					},
				],
			});
		}
		return reply({
			entries: [
				{
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "fixture result" }],
						stopReason: "stop",
						usage: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 0,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
					},
				},
			],
		});
	}
	if (command.type === "stderr") {
		process.stderr.write(command.value, () => reply({}));
		return;
	}
	if (command.type === "set_model")
		return reject("fixture model selection failure");
	if (command.type === "get_state")
		return reply({ sessionId: "fixture-session" });
	if (command.type === "prompt") {
		if (scenario === "submit") return reject("fixture task submission failure");
		started = true;
		if (scenario !== "started-only") send({ type: "agent_start" });
		if (scenario === "started-rejection")
			return reject("fixture rejected after task start");
		reply({ disposition: "started" });
		if (scenario === "runtime" || scenario === "started-only") {
			process.stderr.write("private runtime noise\n", () => process.exit(8));
		} else if (scenario === "cancel") send({ type: "fixture_ready" });
		else send({ type: "agent_settled" });
	}
});
input.on("close", () => {
	if (scenario === "late")
		process.stderr.write("diagnostic emitted during cleanup\n", () =>
			process.exit(0),
		);
	else process.exit(0);
});
