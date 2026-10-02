import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	defineTool,
	type ExtensionAPI,
	type ExtensionToolContext,
	getPackageDir,
	type RpcExtensionUIRequest,
	type RpcExtensionUIResponse,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	CHILD_ENV,
	captureInheritance,
	DELEGATE_TOOL,
	INIT_COMMAND,
	INIT_ENTRY,
	type InheritanceSnapshot,
	SNAPSHOT_ENV,
} from "./inheritance.ts";
import { RpcProcess } from "./rpc.ts";

export function resolveCli(): string {
	const root = getPackageDir();
	for (const path of [
		join(root, "dist/bundle/cli.js"),
		join(root, "dist/cli.js"),
	]) {
		if (existsSync(path)) return path;
	}
	throw new Error("Cannot locate the Pi CLI in the installed host package");
}

function sumUsage(messages: AgentSession["messages"]): Usage {
	const sum: Usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	for (const message of messages) {
		if (message.role !== "assistant" && message.role !== "toolResult") continue;
		const usage = message.usage;
		if (!usage) continue;
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"totalTokens",
		] as const)
			sum[key] += usage[key];
		for (const key of [
			"input",
			"output",
			"cacheRead",
			"cacheWrite",
			"total",
		] as const)
			sum.cost[key] += usage.cost[key];
		if (usage.reasoning !== undefined)
			sum.reasoning = (sum.reasoning ?? 0) + usage.reasoning;
		if (usage.cacheWrite1h !== undefined)
			sum.cacheWrite1h = (sum.cacheWrite1h ?? 0) + usage.cacheWrite1h;
	}
	return sum;
}

export interface DelegationOptions {
	cwd: string;
	args: string[];
	snapshot: InheritanceSnapshot;
	task: string;
	context?: string;
	signal?: AbortSignal;
	ui?: (
		request: RpcExtensionUIRequest,
	) => Promise<RpcExtensionUIResponse | undefined>;
	cliPath?: string;
	env?: NodeJS.ProcessEnv;
}

export async function runDelegation(options: DelegationOptions) {
	options.signal?.throwIfAborted();
	const directory = await mkdtemp(join(tmpdir(), "pi-delegate-"));
	let rpc: RpcProcess | undefined;
	let settlement: ReturnType<RpcProcess["waitForSettled"]> | undefined;
	try {
		const snapshotPath = join(directory, "inheritance.json");
		await writeFile(snapshotPath, JSON.stringify(options.snapshot), {
			mode: 0o600,
		});
		options.signal?.throwIfAborted();
		rpc = new RpcProcess(
			process.versions.bun ? "node" : process.execPath,
			[options.cliPath ?? resolveCli(), "--mode", "rpc", ...options.args],
			{
				cwd: options.cwd,
				env: {
					...process.env,
					...options.env,
					[CHILD_ENV]: "1",
					[SNAPSHOT_ENV]: snapshotPath,
				},
			},
			options.signal,
			options.ui,
		);
		await rpc.request("prompt", { message: `/${INIT_COMMAND}` });
		const { entries } = await rpc.request<{ entries: SessionEntry[] }>(
			"get_entries",
		);
		const initialized = [...entries]
			.reverse()
			.find(
				(entry) => entry.type === "custom" && entry.customType === INIT_ENTRY,
			);
		const status =
			initialized?.type === "custom"
				? (initialized.data as { ok?: boolean; error?: string } | undefined)
				: undefined;
		if (!status?.ok)
			throw new Error(status?.error ?? "Child initialization handshake failed");

		settlement = rpc.waitForSettled();
		// Prefixing prevents task text beginning with '/' from being dispatched as an extension command.
		const message = `Task:\n${options.task}${options.context === undefined ? "" : `\n\nSupplementary context:\n${options.context}`}`;
		const accepted = await rpc.request<{ disposition: string }>("prompt", {
			message,
		});
		if (accepted.disposition !== "started")
			throw new Error(`Child task did not start: ${accepted.disposition}`);
		await settlement.promise;
		const { messages } = await rpc.request<{
			messages: AgentSession["messages"];
		}>("get_messages");
		const final = [...messages]
			.reverse()
			.find((item) => item.role === "assistant");
		if (final?.role !== "assistant")
			throw new Error("Child completed without an assistant result");
		if (final.stopReason === "aborted") throw new Error("Child task cancelled");
		if (final.stopReason === "error")
			throw new Error(final.errorMessage ?? "Child model run failed");
		if (final.stopReason !== "stop" && final.stopReason !== "length") {
			throw new Error(
				`Child did not finish with a final answer: ${final.stopReason}`,
			);
		}
		const text = final.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const state = await rpc.request<{ sessionId: string }>("get_state");
		options.signal?.throwIfAborted();
		return {
			content: [{ type: "text" as const, text }],
			details: { status: "completed" as const, sessionId: state.sessionId },
			usage: sumUsage(messages),
		};
	} catch (error) {
		if (options.signal?.aborted) throw new Error("Delegation cancelled");
		throw error;
	} finally {
		settlement?.dispose();
		try {
			await rpc?.stop();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
}

async function forwardUi(
	ctx: ExtensionToolContext,
	signal: AbortSignal,
	request: RpcExtensionUIRequest,
): Promise<RpcExtensionUIResponse | undefined> {
	if (!ctx.hasUI || signal.aborted) return undefined;
	const opts = {
		signal,
		timeout: "timeout" in request ? request.timeout : undefined,
	};
	const title = "title" in request ? `[subagent] ${request.title}` : "Subagent";
	switch (request.method) {
		case "select": {
			const value = await ctx.ui.select(title, request.options, opts);
			return {
				type: "extension_ui_response",
				id: request.id,
				...(value === undefined ? { cancelled: true } : { value }),
			};
		}
		case "confirm":
			return {
				type: "extension_ui_response",
				id: request.id,
				confirmed: await ctx.ui.confirm(title, request.message, opts),
			};
		case "input": {
			const value = await ctx.ui.input(title, request.placeholder, opts);
			return {
				type: "extension_ui_response",
				id: request.id,
				...(value === undefined ? { cancelled: true } : { value }),
			};
		}
		case "notify":
			ctx.ui.notify(`[subagent] ${request.message}`, request.notifyType);
			break;
		// Editor has no abortable extension API. Cancel it rather than orphaning an editor on tool cancellation.
		case "editor":
			return { type: "extension_ui_response", id: request.id, cancelled: true };
	}
	return undefined;
}

export function registerDelegate(pi: ExtensionAPI): void {
	const active = new Map<AbortController, Promise<unknown>>();
	const entryPath = fileURLToPath(new URL("./index.ts", import.meta.url));
	pi.registerTool(
		defineTool({
			name: DELEGATE_TOOL,
			label: "Delegate",
			description:
				"Run a task in a fresh Pi RPC subagent with the same extensions and inherited tools, excluding delegation. Waits for its final answer. Supply all necessary context explicitly.",
			parameters: Type.Object({
				task: Type.String({
					minLength: 1,
					description: "Task for the subagent",
				}),
				context: Type.Optional(
					Type.String({
						description:
							"Supplementary context; the parent conversation is not copied",
					}),
				),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				if (!params.task.trim())
					throw new Error("Delegation task must not be blank");
				const controller = new AbortController();
				const combined = signal
					? AbortSignal.any([signal, controller.signal])
					: controller.signal;
				const inherited = captureInheritance(pi, ctx, entryPath);
				const operation = runDelegation({
					...inherited,
					cwd: ctx.cwd,
					task: params.task,
					context: params.context,
					signal: combined,
					ui: (request) => forwardUi(ctx, combined, request),
				});
				active.set(controller, operation);
				try {
					return await operation;
				} finally {
					active.delete(controller);
				}
			},
		}),
	);
	pi.on("session_shutdown", async () => {
		for (const controller of active.keys()) controller.abort();
		await Promise.allSettled(active.values());
	});
}
