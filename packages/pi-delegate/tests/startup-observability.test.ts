import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RpcProcess, RpcTimeoutError } from "../src/rpc.ts";
import { resolveCli, runDelegation } from "../src/runner.ts";
import { formatStartupDiagnostics } from "../src/startup-diagnostics.ts";

const fixture = resolve("tests/fixtures/startup-timeout-rpc.mjs");

test("real Pi initialization failure retains child validation progress", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-init-observed-"));
	try {
		const result = await runDelegation({
			cwd: directory,
			args: [
				"--offline",
				"--no-session",
				"--no-approve",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--extension",
				resolve("src/index.ts"),
				"--tools",
				"read",
			],
			task: "must not execute",
			snapshot: {
				version: 1,
				tools: [
					{ name: "read", fingerprint: "deliberately mismatched schema" },
				],
				active: ["read"],
			},
			cliPath: resolveCli(),
			env: { PI_CODING_AGENT_DIR: directory, PI_OFFLINE: "1" },
		});
		expect(result.details.status).toBe("failed");
		expect(result.details.error).toContain(
			"Unable to reinitialize inherited tool: read",
		);
		expect(result.details.startupDiagnostics?.initialization).toMatchObject({
			phase: "failed",
			expectedTools: 1,
			availableTools: 1,
			missingToolCount: 0,
			error: "Unable to reinitialize inherited tool: read",
		});
		expect(result.content[0].text).toContain(
			"Initialization checkpoint: failed",
		);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);

for (const phase of ["waiting-tools", "extension-loaded", "absent"] as const) {
	test(`initialization timeout retains actionable ${phase} observations`, async () => {
		const request = RpcProcess.prototype.request;
		// Exercise the real timeout and cleanup path without a 40-second test delay.
		const short = spyOn(RpcProcess.prototype, "request").mockImplementation(
			function <T>(
				this: RpcProcess,
				type: string,
				fields?: Record<string, unknown>,
				timeoutMs?: number,
			) {
				return request.call(this, type, fields, timeoutMs ?? 700) as Promise<T>;
			},
		);
		try {
			const result = await runDelegation({
				cwd: process.cwd(),
				args: [],
				task: "must not execute",
				snapshot: { version: 1, tools: [], active: [] },
				cliPath: fixture,
				env: { STARTUP_CHECKPOINT: phase, STARTUP_EXTENSION_ERRORS: "1" },
			});
			const diagnostics = result.details.startupDiagnostics;
			expect(result.details.status).toBe("failed");
			expect(result.details.error).toContain(
				"Pi RPC command timed out: prompt",
			);
			expect(diagnostics).toMatchObject({
				stage: "initialize",
				operation: "child startup + initialization handshake",
				timeout: {
					command: "prompt",
					id: "delegate-1",
					timeoutMs: 700,
					writeState: "written",
				},
				lastRecord: { type: "response", command: "prompt" },
			});
			expect(diagnostics?.elapsedMs).toBeGreaterThanOrEqual(650);
			expect(diagnostics?.timings?.map((step) => step.operation)).toEqual([
				"prepare",
				"child startup + initialization handshake",
			]);
			expect(diagnostics?.extensionErrors).toHaveLength(8);
			expect(
				diagnostics?.extensionErrors?.every(
					(error) => error.error.length <= 2_000,
				),
			).toBe(true);
			expect(diagnostics?.stderr).toContain("initialization is stalled");
			expect(diagnostics?.exitCode).toBeUndefined(); // Intentional cleanup is not a cause.
			const text = result.content[0].text;
			expect(text).toContain("Host acceptance is unknown");
			expect(text).toContain("Connection refused");
			expect(text).toContain("session_start");
			if (phase === "waiting-tools") {
				expect(diagnostics?.initialization?.missingToolCount).toBe(2);
				expect(text).toContain("mcp__slow__search, mcp__slow__read");
				expect(text).toContain("not a proven failing server");
			} else if (phase === "extension-loaded") {
				expect(text).toContain("handler was not observed to start");
			} else {
				expect(diagnostics?.initialization).toBeUndefined();
				expect(text).toContain(
					"No child initialization checkpoint was captured",
				);
			}
		} finally {
			short.mockRestore();
		}
	});
}

test("RPC timeout distinguishes pipe write pending from completed without retry", async () => {
	const rpc = new RpcProcess("node", [fixture], {
		cwd: process.cwd(),
		env: process.env,
	});
	try {
		await rpc.request("get_state");
		let writes = 0;
		// Simulate backpressure: the write is accepted locally but its callback never completes.
		const write = spyOn(rpc.child.stdin, "write").mockImplementation(() => {
			writes++;
			return false;
		});
		try {
			let failure: unknown;
			try {
				await rpc.request("prompt", { message: "probe" }, 30);
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(RpcTimeoutError);
			expect((failure as RpcTimeoutError).request).toMatchObject({
				command: "prompt",
				timeoutMs: 30,
				writeState: "queued",
			});
			expect(writes).toBe(1);
		} finally {
			write.mockRestore();
		}
	} finally {
		await rpc.stop();
	}
});

test("diagnostic text labels truncated tool names, unknown initialization and child exits", () => {
	const text = formatStartupDiagnostics({
		stage: "initialize",
		stderr: "",
		stderrTruncated: false,
		exitCode: 7,
		initialization: {
			phase: "failed",
			elapsedMs: 500,
			missingTools: ["one"],
			missingToolCount: 5,
			error: "schema mismatch",
		},
	});
	expect(text).toContain("Missing inherited tools (5): one (names truncated)");
	expect(text).toContain("Initialization error: schema mismatch");
	expect(text).toContain("Unexpected child exit: code=7");
});
