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
import { resolveCli, runDelegation } from "../src/delegate.ts";
import { captureInheritance } from "../src/inheritance.ts";
import { RpcProcess } from "../src/rpc.ts";

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
		await expect(
			runDelegation({
				...inherited(state, args),
				cwd: state.cwd,
				env,
				task: "fail-model",
			}),
		).rejects.toThrow("fixture model failure");
		verifyCleanup(logs);
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
