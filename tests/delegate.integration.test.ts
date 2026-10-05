import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
	AgentSession,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
} from "@earendil-works/pi-coding-agent";
import { resolveCli, runDelegation } from "../src/delegate.ts";
import { captureInheritance } from "../src/inheritance.ts";
import { RpcProcess } from "../src/rpc.ts";
import { AgentStatus } from "../src/status.ts";
import { statusUI } from "./fixtures/status-ui.ts";

function required<T>(value: T | undefined): T {
	if (value === undefined)
		throw new Error("Missing configuration fixture value");
	return value;
}

const entry = resolve("src/index.ts");
const provider = resolve("tests/fixtures/provider.ts");
interface ParentState {
	tools: ToolInfo[];
	active: string[];
	commands: ReturnType<ExtensionAPI["getCommands"]>;
	model: ExtensionContext["model"];
	thinkingLevel: ExtensionContext["thinkingLevel"];
	cwd: string;
	trusted: boolean;
}

async function withParent(
	action: (
		parent: RpcProcess,
		state: ParentState,
		args: string[],
		env: NodeJS.ProcessEnv,
		logs: string,
	) => Promise<void>,
	mcp = false,
	configured = false,
) {
	const directory = await mkdtemp(join(tmpdir(), "delegate-integration-"));
	const agent = join(directory, "agent");
	const logs = join(directory, "logs");
	await mkdir(agent);
	await mkdir(logs);
	await writeFile(join(directory, "workspace-proof.txt"), "workspace proof");
	const hook = join(directory, "hook.ts");
	await writeFile(
		hook,
		`import {writeFileSync} from 'node:fs'; import {join} from 'node:path'; export default function(pi) { pi.on('session_start', () => { writeFileSync(join(process.env.FIXTURE_LOG_DIR, process.pid + '.hook'), 'loaded'); }); }`,
	);
	const args = [
		"--offline",
		"--no-session",
		"--no-approve",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--extension",
		entry,
		"--extension",
		provider,
		"--extension",
		hook,
		"--extension",
		"builtin:codemode",
		"--extension",
		"builtin:tool-search",
		"--tools",
		"read,delegate,fixture_echo,codemode,tool_search",
		"--provider",
		"delegate-fixture",
		"--model",
		"deterministic",
		"--fixture-prefix",
		"configured",
	];
	if (mcp) {
		await writeFile(
			join(agent, "mcp.json"),
			JSON.stringify({
				mcpServers: {
					fixture: {
						command: "node",
						args: [resolve("tests/fixtures/mcp.mjs")],
						exposure: "deferred",
					},
				},
			}),
		);
		args.push(
			"--extension",
			"builtin:mcp",
			"--tools",
			"read,delegate,fixture_echo,codemode,tool_search,mcp__fixture__echo",
		);
	}
	if (configured) {
		await writeFile(
			join(agent, "settings.json"),
			JSON.stringify({
				extensions: [
					entry,
					provider,
					hook,
					"builtin:codemode",
					"builtin:tool-search",
				],
			}),
		);
		for (let index = args.length - 1; index >= 0; index--) {
			if (args[index] === "--extension") args.splice(index, 2);
			else if (args[index] === "--no-extensions") args.splice(index, 1);
		}
	}
	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: agent,
		PI_OFFLINE: "1",
		FIXTURE_LOG_DIR: logs,
		PI_DELEGATE_CHILD: undefined,
		PI_DELEGATE_SNAPSHOT: undefined,
	};
	const parent = new RpcProcess(
		"node",
		[resolveCli(), "--mode", "rpc", ...args],
		{ cwd: directory, env },
	);
	try {
		if (mcp) await parent.request("prompt", { message: "/mcp" });
		await parent.request("prompt", { message: "/fixture-inspect" });
		const { entries } = await parent.request<{ entries: SessionEntry[] }>(
			"get_entries",
		);
		const state = entries.find(
			(item) => item.type === "custom" && item.customType === "fixture:state",
		);
		if (state?.type !== "custom") throw new Error("Missing fixture state");
		await action(parent, state.data as ParentState, args, env, logs);
	} finally {
		await parent.stop();
		await rm(directory, { recursive: true, force: true });
	}
}
function inherited(state: ParentState, args: string[]) {
	return captureInheritance(
		{
			getAllTools: () => state.tools,
			getActiveTools: () => state.active,
			getCommands: () => state.commands,
		},
		{ ...state, isProjectTrusted: () => state.trusted },
		entry,
		args,
	);
}
function verifyCleanup(logs: string) {
	for (const file of readdirSync(logs).filter((name) =>
		name.endsWith(".json"),
	)) {
		const data = JSON.parse(readFileSync(join(logs, file), "utf8"));
		if (!data.child) continue;
		expect(existsSync(join(logs, `${data.pid}.closed`))).toBe(true);
		expect(existsSync(join(logs, `${data.pid}.hook`))).toBe(true);
		expect(existsSync(dirname(data.snapshot))).toBe(false);
	}
}

test("real Pi RPC: concurrent fresh children reload flags, restore tools, and omit parent history", async () => {
	await withParent(async (parent, state, args, env, logs) => {
		const secretRun = parent.waitForSettled();
		try {
			await parent.request("prompt", { message: "parent-only-secret" });
			await secretRun.promise;
		} finally {
			secretRun.dispose();
		}
		const children = await Promise.all(
			["first", "second"].map((task) =>
				runDelegation({
					...inherited(state, args),
					cwd: state.cwd,
					env,
					task,
					context: "explicit-only",
				}),
			),
		);
		const results = children.map((result) =>
			JSON.parse(result.content[0].text),
		);
		expect(results[0].pid).not.toBe(results[1].pid);
		expect(children[0].details.sessionId).not.toBe(
			children[1].details.sessionId,
		);
		for (const result of results) {
			expect(result.child).toBe(true);
			expect(result.prefix).toBe("configured");
			expect(result.userCount).toBe(1);
			expect(result.prompt).not.toContain("parent-only-secret");
			expect(result.prompt).toContain("explicit-only");
			expect(result.tools).toContain("fixture_echo");
			expect(result.active).not.toContain("fixture_echo");
			expect(result.tools).not.toContain("delegate");
			expect([...result.active].sort()).toEqual(
				state.active.filter((name) => name !== "delegate").sort(),
			);
		}
		verifyCleanup(logs);
	});
}, 30_000);

test("real parent model delegates; child discovers and invokes inherited tools locally through codemode", async () => {
	await withParent(async (parent, _state, _args, _env, logs) => {
		const settled = parent.waitForSettled();
		try {
			await parent.request("prompt", { message: "DELEGATE exercise-tools" });
			await settled.promise;
		} finally {
			settled.dispose();
		}
		const { messages } = await parent.request<{
			messages: AgentSession["messages"];
		}>("get_messages");
		const delegated = messages.find(
			(item) => item.role === "toolResult" && item.toolName === "delegate",
		);
		expect(delegated?.role === "toolResult" && delegated.isError).toBe(false);
		const final = [...messages]
			.reverse()
			.find((item) => item.role === "assistant");
		if (final?.role !== "assistant" || final.content[0]?.type !== "text")
			throw new Error("Missing final answer");
		const result = JSON.parse(final.content[0].text);
		expect(result.child).toBe(true);
		expect(result.calls).toBe(1);
		expect(result.active).toContain("fixture_echo");
		expect(result.tools).not.toContain("delegate");
		expect(JSON.stringify(result.lastResult)).toContain("configured:payload");
		expect(
			delegated?.role === "toolResult" && delegated.usage?.totalTokens,
		).toBe(9);
		verifyCleanup(logs);
	});
}, 30_000);

test("real Pi model failure is not reported as successful prompt acceptance", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		const result = await runDelegation({
			...inherited(state, args),
			cwd: state.cwd,
			env,
			task: "fail-model",
		});
		expect(result.details.status).toBe("failed");
		expect(result.details.stopReason).toBe("error");
		expect(result.details.error).toContain("fixture model failure");
		expect(result.isError).toBe(true);
		expect(result.usage.totalTokens).toBe(3);
		verifyCleanup(logs);
	});
}, 30_000);

for (const [task, status, reason, isError] of [
	["length-model", "incomplete", "length", false],
	["abort-model", "cancelled", "aborted", true],
] as const) {
	test(`real Pi RPC: ${reason} produces ${status} and cleans the child`, async () => {
		await withParent(async (_parent, state, args, env, logs) => {
			const child = await runDelegation({
				...inherited(state, args),
				cwd: state.cwd,
				env: { ...env, FIXTURE_FINAL_TEXT: "partial model answer" },
				task,
			});
			expect(child.details.status).toBe(status);
			expect(child.details.stopReason).toBe(reason);
			expect(child.isError).toBe(isError);
			expect(child.usage.totalTokens).toBe(3);
			expect(child.details.sessionId).toBeTruthy();
			expect(child.content[0].text).toContain(`Delegation ${status}`);
			if (status === "incomplete")
				expect(child.content[0].text).toContain("partial model answer");
			verifyCleanup(logs);
		});
	}, 30_000);
}

test("real parent tool results preserve structured failure and isError", async () => {
	await withParent(async (parent, _state, _args, _env, logs) => {
		const settled = parent.waitForSettled();
		try {
			await parent.request("prompt", { message: "DELEGATE child-failure" });
			await settled.promise;
		} finally {
			settled.dispose();
		}
		const { messages } = await parent.request<{
			messages: AgentSession["messages"];
		}>("get_messages");
		const delegated = messages.find(
			(item) => item.role === "toolResult" && item.toolName === "delegate",
		);
		expect(delegated?.role === "toolResult" && delegated.isError).toBe(true);
		expect(delegated?.role === "toolResult" && delegated.details).toMatchObject(
			{
				status: "failed",
				stopReason: "error",
				error: "fixture model failure",
			},
		);
		verifyCleanup(logs);
	});
}, 30_000);

test("length limit and presentation truncation remain independent", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		const text = "partial".repeat(DEFAULT_MAX_BYTES);
		const child = await runDelegation({
			...inherited(state, args),
			cwd: state.cwd,
			env: { ...env, FIXTURE_FINAL_TEXT: text },
			task: "length-model",
		});
		const path = child.details.fullOutputPath;
		if (!path) throw new Error("Missing partial output file");
		try {
			expect(child.details.status).toBe("incomplete");
			expect(child.details.truncation?.truncated).toBe(true);
			expect(child.isError).toBe(false);
			expect(child.content[0].text).toContain("Delegation incomplete");
			expect(readFileSync(path, "utf8")).toBe(text);
			verifyCleanup(logs);
		} finally {
			await rm(dirname(path), { recursive: true, force: true });
		}
	});
}, 30_000);

test("real MCP tools are reconnected and executed in a child-owned server", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		expect(state.tools.map((tool) => tool.name)).toContain(
			"mcp__fixture__echo",
		);
		const child = await runDelegation({
			...inherited(state, args),
			cwd: state.cwd,
			env,
			task: "exercise-mcp",
		});
		const result = JSON.parse(child.content[0].text);
		const servers = readdirSync(logs)
			.filter((file) => file.endsWith(".mcp"))
			.map((file) => JSON.parse(readFileSync(join(logs, file), "utf8")));
		const childServer = servers.find((server) => server.child);
		expect(childServer).toBeDefined();
		expect(() => process.kill(childServer.pid, 0)).toThrow();
		expect(JSON.stringify(result.lastResult)).toContain(
			`mcp:${childServer.pid}:payload`,
		);
		expect(result.tools).not.toContain("delegate");
		verifyCleanup(logs);
	}, true);
}, 30_000);

test("parent shutdown cancels an active delegated child", async () => {
	await withParent(async (parent, _state, _args, _env, logs) => {
		await parent.request("prompt", { message: "DELEGATE hang" });
		const deadline = Date.now() + 10_000;
		while (
			!readdirSync(logs)
				.filter((file) => file.endsWith(".json"))
				.some(
					(file) => JSON.parse(readFileSync(join(logs, file), "utf8")).child,
				)
		) {
			if (Date.now() >= deadline)
				throw new Error("Delegated child did not start");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		await parent.stop();
		verifyCleanup(logs);
	});
}, 30_000);

test("inherited built-in read uses the same workspace", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		const child = await runDelegation({
			...inherited(state, args),
			cwd: state.cwd,
			env,
			task: "exercise-read",
		});
		const result = JSON.parse(child.content[0].text);
		expect(JSON.stringify(result.lastResult)).toContain("workspace proof");
		verifyCleanup(logs);
	});
}, 30_000);

test("configured extensions, including a hook-only extension, reload through normal discovery", async () => {
	await withParent(
		async (_parent, state, args, env, logs) => {
			expect(args).not.toContain("--extension");
			const child = await runDelegation({
				...inherited(state, args),
				cwd: state.cwd,
				env,
				task: "configured discovery",
			});
			const result = JSON.parse(child.content[0].text);
			expect(result.prefix).toBe("configured");
			expect(result.tools).toContain("fixture_echo");
			verifyCleanup(logs);
		},
		false,
		true,
	);
}, 30_000);

test("real Pi RPC: oversized answers survive child cleanup with session and usage details", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		for (const text of [
			"x".repeat(DEFAULT_MAX_BYTES + 1),
			Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_, i) => `line-${i}`).join(
				"\n",
			),
		]) {
			const child = await runDelegation({
				...inherited(state, args),
				cwd: state.cwd,
				env: { ...env, FIXTURE_FINAL_TEXT: text },
				task: "oversized answer",
			});
			const path = child.details.fullOutputPath;
			if (!path) throw new Error("Missing full output path");
			try {
				verifyCleanup(logs);
				expect(readFileSync(path, "utf8")).toBe(text);
				expect(child.content[0].text).toContain(path);
				expect(child.details.truncation?.truncated).toBe(true);
				expect(child.details.status).toBe("completed");
				expect(child.details.sessionId).toBeTruthy();
				expect(child.usage.totalTokens).toBe(3);
			} finally {
				await rm(dirname(path), { recursive: true, force: true });
			}
		}
	});
}, 30_000);

const exactModel = {
	provider: "delegate-fixture",
	id: "reasoning/path:variant",
};
async function until(predicate: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 10000;
	while (!(await predicate())) {
		if (Date.now() >= deadline)
			throw new Error("Configuration fixture timed out");
		await Bun.sleep(10);
	}
}

for (const background of [false, true]) {
	for (const overrides of [
		{},
		{ model: exactModel },
		{ thinkingLevel: "max" },
		{
			model: { ...exactModel, provider: "delegate-fixture-other" },
			thinkingLevel: "max",
		},
	]) {
		test(`real public Pi selection ${background ? "background" : "sync"} ${JSON.stringify(overrides)}`, async () => {
			await withParent(async (parent, state, _args, env, logs) => {
				const settings = join(
					required(env.PI_CODING_AGENT_DIR),
					"settings.json",
				);
				const saved = JSON.stringify({
					defaultThinkingLevel: "low",
					modelThinkingLevels: {
						"delegate-fixture/reasoning/path:variant": "high",
						"delegate-fixture-other/reasoning/path:variant": "high",
					},
				});
				await writeFile(settings, saved);
				const before = await parent.request("get_state");
				const settled = parent.waitForSettled();
				try {
					await parent.request("prompt", {
						message: `CONFIG ${JSON.stringify({ task: "configuration probe", background, ...overrides })}`,
					});
					await settled.promise;
				} finally {
					settled.dispose();
				}
				let result: import("../src/delegate.ts").DelegationDetails | undefined;
				let output = "";
				await until(async () => {
					const { messages } = await parent.request<{
						messages: AgentSession["messages"];
					}>("get_messages");
					const message = messages.find((m) =>
						background
							? m.role === "custom" && m.customType === "pi-delegate:completed"
							: m.role === "toolResult" && m.toolName === "delegate",
					);
					if (
						!message ||
						(message.role !== "custom" && message.role !== "toolResult")
					)
						return false;
					result = background
						? (
								message.details as {
									result?: import("../src/delegate.ts").DelegationDetails;
								}
							).result
						: (message.details as import("../src/delegate.ts").DelegationDetails);
					output =
						typeof message.content === "string"
							? message.content
							: message.content
									.filter((b) => b.type === "text")
									.map((b) => b.text)
									.join("\n");
					return result !== undefined;
				});
				const model = overrides.model ?? {
					provider: required(state.model).provider,
					id: required(state.model).id,
				};
				const requested = {
					model,
					thinkingLevel: overrides.thinkingLevel ?? state.thinkingLevel,
				};
				const effective = {
					model,
					thinkingLevel:
						model.id === "deterministic"
							? "off"
							: overrides.thinkingLevel === "max"
								? "high"
								: requested.thinkingLevel,
				};
				expect(result).toMatchObject({
					status: "completed",
					configuration: { requested, effective },
				});
				const onsetFiles = readdirSync(logs).filter(
					(name) =>
						name.endsWith(".onset") &&
						JSON.parse(
							readFileSync(join(logs, name.replace(".onset", ".json")), "utf8"),
						).child,
				);
				expect(onsetFiles).toHaveLength(1);
				expect(
					JSON.parse(readFileSync(join(logs, required(onsetFiles[0])), "utf8")),
				).toEqual(effective);
				expect(output).toContain("startupConfiguration");
				const after = await parent.request<{
					model: unknown;
					thinkingLevel: unknown;
				}>("get_state");
				expect({
					model: after.model,
					thinkingLevel: after.thinkingLevel,
				}).toEqual({
					model: (before as typeof after).model,
					thinkingLevel: (before as typeof after).thinkingLevel,
				});
				expect(readFileSync(settings, "utf8")).toBe(saved);
				verifyCleanup(logs);
			});
		}, 30000);
	}
}

for (const failure of [
	"missing-model",
	"missing-auth",
	"cancel-init",
] as const) {
	test(`real startup ${failure} preserves request without submitting original task`, async () => {
		await withParent(async (_parent, state, args, env, logs) => {
			const controller = new AbortController();
			const requested = {
				model:
					failure === "missing-auth"
						? { ...exactModel, provider: "delegate-fixture-no-auth" }
						: exactModel,
				thinkingLevel: "low" as const,
			};
			const operation = runDelegation({
				...inherited(state, args),
				cwd: state.cwd,
				task: "MUST NOT EXECUTE",
				requestedConfiguration: requested,
				env: {
					...env,
					...(failure === "missing-model" ? { FIXTURE_HIDE_MODEL: "1" } : {}),
					...(failure === "cancel-init" ? { FIXTURE_HOLD_INIT: "1" } : {}),
				},
				signal: controller.signal,
			});
			if (failure === "cancel-init") {
				await until(() =>
					readdirSync(logs).some((name) => name.endsWith(".pending")),
				);
				controller.abort();
			}
			const result = await operation;
			expect(result.details).toMatchObject({
				status: failure === "cancel-init" ? "cancelled" : "failed",
				configuration: { requested },
			});
			expect(result.details.configuration).not.toHaveProperty("effective");
			expect(result.usage.totalTokens).toBe(0);
			expect(
				readdirSync(logs).filter((name) => name.endsWith(".onset")),
			).toEqual([]);
			if (failure === "missing-model")
				expect(result.details.error).toContain("Model not found");
			if (failure === "missing-auth")
				expect(result.details.error).toContain("Model not found");
			// Forced cancellation during host session_start need not emit session_shutdown.
			for (const file of readdirSync(logs).filter((name) =>
				name.endsWith(".json"),
			)) {
				const data = JSON.parse(readFileSync(join(logs, file), "utf8"));
				if (data.child) {
					expect(existsSync(dirname(data.snapshot))).toBe(false);
					expect(() => process.kill(data.pid, 0)).toThrow();
				}
			}
		});
	}, 30000);
}

test("real concurrent child startup and UI retain snapshots across parent changes and cancellation", async () => {
	await withParent(async (parent, state, args, env, logs) => {
		const host = await statusUI();
		const status = new AgentStatus();
		status.bind({ mode: "tui", ui: host.ui });
		const requests = [
			{ model: exactModel, thinkingLevel: "low" as const },
			{
				model: { provider: "delegate-fixture", id: "deterministic" },
				thinkingLevel: "max" as const,
			},
		];
		const controllers = requests.map(() => new AbortController());
		const pending = requests.map((requestedConfiguration, index) =>
			runDelegation({
				...inherited(state, args),
				requestedConfiguration,
				cwd: state.cwd,
				env: { ...env, FIXTURE_HOLD_INIT: "1" },
				task: `hang configuration ${index}`,
				status: status.add(`task ${index}`),
				signal: required(controllers[index]).signal,
			}),
		);
		try {
			await until(
				() =>
					readdirSync(logs).filter((name) => name.endsWith(".pending"))
						.length === 2,
			);
			expect(host.frame()).toContain("model: unconfirmed");
			expect(host.frame()).not.toContain(exactModel.id);
			expect(host.frame()).toContain("0s · 0 turns");
			await parent.request("set_model", {
				provider: "delegate-fixture-other",
				modelId: exactModel.id,
			});
			await parent.request("set_thinking_level", { level: "high" });
			await writeFile(join(logs, "release-init"), "release");
			await until(
				() =>
					readdirSync(logs).filter((name) => name.endsWith(".onset")).length ===
					2,
			);
			expect(host.frame()).toContain(
				`│  model: ${exactModel.provider}/${exactModel.id} · thinking: low`,
			);
			expect(host.frame()).toContain(
				"│  model: delegate-fixture/deterministic · thinking: off",
			);
			expect(host.frame()).not.toContain("delegate-fixture-other");
			expect(host.frame()).not.toContain("thinking…");
			for (const controller of controllers) controller.abort();
			const results = await Promise.all(pending);
			for (const [index, result] of results.entries()) {
				expect(result.details).toMatchObject({
					status: "cancelled",
					configuration: {
						requested: requests[index],
						effective: {
							model: required(requests[index]).model,
							thinkingLevel: index === 0 ? "low" : "off",
						},
					},
				});
			}
			expect(host.frame()).toContain("thinking: low");
			const parentAfter = await parent.request<{
				model: { provider: string };
				thinkingLevel: string;
			}>("get_state");
			expect(parentAfter.model.provider).toBe("delegate-fixture-other");
			expect(parentAfter.thinkingLevel).toBe("high");
			verifyCleanup(logs);
		} finally {
			for (const controller of controllers) controller.abort();
			await Promise.all(pending);
			status.close();
			host.tui.stop();
		}
	});
}, 30000);

test("real Pi RPC: separate non-Git cwd discovers target context and executes inherited read locally", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		const target = join(state.cwd, "target workspace");
		await mkdir(target);
		await writeFile(join(target, "workspace-proof.txt"), "target-only proof");
		await writeFile(join(target, "AGENTS.md"), "TARGET_CONTEXT_0008");
		await writeFile(join(state.cwd, "AGENTS.md"), "PARENT_CONTEXT_0008");
		const children = await Promise.all(
			[state.cwd, target].map((cwd) =>
				runDelegation({
					...captureInheritance(
						{
							getAllTools: () => state.tools,
							getActiveTools: () => state.active,
							getCommands: () => state.commands,
						},
						{ ...state, isProjectTrusted: () => state.trusted },
						entry,
						args,
						cwd,
					),
					cwd,
					env,
					task: "exercise-read",
				}),
			),
		);
		for (const [index, child] of children.entries()) {
			expect(child.details.status).toBe("completed");
			expect(child.details.cwd).toBe(index === 0 ? state.cwd : target);
			const report = JSON.parse(child.content[0].text);
			expect(report.cwd).toBe(child.details.cwd);
			expect(JSON.stringify(report.lastResult)).toContain(
				index === 0 ? "workspace proof" : "target-only proof",
			);
			expect(JSON.stringify(report.systemPrompt)).toContain(
				index === 0 ? "PARENT_CONTEXT_0008" : "TARGET_CONTEXT_0008",
			);
			expect(report.tools).not.toContain("delegate");
		}
		expect(existsSync(join(target, ".git"))).toBe(false);
		expect(existsSync(target)).toBe(true);
		verifyCleanup(logs);
	});
}, 30_000);

for (const trust of ["native", "approve", "no-approve"] as const) {
	test(`real Pi RPC: target project loading follows ${trust} trust without rebasing inherited sources`, async () => {
		await withParent(async (_parent, state, args, env, logs) => {
			const target = join(state.cwd, `trust ${trust}`);
			const project = join(target, ".pi");
			await mkdir(join(project, "extensions"), { recursive: true });
			const marker = join(logs, `target-${trust}.loaded`);
			await writeFile(
				join(project, "extensions", "context.ts"),
				`import {writeFileSync} from 'node:fs'; export default function(pi) { pi.on('session_start', () => writeFileSync(${JSON.stringify(marker)}, 'target')); }`,
			);
			const startup = args.filter(
				(arg) => arg !== "--no-approve" && arg !== "--no-extensions",
			);
			if (trust !== "native") startup.push(`--${trust}`);
			const selection = captureInheritance(
				{
					getAllTools: () => state.tools,
					getActiveTools: () => state.active,
					getCommands: () => state.commands,
				},
				{ ...state, isProjectTrusted: () => true },
				entry,
				startup,
				target,
			);
			const child = await runDelegation({
				...selection,
				cwd: target,
				env,
				task: "trust-probe",
			});
			expect(child.details.status).toBe("completed");
			expect(child.details.cwd).toBe(target);
			expect(existsSync(marker)).toBe(trust === "approve");
			expect(JSON.parse(child.content[0].text).prefix).toBe("configured");
			verifyCleanup(logs);
		});
	}, 30_000);
}

for (const background of [false, true]) {
	test(`real parent public delegate cwd: ${background ? "background completion" : "sync result"} reads selected workspace`, async () => {
		await withParent(async (parent, state, _args, _env, logs) => {
			const target = join(state.cwd, "public target");
			await mkdir(target);
			await writeFile(
				join(target, "workspace-proof.txt"),
				"public-target-proof",
			);
			const settled = parent.waitForSettled();
			try {
				await parent.request("prompt", {
					message: `CONFIG ${JSON.stringify({ task: "exercise-read", cwd: "public target", background })}`,
				});
				await settled.promise;
			} finally {
				settled.dispose();
			}
			let outcome: unknown;
			for (let i = 0; i < 500 && !outcome; i++) {
				const { messages } = await parent.request<{
					messages: AgentSession["messages"];
				}>("get_messages");
				if (background) {
					const completion = messages.find(
						(item) =>
							item.role === "custom" &&
							item.customType === "pi-delegate:completed",
					);
					if (completion?.role === "custom") outcome = completion.details;
				} else {
					const result = messages.find(
						(item) =>
							item.role === "toolResult" && item.toolName === "delegate",
					);
					if (result?.role === "toolResult") {
						outcome = result.details;
						expect(JSON.stringify(result.content)).toContain(
							"public-target-proof",
						);
					}
				}
				if (!outcome) await Bun.sleep(10);
			}
			expect(outcome).toMatchObject(
				background
					? { status: "completed", result: { cwd: target } }
					: { status: "completed", cwd: target },
			);
			verifyCleanup(logs);
		});
	}, 30_000);
}

test("real incompatible target registration fails before the original task", async () => {
	await withParent(async (_parent, state, args, env, logs) => {
		const target = join(state.cwd, "incompatible target");
		const project = join(target, ".pi", "extensions");
		await mkdir(project, { recursive: true });
		await writeFile(
			join(project, "mismatch.ts"),
			`import {Type} from '@earendil-works/pi-ai'; export default function(pi) { pi.registerTool({name:'fixture_echo', label:'Mismatch', description:'Mismatch', exposure:'deferred', parameters:Type.Object({value:Type.Number()}), async execute() { throw new Error('must not run'); }}); }`,
		);
		const startup = args.filter(
			(arg) => arg !== "--no-approve" && arg !== "--no-extensions",
		);
		startup.push("--approve");
		const selection = captureInheritance(
			{
				getAllTools: () => state.tools,
				getActiveTools: () => state.active,
				getCommands: () => state.commands,
			},
			{ ...state, isProjectTrusted: () => state.trusted },
			entry,
			startup,
			target,
		);
		const child = await runDelegation({
			...selection,
			cwd: target,
			env,
			task: "must-not-start",
		});
		expect(child.details.status).toBe("failed");
		expect(child.details.error).toContain("Pi RPC child exited: code=1");
		expect(child.details.cwd).toBe(target);
		for (const file of readdirSync(logs).filter((name) =>
			name.endsWith(".json"),
		)) {
			const log = JSON.parse(readFileSync(join(logs, file), "utf8"));
			if (log.child)
				expect(existsSync(join(logs, `${log.pid}.onset`))).toBe(false);
		}
		verifyCleanup(logs);
	});
}, 30_000);

for (const background of [false, true]) {
	test(`real Pi public ${background ? "background" : "sync"} rejects cwd null without launching a fallback child`, async () => {
		await withParent(async (parent, _state, _args, _env, logs) => {
			const settled = parent.waitForSettled();
			try {
				await parent.request("prompt", {
					message: `CONFIG ${JSON.stringify({ task: "exercise-read", cwd: null, background })}`,
				});
				await settled.promise;
			} finally {
				settled.dispose();
			}
			const { messages } = await parent.request<{
				messages: AgentSession["messages"];
			}>("get_messages");
			const result = messages.find(
				(item) => item.role === "toolResult" && item.toolName === "delegate",
			);
			if (result?.role !== "toolResult")
				throw new Error("Missing delegate result");
			expect(result.isError).toBe(true);
			expect(result.details).toMatchObject({
				status: "failed",
				error: "Delegation cwd must be a non-blank directory path",
			});
			expect(result.details).not.toHaveProperty("cwd");
			expect(result.details).not.toHaveProperty("taskId");
			const children = readdirSync(logs)
				.filter((file) => file.endsWith(".json"))
				.map((file) => JSON.parse(readFileSync(join(logs, file), "utf8")))
				.filter((log) => log.child);
			expect(children).toEqual([]);
		});
	}, 30_000);
}
