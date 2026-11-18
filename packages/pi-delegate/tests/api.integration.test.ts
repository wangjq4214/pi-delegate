import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { DelegateExecutionProgress, DelegateResult } from "../src/api.ts";
import { RpcProcess } from "../src/rpc.ts";
import { resolveCli } from "../src/runner.ts";
import { processExited } from "./fixtures/process-exit.ts";

for (const built of [false, true]) {
	test(`pinned Pi source/built API (${built ? "built" : "source"} owner) co-loads, shares tasks and reconstructs parent-only inheritance`, async () => {
		const directory = await mkdtemp(join(tmpdir(), "delegate-api-"));
		const logs = join(directory, "logs");
		await mkdir(logs);
		const source = resolve("src/index.ts");
		const dist = resolve("dist/index.js");
		expect(existsSync(dist)).toBe(true); // Build is an explicit prerequisite, not a skipped gate.
		const extensions = [
			resolve("tests/fixtures/api-consumer.ts"),
			built ? dist : source,
			built ? source : dist,
			resolve("tests/fixtures/provider.ts"),
			"builtin:codemode",
			"builtin:tool-search",
		];
		const parent = new RpcProcess(
			"node",
			[
				resolveCli(),
				"--mode",
				"rpc",
				"--offline",
				"--no-session",
				"--no-approve",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				...extensions.flatMap((path) => ["-e", path]),
				"--tools",
				"read,delegate,delegate_status,delegate_list,fixture_echo,codemode,tool_search,fixture_parent_direct",
				"--provider",
				"delegate-fixture",
				"--model",
				"deterministic",
			],
			{
				cwd: directory,
				env: {
					...process.env,
					PI_DELEGATE_CHILD: undefined,
					PI_DELEGATE_SNAPSHOT: undefined,
					PI_CODING_AGENT_DIR: join(directory, "agent"),
					PI_OFFLINE: "1",
					FIXTURE_LOG_DIR: logs,
					API_FIXTURE_ENTRY: resolve(built ? "dist/api.js" : "src/api.ts"),
				},
			},
		);
		try {
			const settled = parent.waitForSettled();
			await parent.request("prompt", {
				message: "DELEGATE ordinary fixture work",
			});
			await settled;
			await parent.request("prompt", {
				message: "/api-execute exercise-tools",
			});
			const { entries } = await parent.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			const entry = entries.find(
				(e) => e.type === "custom" && e.customType === "api:result",
			);
			if (entry?.type !== "custom") throw new Error("Missing consumer result");
			const data = entry.data as {
				result: DelegateResult;
				progress: DelegateExecutionProgress[];
				list: { details: { tasks: { taskId: string }[] } };
				status: { details: unknown };
			};
			expect(data.result.details.status).toBe("completed");
			expect(data.progress.map((value) => value.phase)).toEqual([
				"queued",
				"initializing",
				"running",
				"cleanup",
				"completed",
			]);
			expect(
				data.progress.every(
					(value) => value.taskId === data.result.details.taskId,
				),
			).toBe(true);
			expect(data.progress.every((value) => !value.cancelling)).toBe(true);
			const firstProgress = entries.findIndex(
				(e) => e.type === "custom" && e.customType === "api:progress",
			);
			expect(firstProgress).toBeGreaterThanOrEqual(0);
			expect(firstProgress).toBeLessThan(entries.indexOf(entry));
			expect(data.result.usage.totalTokens).toBe(9); // search, codemode, final answer: 3 tokens each.
			const output = JSON.parse(data.result.content[0]?.text ?? "{}");
			expect(output.child).toBe(true);
			expect(output.calls).toBe(1);
			expect(output.prompt).toContain("consumer explicit context");
			expect(output.tools).not.toContain("fixture_parent_direct");
			expect(output.tools).not.toContain("fixture_parent_deferred");
			expect(output.tools).not.toContain("delegate");
			expect(data.list.details.tasks).toHaveLength(2);
			expect(data.list.details.tasks.map((task) => task.taskId)).toContain(
				data.result.details.taskId ?? "",
			);
			const statusSettled = parent.waitForSettled();
			await parent.request("prompt", {
				message: `STATUS ${data.result.details.taskId}`,
			});
			await statusSettled;
			const observed = await parent.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			const result = observed.entries
				.filter(
					(e) =>
						e.type === "message" &&
						e.message.role === "toolResult" &&
						e.message.toolName === "delegate_status",
				)
				.at(-1);
			if (result?.type !== "message" || result.message.role !== "toolResult")
				throw new Error("Missing tool observation");
			expect(JSON.stringify(result.message.details)).toBe(
				JSON.stringify(data.status.details),
			);
			expect(result.message.usage).toBeUndefined();
			await parent.request("prompt", {
				message: "/api-execute exercise-parent-boundary",
			});
			const probed = await parent.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			const probe = probed.entries
				.filter((e) => e.type === "custom" && e.customType === "api:result")
				.at(-1);
			if (probe?.type !== "custom") throw new Error("Missing boundary probe");
			const boundary = JSON.parse(
				(probe.data as { result: DelegateResult }).result.content[0]?.text ??
					"{}",
			);
			expect(boundary.boundaryResults).toHaveLength(3);
			expect(boundary.boundaryResults[0].isError).toBe(true);
			expect(JSON.stringify(boundary.boundaryResults[0].content)).toContain(
				"not found",
			);
			expect(JSON.stringify(boundary.boundaryResults[1].content)).not.toContain(
				"Must not be inherited",
			);
			expect(boundary.boundaryResults[2].isError).toBe(true);
			expect(JSON.stringify(boundary.boundaryResults[2].content)).not.toContain(
				"Parent-only fixture must not execute",
			);
			await parent.request(
				"prompt",
				{ message: "/api-execute partial-hang" },
				20_000,
			);
			const cancelled = await parent.request<{ entries: SessionEntry[] }>(
				"get_entries",
			);
			const last = cancelled.entries
				.filter((e) => e.type === "custom" && e.customType === "api:result")
				.at(-1);
			if (last?.type !== "custom") throw new Error("Missing cancelled result");
			const cancelledResult = (last.data as { result: DelegateResult }).result;
			expect(cancelledResult.details.status).toBe("cancelled");
			expect(cancelledResult.isError).toBe(true);
			expect(cancelledResult.details.partialOutput).toBe(true);
			expect(cancelledResult.details.usagePartial).toBe(true);
			expect(cancelledResult.details).not.toHaveProperty("budgetStop");
			expect(cancelledResult.content[0].text).toContain("Partial output");
			expect(cancelledResult.content[0].text).toContain(
				"Available finding: inspected the worker boundary; implementation remains unfinished.",
			);
			expect(cancelledResult.usage.totalTokens).toBe(3);
			expect(
				readFileSync(join(logs, "partial-generations"), "utf8")
					.trim()
					.split("\n"),
			).toHaveLength(1);
			for (const file of readdirSync(logs).filter((name) =>
				name.endsWith(".json"),
			)) {
				const child = JSON.parse(readFileSync(join(logs, file), "utf8"));
				if (!child.child) continue;
				expect(existsSync(join(logs, `${child.pid}.closed`))).toBe(true);
				expect(processExited(child.pid)).toBe(true);
				expect(existsSync(dirname(child.snapshot))).toBe(false);
				expect(
					readFileSync(join(logs, `${child.pid}.api-child`), "utf8"),
				).toContain("unavailable in a delegated child");
			}
		} finally {
			await parent.stop();
			await rm(directory, { recursive: true, force: true });
		}
	}, 45_000);
}
