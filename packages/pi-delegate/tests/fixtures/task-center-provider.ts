import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskDetails, TaskPage } from "../../src/tasks.ts";

export default function fixture(pi: ExtensionAPI): void {
	const directory = process.env.FIXTURE_LOG_DIR;
	if (!directory)
		throw new Error("Task-center fixture requires FIXTURE_LOG_DIR");
	const child = process.env.PI_DELEGATE_CHILD === "1";
	pi.on("before_agent_start", () => {
		if (child)
			writeFileSync(
				join(directory, `${process.pid}.child`),
				JSON.stringify({
					tools: pi.getAllTools().map((tool) => tool.name),
					commands: pi.getCommands().map((command) => command.name),
				}),
			);
	});
	pi.registerTool(
		defineTool({
			name: "task_center_probe",
			label: "Task center probe",
			description: "Offline integration probe",
			parameters: Type.Object({ inspectOnly: Type.Optional(Type.Boolean()) }),
			async execute(_id, params, _signal, _update, ctx) {
				if (params.inspectOnly)
					return (await ctx.executeTool("delegate_list", {})).result;
				const deadline = Date.now() + 20000;
				const list = async () =>
					(await ctx.executeTool("delegate_list", {})).result
						.details as TaskPage;
				const query = async (taskId: string) =>
					ctx.executeTool("delegate_status", { taskId });
				const background = await ctx.executeTool("delegate", {
					task: "HOLD background",
					title: "RPC background",
					background: true,
				});
				const syncPromise = ctx.executeTool("delegate", {
					task: "HOLD",
					title: "RPC synchronous",
					thinkingLevel: "high",
				});
				let active: TaskPage;
				do {
					active = await list();
					if (Date.now() > deadline)
						throw new Error("Missing pending sync record");
					await sleep(5);
				} while (
					!active.tasks.some(
						(task) => task.mode === "synchronous" && task.status === "running",
					)
				);
				const sync = active.tasks.find((task) => task.mode === "synchronous");
				if (!sync) throw new Error("Missing pending synchronous task");
				const pending = await query(sync.taskId);
				const cancel = await ctx.executeTool("delegate_cancel", {
					taskId: sync.taskId,
				});
				const steer = await ctx.executeTool("delegate_steer", {
					taskId: sync.taskId,
					message: "must not abort",
				});
				const queued = await ctx.executeTool("delegate", {
					task: "must never spawn",
					background: true,
					thinkingLevel: "high",
				});
				const queuedId = (queued.result.details as { taskId: string }).taskId;
				const queuedBefore = await query(queuedId);
				const queuedCancel = await ctx.executeTool("delegate_cancel", {
					taskId: queuedId,
				});
				const queuedAfter = await query(queuedId);
				writeFileSync(join(directory, "release"), "release");
				const syncResult = await syncPromise;
				const backgroundId = (background.result.details as { taskId: string })
					.taskId;
				let backgroundResult: Awaited<ReturnType<typeof query>>;
				do {
					backgroundResult = await query(backgroundId);
					if (Date.now() > deadline)
						throw new Error("Background did not finish");
					await sleep(5);
				} while (
					!(backgroundResult.result.details as { task: TaskDetails }).task
						.resultAvailable
				);
				const finished = await ctx.executeTool("delegate_list", {
					group: "finished",
					limit: 1,
				});
				const finalSync = await query(sync.taskId);
				const repeatedSync = await query(sync.taskId);
				const report = {
					active,
					pending,
					cancel,
					steer,
					syncResult,
					finalSync,
					repeatedSync,
					background,
					backgroundResult,
					finished,
					queuedBefore,
					queuedCancel,
					queuedAfter,
				};
				writeFileSync(join(directory, "observed.json"), JSON.stringify(report));
				return {
					content: [{ type: "text", text: "task center probe complete" }],
					details: report,
				};
			},
		}),
	);
	pi.registerProvider("task-center-fixture", {
		api: "task-center-fixture-api",
		apiKey: "offline",
		baseUrl: "https://invalid.example",
		models: [
			{
				id: "deterministic",
				name: "Task center fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			const user = context.messages
				.filter((message) => message.role === "user")
				.at(-1);
			const prompt = user
				? typeof user.content === "string"
					? user.content
					: user.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n")
				: "";
			const ran = context.messages.some(
				(message) =>
					message.role === "toolResult" &&
					message.toolName === "task_center_probe",
			);
			const message: AssistantMessage = {
				role: "assistant",
				api: model.api,
				provider: model.provider,
				model: model.id,
				content: [],
				stopReason: "pending",
				timestamp: Date.now(),
				usage: {
					input: 2,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 3,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(async () => {
				if (child && prompt.includes("HOLD"))
					while (
						!existsSync(join(directory, "release")) &&
						!options?.signal?.aborted
					)
						await sleep(5);
				if (options?.signal?.aborted) {
					message.stopReason = "aborted";
					stream.push({ type: "error", reason: "aborted", error: message });
					stream.end();
					return;
				}
				const call = !child && !ran;
				message.content = call
					? [
							{
								type: "toolCall",
								id: "center",
								name: "task_center_probe",
								arguments: { inspectOnly: prompt.includes("inspect") },
							},
						]
					: [
							{
								type: "text",
								text: child ? `child result ${prompt}` : "parent done",
							},
						];
				message.stopReason = call ? "toolUse" : "stop";
				stream.push({ type: "start", partial: message });
				if (call) {
					stream.push({
						type: "toolcall_start",
						contentIndex: 0,
						partial: message,
					});
					stream.push({
						type: "toolcall_end",
						contentIndex: 0,
						toolCall: message.content[0] as Extract<
							AssistantMessage["content"][number],
							{ type: "toolCall" }
						>,
						partial: message,
					});
				}
				stream.push({ type: "done", reason: message.stopReason, message });
				stream.end();
			});
			return stream;
		},
	});
}
