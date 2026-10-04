import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type BackgroundTaskResult,
	BackgroundTasks,
} from "../src/background.ts";
import {
	type DelegationOptions,
	type DelegationResult,
	runDelegation,
} from "../src/delegate.ts";

const requested = {
	model: { provider: "fixture", id: "exact/id:variant" },
	thinkingLevel: "max" as const,
};
async function until(predicate: () => boolean) {
	const deadline = Date.now() + 5000;
	while (!predicate()) {
		if (Date.now() > deadline)
			throw new Error("Configuration runner timed out");
		await Bun.sleep(5);
	}
}
for (const background of [false, true])
	for (const scenario of [
		"success",
		"set_model",
		"set_thinking_level",
		"get_state",
		"mismatch",
		"invalid-level",
		"execution-error",
		"cancel",
	]) {
		test(`runner verifies before task/control/observers, retains configuration in ${background ? "background" : "sync"} ${scenario}`, async () => {
			const dir = await mkdtemp(join(tmpdir(), "configuration-runner-"));
			const log = join(dir, "commands.jsonl");
			const commands = (): {
				type: string;
				message?: string;
				modelId?: string;
				level?: string;
			}[] =>
				existsSync(log)
					? readFileSync(log, "utf8")
							.trim()
							.split("\n")
							.filter(Boolean)
							.map((line) => JSON.parse(line))
					: [];
			const controller = new AbortController();
			const observed: string[] = [];
			const delivered: BackgroundTaskResult[] = [];
			const owner = new BackgroundTasks(
				runDelegation,
				() => {
					throw new Error("Runner must return structured failure");
				},
				(result) => {
					delivered.push(result);
				},
			);
			const options: DelegationOptions = {
				cwd: process.cwd(),
				args: [],
				snapshot: { version: 1, tools: [], active: [] },
				requestedConfiguration: requested,
				task: "original task",
				cliPath: resolve("tests/fixtures/configuration-rpc.mjs"),
				env: { CONFIGURATION_LOG: log, CONFIGURATION_SCENARIO: scenario },
				signal: controller.signal,
				onSteeringControl: () => {
					observed.push("control");
				},
				status: {
					configured: () => {
						observed.push("configuration");
					},
					observe: (record) => {
						observed.push(String(record.type));
					},
					accepted() {},
					finish() {},
				},
			};
			try {
				let result: DelegationResult | undefined;
				let taskId: string | undefined;
				let operation: Promise<DelegationResult> | undefined;
				if (background) {
					const acknowledgement = owner.start(options, {
						isIdle: () => true,
						hasPendingMessages: () => false,
					});
					taskId = acknowledgement.details.taskId;
					expect(acknowledgement.details).not.toHaveProperty("result");
				} else operation = runDelegation(options);
				if (scenario === "cancel") {
					await until(() =>
						commands().some((command) => command.type === "get_state"),
					);
					if (taskId) await owner.cancel(taskId);
					else controller.abort();
				}
				if (taskId) {
					await until(
						() => owner.query(taskId as string).details.result !== undefined,
					);
					const queried = owner.query(taskId);
					await until(() => delivered.length === 1);
					expect(delivered[0]?.details.result).toEqual(queried.details.result);
					result = {
						details: queried.details.result as DelegationResult["details"],
						content: queried.content,
						usage: queried.details.usage as DelegationResult["usage"],
						isError: queried.isError,
					};
				} else result = await operation;
				if (!result) throw new Error("Missing result");
				const confirmed = ["success", "execution-error"].includes(scenario);
				expect(result.details.status).toBe(
					scenario === "success"
						? "completed"
						: scenario === "cancel"
							? "cancelled"
							: "failed",
				);
				expect(result.details.configuration?.requested).toEqual(requested);
				if (confirmed) {
					expect(result.details.configuration?.effective).toEqual({
						model: requested.model,
						thinkingLevel: "low",
					});
					expect(observed[0]).toBe("configuration");
					const types = commands().map((command) => command.type);
					expect(types.slice(0, 6)).toEqual([
						"prompt",
						"get_entries",
						"set_model",
						"set_thinking_level",
						"get_state",
						"prompt",
					]);
					expect(commands()[2]?.modelId).toBe("exact/id:variant");
					expect(commands()[3]?.level).toBe("max");
				} else {
					expect(result.details.configuration).not.toHaveProperty("effective");
					expect(observed).toEqual([]);
					expect(
						commands().filter((command) =>
							command.message?.startsWith("Task:"),
						),
					).toEqual([]);
				}
			} finally {
				controller.abort();
				await owner.invalidate(true);
				await rm(dir, { recursive: true, force: true });
			}
		});
	}
