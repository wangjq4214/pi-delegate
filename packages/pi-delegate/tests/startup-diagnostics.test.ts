import { expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BackgroundTasks } from "../src/background.ts";
import {
	type DelegationOptions,
	resolveCli,
	runDelegation,
} from "../src/delegate.ts";
import { RpcProcess } from "../src/rpc.ts";

const fixture = resolve("tests/fixtures/startup-diagnostics-rpc.mjs");
function options(scenario: string): DelegationOptions {
	return {
		cwd: process.cwd(),
		args: [],
		task: "probe",
		snapshot: { version: 1, tools: [], active: [] },
		cliPath: fixture,
		env: { DIAGNOSTICS_SCENARIO: scenario },
	};
}

for (const [scenario, error, stderr] of [
	["exit", "exited", "fixture startup root cause"],
	["init", "fixture handshake failure", "init diagnostic"],
	["split", "fixture init rejection", "启动失败：雪🌱"],
	["late", "fixture primary error", "diagnostic emitted during cleanup"],
	["empty", "fixture primary error", ""],
] as const) {
	test(`startup ${scenario}: preserve primary error and available stderr after cleanup`, async () => {
		const result = await runDelegation(options(scenario));
		expect(result.details.status).toBe("failed");
		expect(result.isError).toBe(true);
		expect(result.details.error).toContain(error);
		expect(result.details.startupDiagnostics).toMatchObject({
			stage: "initialize",
			stderrTruncated: false,
		});
		expect(result.details.startupDiagnostics?.stderr).toContain(stderr);
		expect(result.content[0].text).toContain(error);
		expect(result.content[0].text).toContain("Startup stage: initialize");
		if (stderr) expect(result.content[0].text).toContain(stderr);
		else expect(result.content[0].text).not.toContain("Child stderr");
		expect(result.details.startupDiagnostics?.stderr).not.toContain("�");
		expect(result.details.fullOutputPath).toBeUndefined();
		if (scenario === "exit")
			expect(result.details.startupDiagnostics).toMatchObject({
				exitCode: 7,
				signal: null,
			});
		else expect(result.details.startupDiagnostics?.exitCode).toBeUndefined();
	});
}

test("stderr tail is byte-bounded, marked truncated and starts at a UTF-8 boundary", async () => {
	const result = await runDelegation(options("large"));
	const diagnostics = result.details.startupDiagnostics;
	expect(diagnostics?.stderrTruncated).toBe(true);
	expect(Buffer.byteLength(diagnostics?.stderr ?? "")).toBeLessThanOrEqual(
		16 * 1024,
	);
	expect(diagnostics?.stderr).not.toContain("discarded prefix");
	expect(diagnostics?.stderr).not.toContain("�");
	expect(diagnostics?.stderr).toEndWith("\nROOT CAUSE\n");
	expect(result.content[0].text).toContain("tail truncated to 16 KiB");
});

for (const scenario of ["configure", "submit"] as const) {
	test(`${scenario} rejection reports the stage without submitting fallback work`, async () => {
		const result = await runDelegation({
			...options(scenario),
			...(scenario === "configure"
				? {
						requestedConfiguration: {
							model: { provider: "fixture", id: "fixture" },
							thinkingLevel: "off" as const,
						},
					}
				: {}),
		});
		expect(result.details.status).toBe("failed");
		expect(result.details.error).toContain(
			scenario === "configure" ? "model selection" : "task submission",
		);
		expect(result.details.startupDiagnostics).toMatchObject({
			stage: scenario,
			stderr: "private startup noise\n",
		});
		expect(result.content[0].text).toContain("private startup noise");
		expect(result.content[0].text).not.toContain("fixture result");
	});
}

for (const [scenario, status] of [
	["success", "completed"],
	["runtime", "failed"],
	["started-rejection", "failed"],
	["started-only", "failed"],
	["cancel", "cancelled"],
] as const) {
	test(`${scenario}: do not disclose startup or runtime stderr after task start`, async () => {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 4_000);
		try {
			const result = await runDelegation({
				...options(scenario),
				signal: controller.signal,
				status: {
					observe: (record) => {
						if (record.type === "fixture_ready") controller.abort();
					},
					accepted() {},
					finish() {},
				},
			});
			expect(result.details.status).toBe(status);
			expect(result.details.startupDiagnostics).toBeUndefined();
			expect(JSON.stringify(result)).not.toContain("private startup noise");
			expect(JSON.stringify(result)).not.toContain("private runtime noise");
		} finally {
			clearTimeout(timer);
			controller.abort();
		}
	});
}

test("startup cancellation does not disclose buffered stderr", async () => {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 4_000);
	try {
		const result = await runDelegation({
			...options("startup-cancel"),
			signal: controller.signal,
			ui: async () => {
				controller.abort();
				return undefined;
			},
		});
		expect(result.details.status).toBe("cancelled");
		expect(result.details.startupDiagnostics).toBeUndefined();
		expect(JSON.stringify(result)).not.toContain("private cancellation noise");
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
});

test("transport discard clears buffered bytes and keeps draining without treating stderr as protocol", async () => {
	const rpc = new RpcProcess("node", [fixture], {
		cwd: process.cwd(),
		env: { ...process.env, DIAGNOSTICS_SCENARIO: "success" },
	});
	try {
		await rpc.request("prompt", { message: "/init" });
		// Confirm the live collector has received bytes before discarding it.
		await rpc.request("stderr", { value: "collector ready\n" });
		const deadline = Date.now() + 1_000;
		while (!rpc.diagnostics().stderr.includes("collector ready")) {
			if (Date.now() > deadline) throw new Error("Stderr was not collected");
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(rpc.diagnostics().stderr).toContain("private startup noise\n");
		rpc.discardDiagnostics();
		await rpc.request("stderr", { value: "private discarded noise\n" });
		await rpc.stop();
		expect(rpc.diagnostics()).toEqual({ stderr: "", stderrTruncated: false });
	} finally {
		await rpc.stop();
	}
});

test("a cleanup failure does not replace the primary startup rejection", async () => {
	const stop = RpcProcess.prototype.stop;
	const mocked = spyOn(RpcProcess.prototype, "stop").mockImplementation(
		async function (this: RpcProcess) {
			await stop.call(this);
			throw new Error("fixture cleanup failure");
		},
	);
	try {
		const result = await runDelegation(options("late"));
		expect(result.details.error).toBe("fixture primary error");
		expect(result.details.startupDiagnostics?.stderr).toContain(
			"diagnostic emitted during cleanup",
		);
	} finally {
		mocked.mockRestore();
	}
});

test("a crashed child with inherited stderr pipes returns bounded diagnostics without hanging", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-diagnostics-held-"));
	try {
		const result = await runDelegation({
			...options("held-pipe"),
			env: {
				DIAGNOSTICS_SCENARIO: "held-pipe",
				DIAGNOSTICS_LOG_DIR: directory,
			},
		});
		expect(result.details.status).toBe("failed");
		expect(result.details.startupDiagnostics?.stderr).toContain(
			"startup before held pipe",
		);
		// Windows may close inherited pipe handles with the original process.
		if (process.platform !== "win32")
			expect(result.details.startupDiagnostics?.stderr).toContain(
				"late sidecar diagnostic",
			);
	} finally {
		const path = join(directory, "sidecar.pid");
		if (existsSync(path)) {
			try {
				process.kill(Number(readFileSync(path, "utf8")), "SIGKILL");
			} catch {
				/* Already killed by process-group cleanup. */
			}
		}
		await rm(directory, { recursive: true, force: true });
	}
}, 10_000);

test("background query and completion delivery preserve startup diagnostics", async () => {
	let delivered: ReturnType<BackgroundTasks["query"]> | undefined;
	const owner = new BackgroundTasks(
		runDelegation,
		() => {
			throw new Error("Unexpected runner throw");
		},
		(result) => {
			delivered = result;
		},
	);
	try {
		const ack = owner.start(options("split"), {
			isIdle: () => true,
			hasPendingMessages: () => false,
		});
		const deadline = Date.now() + 4_000;
		while (owner.query(ack.details.taskId).details.status === "initializing") {
			if (Date.now() > deadline) throw new Error("Child did not fail in time");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		const query = owner.query(ack.details.taskId);
		expect(query.details.status).toBe("failed");
		expect(query.details.result?.startupDiagnostics?.stderr).toContain(
			"启动失败：雪🌱",
		);
		expect(query.content[0].text).toContain("启动失败：雪🌱");
		owner.scheduleDelivery();
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(delivered?.details.result?.startupDiagnostics).toEqual(
			query.details.result?.startupDiagnostics,
		);
		expect(delivered?.content).toEqual(query.content);
	} finally {
		await owner.invalidate(true);
	}
});

test("real installed Pi CLI startup failure exposes its stderr root cause", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-diagnostics-cli-"));
	try {
		const result = await runDelegation({
			...options("real"),
			cliPath: resolveCli(),
			args: [
				"--no-session",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--provider",
				"pi-delegate-nonexistent-provider",
				"--model",
				"no-such-model",
			],
			env: { PI_CODING_AGENT_DIR: directory },
		});
		expect(result.details.status).toBe("failed");
		expect(result.isError).toBe(true);
		expect(result.details.startupDiagnostics?.stderr).toContain(
			"pi-delegate-nonexistent-provider",
		);
		expect(result.content[0].text).toContain(
			result.details.startupDiagnostics?.stderr ?? "missing diagnostics",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);
