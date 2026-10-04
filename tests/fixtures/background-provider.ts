import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Local-only provider: files gate model settlement, never timing thresholds. */
export default function backgroundProvider(pi: ExtensionAPI): void {
	const directory = process.env.BACKGROUND_FIXTURE_DIR;
	if (!directory)
		throw new Error("Missing isolated background fixture directory");
	const child = process.env.PI_DELEGATE_CHILD === "1";
	const mark = (name: string, value = "ready") =>
		writeFileSync(join(directory, `${process.pid}.${name}`), value);
	pi.on("session_start", (_event, ctx) => {
		mark(
			"json",
			JSON.stringify({
				pid: process.pid,
				child,
				mode: ctx.mode,
				snapshot: process.env.PI_DELEGATE_SNAPSHOT,
			}),
		);
	});
	pi.on("session_shutdown", () => {
		mark("closed");
	});
	pi.registerCommand("background-tree", {
		description: "Test-only real host tree navigation",
		async handler(target, ctx) {
			await ctx.navigateTree(target, { summarize: false });
			pi.appendEntry("background-fixture:navigated", { target });
		},
	});
	pi.registerTool(
		defineTool({
			name: "background_dialogs",
			label: "Background dialogs fixture",
			description: "Request all four modal UI kinds and record their refusal",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _update, ctx) {
				const values = [
					await ctx.ui.select("fixture select", ["yes"]),
					await ctx.ui.confirm("fixture confirm", "yes?"),
					await ctx.ui.input("fixture input"),
					await ctx.ui.editor("fixture editor", "prefill"),
				];
				mark("dialogs", JSON.stringify(values));
				return {
					content: [{ type: "text", text: JSON.stringify(values) }],
					details: undefined,
				};
			},
		}),
	);
	pi.registerProvider("background-fixture", {
		api: "background-fixture-api",
		apiKey: "local-fixture-only",
		baseUrl: "https://invalid.example",
		models: [
			{
				id: "deterministic",
				name: "Local gated background fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
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
			const textOf = (content: (typeof context.messages)[number]["content"]) =>
				typeof content === "string"
					? content
					: content
							.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join("\n");
			let lastUser = -1;
			for (let i = 0; i < context.messages.length; i++) {
				if (context.messages[i]?.role === "user") lastUser = i;
			}
			const user = context.messages[lastUser];
			const prompt = user ? textOf(user.content) : "";
			const result = context.messages
				.slice(lastUser + 1)
				.reverse()
				.find((m) => m.role === "toolResult");
			let started = false;
			const start = () => {
				if (started) return;
				started = true;
				stream.push({ type: "start", partial: message });
			};
			let done = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = () => {
				done = true;
				clearTimeout(timer);
				options?.signal?.removeEventListener("abort", abort);
				stream.end();
			};
			const abort = () => {
				if (done) return;
				mark("aborted");
				message.stopReason = "aborted";
				message.errorMessage = "local fixture aborted";
				stream.push({ type: "error", reason: "aborted", error: message });
				finish();
			};
			const respond = (text: string) => {
				start();
				message.content = [{ type: "text", text }];
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: text,
					partial: message,
				});
				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: text,
					partial: message,
				});
				message.stopReason = "stop";
				stream.push({ type: "done", reason: "stop", message });
				finish();
			};
			const call = (name: string, args: Record<string, string | boolean>) => {
				const toolCall = {
					type: "toolCall" as const,
					id: `fixture-${context.messages.length}`,
					name,
					arguments: args,
				};
				start();
				message.content = [toolCall];
				stream.push({
					type: "toolcall_start",
					contentIndex: 0,
					partial: message,
				});
				stream.push({
					type: "toolcall_end",
					contentIndex: 0,
					toolCall,
					partial: message,
				});
				message.stopReason = "toolUse";
				stream.push({ type: "done", reason: "toolUse", message });
				finish();
			};
			const gate = (name: string, next: () => void) => {
				mark(`${name}-ready`);
				const poll = () => {
					if (done) return;
					if (existsSync(join(directory, `${name}-release`))) next();
					else timer = setTimeout(poll, 10);
				};
				poll();
			};
			options?.signal?.addEventListener("abort", abort, { once: true });
			queueMicrotask(() => {
				if (options?.signal?.aborted) {
					abort();
					return;
				}
				if (child) {
					if (process.env.STATUS_FIXTURE_THINKING === "1") {
						start();
						message.content = [
							{ type: "thinking", thinking: "PRIVATE THINKING CONTENT" },
						];
						stream.push({
							type: "thinking_start",
							contentIndex: 0,
							partial: message,
						});
						stream.push({
							type: "thinking_delta",
							contentIndex: 0,
							delta: "PRIVATE THINKING CONTENT",
							partial: message,
						});
					}
					if (!result)
						gate("child", () => {
							if (prompt.includes("dialogs")) call("background_dialogs", {});
							else
								respond(
									`CHILD_RESULT:${prompt}\nTOOLS:${JSON.stringify(pi.getAllTools().map((t) => t.name))}`,
								);
						});
					else
						respond(`CHILD_RESULT:dialogs refused ${textOf(result.content)}`);
					return;
				}
				if (prompt.includes("[Background task ")) {
					// Echo exactly the provider-visible text, not session metadata.
					respond(`MODEL_SAW:${prompt}`);
				} else if (result?.role === "toolResult") {
					respond(
						`TOOL_OBSERVED:${JSON.stringify({ name: result.toolName, details: result.details, content: result.content })}`,
					);
				} else if (prompt.startsWith("START ")) {
					call("delegate", {
						task: prompt.slice(6),
						context: "explicit-only",
						background: true,
					});
				} else if (prompt.startsWith("STATUS ")) {
					call("delegate_status", { taskId: prompt.slice(7) });
				} else if (prompt.startsWith("CANCEL ")) {
					call("delegate_cancel", { taskId: prompt.slice(7) });
				} else if (prompt === "BUSY") {
					gate("parent", () => respond("PARENT_BUSY_FINISHED"));
				} else respond(`PARENT_REPLY:${prompt}`);
			});
			return stream;
		},
	});
}
