import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runDelegation } from "../src/delegate.ts";
import { RpcProcess } from "../src/rpc.ts";

const fixture = resolve("tests/fixtures/rpc.mjs");
async function probe(
	scenario: string,
	action: (directory: string) => Promise<void>,
) {
	const directory = await mkdtemp(join(tmpdir(), `delegate-${scenario}-`));
	try {
		await action(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
function options(scenario: string, directory: string) {
	return {
		cwd: process.cwd(),
		args: [],
		snapshot: { version: 1 as const, tools: [], active: [] },
		task: "/not-a-command",
		context: "explicit context",
		cliPath: fixture,
		env: { FIXTURE_SCENARIO: scenario, FIXTURE_LOG_DIR: directory },
	};
}
function assertSnapshotRemoved(directory: string) {
	const files = readdirSync(directory).filter((name) => name.endsWith(".json"));
	expect(files).toHaveLength(1);
	const { snapshot, pid } = JSON.parse(
		readFileSync(join(directory, files[0]), "utf8"),
	);
	expect(existsSync(dirname(snapshot))).toBe(false);
	expect(() => process.kill(pid, 0)).toThrow();
}

test("fast settlement before prompt response is retained; UTF-8 and Unicode separators survive JSONL", async () => {
	await probe("fast", async (directory) => {
		const result = await runDelegation(options("fast", directory));
		expect(result.content[0].text).toBe(
			"Task:\n/not-a-command\n\nSupplementary context:\nexplicit context\n雪\u2028\u2029",
		);
		expect(result.details.status).toBe("completed");
		expect(result.details.stopReason).toBe("stop");
		expect(result.isError).toBe(false);
		expect(result.usage.totalTokens).toBe(3);
		assertSnapshotRemoved(directory);
	});
});

test("prompt acceptance does not finish a task", async () => {
	await probe("slow", async (directory) => {
		const start = Date.now();
		await runDelegation(options("slow", directory));
		expect(Date.now() - start).toBeGreaterThanOrEqual(190);
		assertSnapshotRemoved(directory);
	});
});

for (const [reason, status, isError] of [
	["length", "incomplete", false],
	["error", "failed", true],
	["aborted", "cancelled", true],
	["toolUse", "failed", true],
	["pending", "failed", true],
	["deferred", "failed", true],
] as const) {
	test(`terminal ${reason} returns ${status}, retaining text, usage and session`, async () => {
		await probe(reason, async (directory) => {
			const result = await runDelegation(options(reason, directory));
			expect(result.details.status).toBe(status);
			expect(result.details.stopReason).toBe(reason);
			expect(result.details.sessionId).toBeTruthy();
			expect(result.isError).toBe(isError);
			expect(result.content[0].text).toContain(`Delegation ${status}`);
			expect(result.content[0].text).toContain("explicit context");
			expect(result.content[0].text).toContain("雪");
			expect(result.usage.totalTokens).toBe(3);
			if (status === "incomplete") {
				expect(result.details.error).toBeUndefined();
				expect(result.details.truncation).toBeUndefined();
				expect(result.content[0].text).toContain("length limit");
			}
			assertSnapshotRemoved(directory);
		});
	});
}

test("settlement without an assistant result returns failed", async () => {
	await probe("missing", async (directory) => {
		const result = await runDelegation(options("missing", directory));
		expect(result.details.status).toBe("failed");
		expect(result.details.error).toContain("without an assistant result");
		assertSnapshotRemoved(directory);
	});
});

test("child spawn failure returns failed without a session or usage", async () => {
	await probe("fast", async (directory) => {
		const result = await runDelegation({
			...options("fast", directory),
			cwd: join(directory, "nonexistent"),
		});
		expect(result.details.status).toBe("failed");
		expect(result.isError).toBe(true);
		expect(result.usage.totalTokens).toBe(0);
		expect(result.details.sessionId).toBeUndefined();
		expect(readdirSync(directory)).toEqual([]);
	});
});

test("a recovered length attempt followed by stop is completed with all attempt usage", async () => {
	await probe("recovered", async (directory) => {
		const result = await runDelegation(options("recovered", directory));
		expect(result.details.status).toBe("completed");
		expect(result.details.stopReason).toBe("stop");
		expect(result.content[0].text).not.toContain("old partial");
		expect(result.usage.totalTokens).toBe(6);
		assertSnapshotRemoved(directory);
	});
});

test("cancellation during graceful cleanup does not return completed", async () => {
	await probe("cleanup-cancel", async (directory) => {
		const controller = new AbortController();
		const text = "partial".repeat(10_000);
		const settings = options("cleanup-cancel", directory);
		const operation = runDelegation({
			...settings,
			env: { ...settings.env, FIXTURE_FINAL_TEXT: text },
			signal: controller.signal,
		});
		const deadline = Date.now() + 5_000;
		try {
			while (!existsSync(join(directory, "shutdown"))) {
				if (Date.now() > deadline)
					throw new Error("Child did not begin shutdown");
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		} finally {
			controller.abort();
		}
		const result = await operation;
		const path = result.details.fullOutputPath;
		if (!path) throw new Error("Missing retained output path");
		try {
			expect(result.details.status).toBe("cancelled");
			expect(result.details.stopReason).toBe("stop");
			expect(result.isError).toBe(true);
			expect(result.details.truncation?.truncated).toBe(true);
			expect(result.content[0].text).toContain(path);
			expect(readFileSync(path, "utf8")).toBe(text);
			assertSnapshotRemoved(directory);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
});

for (const [scenario, error] of [
	["error", "fixture model failure"],
	["startup-exit", "exited"],
	["exit", "exited"],
	["invalid", "Invalid JSONL"],
	["handled", "did not start"],
	["init-failed", "fixture init failed"],
]) {
	test(`reports ${scenario} explicitly and cleans temporary snapshot`, async () => {
		await probe(scenario, async (directory) => {
			const result = await runDelegation(options(scenario, directory));
			expect(result.details.status).toBe("failed");
			expect(result.details.error).toContain(error);
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Delegation failed");
			assertSnapshotRemoved(directory);
		});
	});
}

test("cancellation returns cancelled and waits for cleanup", async () => {
	await probe("hang", async (directory) => {
		const controller = new AbortController();
		const operation = runDelegation({
			...options("hang", directory),
			signal: controller.signal,
		});
		while (!readdirSync(directory).length)
			await new Promise((resolve) => setTimeout(resolve, 10));
		controller.abort();
		const outcome = await operation;
		expect(outcome.details.status).toBe("cancelled");
		expect(outcome.details.error).toContain("cancelled");
		expect(outcome.isError).toBe(true);
		assertSnapshotRemoved(directory);
	});
});

test("an already-cancelled call does not start a process", async () => {
	const controller = new AbortController();
	controller.abort();
	await probe("fast", async (directory) => {
		const result = await runDelegation({
			...options("fast", directory),
			signal: controller.signal,
		});
		expect(result.details.status).toBe("cancelled");
		expect(result.details.sessionId).toBeUndefined();
		expect(result.usage.totalTokens).toBe(0);
		expect(result.isError).toBe(true);
		expect(readdirSync(directory)).toEqual([]);
	});
});

test("RPC correlation, unsupported dialogs, and idempotent shutdown", async () => {
	const rpc = new RpcProcess("node", [fixture], {
		cwd: process.cwd(),
		env: process.env,
	});
	try {
		const values = await Promise.all([
			rpc.request("echo", { value: "one" }),
			rpc.request("echo", { value: "two" }),
		]);
		expect(values).toEqual(["one", "two"]);
		const settled = rpc.waitForSettled();
		try {
			await rpc.request("inspect");
			await settled.promise;
		} finally {
			settled.dispose();
		}
	} finally {
		await Promise.all([rpc.stop(), rpc.stop()]);
	}
	expect(rpc.child.exitCode).not.toBeNull();
});

test("startup errors reject RPC work and can still be cleaned up", async () => {
	const rpc = new RpcProcess("pi-delegate-nonexistent-executable", [], {
		cwd: process.cwd(),
		env: process.env,
	});
	try {
		await expect(rpc.request("get_state")).rejects.toThrow();
	} finally {
		await rpc.stop();
	}
});

test("shutdown force-terminates a child that ignores stdin EOF", async () => {
	const rpc = new RpcProcess("node", [fixture], {
		cwd: process.cwd(),
		env: { ...process.env, FIXTURE_SCENARIO: "ignore-end" },
	});
	await rpc.request("get_state");
	await rpc.stop();
	expect(rpc.child.exitCode !== null || rpc.child.signalCode !== null).toBe(
		true,
	);
}, 10_000);

test("RPC dialogs can be forwarded and answered without blocking the child", async () => {
	let seen = false;
	const rpc = new RpcProcess(
		"node",
		[fixture],
		{ cwd: process.cwd(), env: process.env },
		undefined,
		async (request) => {
			seen = request.method === "confirm";
			return { type: "extension_ui_response", id: request.id, confirmed: true };
		},
	);
	const settled = rpc.waitForSettled();
	try {
		await rpc.request("inspect");
		await settled.promise;
		expect(seen).toBe(true);
	} finally {
		settled.dispose();
		await rpc.stop();
	}
});

test("a crashed child with inherited pipes does not hang shutdown", async () => {
	await probe("exit-held", async (directory) => {
		const rpc = new RpcProcess("node", [fixture], {
			cwd: process.cwd(),
			env: {
				...process.env,
				FIXTURE_SCENARIO: "exit-held",
				FIXTURE_LOG_DIR: directory,
			},
		});
		try {
			await expect(rpc.request("prompt", { message: "crash" })).rejects.toThrow(
				"exited",
			);
			await rpc.stop();
		} finally {
			const path = join(directory, "sidecar.pid");
			if (existsSync(path)) {
				try {
					process.kill(Number(readFileSync(path, "utf8")), "SIGKILL");
				} catch {
					/* Already killed with the POSIX process group. */
				}
			}
			await rpc.stop();
		}
	});
}, 10_000);
