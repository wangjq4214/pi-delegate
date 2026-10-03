import { appendFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getCurrentTools,
	type TranscriptContext,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface PressureFixtureTask {
	id: string;
	finishAt?: number;
	holdToolsAt?: number[];
	batch?: boolean;
	fast?: boolean;
	reason?: "stop" | "length" | "error";
}
export interface PressureFixtureCall {
	task: PressureFixtureTask;
	background?: boolean;
	pressure?: {
		warning?: { afterSeconds?: number; afterTurns?: number };
		urgent?: { afterSeconds?: number; afterTurns?: number };
	};
}
export interface PressureFixtureRequest {
	calls: PressureFixtureCall[];
	holdAfterAck?: boolean;
}
export interface PressureTrace {
	type: string;
	at: number;
	completed: number;
	call?: number;
	id?: string;
	text?: string;
	reminders?: string[];
	tools?: { name: string; parameters: unknown }[];
	toolName?: string;
	parentToolCallId?: string;
	isError?: boolean;
	toolResults?: number;
	role?: string;
}

function textOf(
	content: TranscriptContext["messages"][number]["content"],
): string {
	return typeof content === "string"
		? content
		: content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
}

/** No HTTP implementation: the installed host runs real streams/tools against file gates. */
export default function pressureProvider(pi: ExtensionAPI): void {
	const directory = process.env.PRESSURE_FIXTURE_DIR;
	if (!directory)
		throw new Error("Missing isolated pressure fixture directory");
	const child = process.env.PI_DELEGATE_CHILD === "1";
	let completed = 0;
	let calls = 0;
	const trace = (
		type: string,
		fields: Omit<Partial<PressureTrace>, "type" | "at" | "completed"> = {},
	) => {
		appendFileSync(
			join(directory, `${process.pid}.trace.jsonl`),
			`${JSON.stringify({ type, at: Date.now(), completed, ...fields })}\n`,
		);
	};
	const mark = (name: string, value: unknown) => {
		const path = join(directory, `${process.pid}.${name}`);
		writeFileSync(`${path}.tmp`, JSON.stringify(value));
		renameSync(`${path}.tmp`, path);
	};
	const gate = (name: string, signal?: AbortSignal) =>
		new Promise<void>((resolve, reject) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: Error) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", abort);
				if (error) reject(error);
				else {
					trace("gate-open", { text: name });
					resolve();
				}
			};
			const abort = () => finish(new Error("fixture gate aborted"));
			const poll = () => {
				if (signal?.aborted) abort();
				else if (existsSync(join(directory, `${process.pid}.${name}-release`)))
					finish();
				else timer = setTimeout(poll, 10);
			};
			signal?.addEventListener("abort", abort, { once: true });
			trace("gate-ready", { text: name });
			poll();
		});
	pi.on("session_start", async (_event, ctx) => {
		mark("meta.json", {
			pid: process.pid,
			child,
			mode: ctx.mode,
			snapshot: process.env.PI_DELEGATE_SNAPSHOT,
		});
		trace("initializing");
		if (child && process.env.PRESSURE_HOLD_INIT === "1") await gate("init");
		trace("initialized");
	});
	pi.on("session_shutdown", () => {
		trace("shutdown");
		mark("closed", true);
	});
	pi.registerCommand("pressure-tree", {
		description: "Test-only real host navigation with an active pressured task",
		async handler(target, ctx) {
			await ctx.navigateTree(target, { summarize: false });
			pi.appendEntry("pressure-fixture:navigated", { target });
		},
	});
	pi.on("input", (event) => {
		if (event.text.startsWith("[pi-delegate pressure:"))
			trace("pressure-receipt", { text: event.text });
	});
	pi.on("agent_start", () => {
		trace("agent-start");
	});
	pi.on("agent_settled", () => {
		trace("settled");
	});
	pi.on("turn_end", (event) => {
		completed++;
		trace("turn-end", { toolResults: event.toolResults.length });
	});
	pi.on("message_start", (event) => {
		trace("message-start", { role: event.message.role });
	});
	pi.on("message_end", (event) => {
		trace("message-end", { role: event.message.role });
	});
	pi.on("tool_execution_end", (event) => {
		trace("tool-end", {
			toolName: event.toolName,
			parentToolCallId: event.parentToolCallId,
			isError: event.isError,
		});
	});
	pi.registerTool(
		defineTool({
			name: "pressure_step",
			label: "Pressure fixture step",
			description:
				"A deterministic held or immediate tool, deliberately usable after urgent pressure",
			parameters: Type.Object({ round: Type.Integer(), hold: Type.Boolean() }),
			async execute(_id, params, signal, update) {
				trace("tool-start", { call: params.round });
				update?.({
					content: [{ type: "text", text: "still working" }],
					details: undefined,
				});
				if (params.hold) await gate(`tool-${params.round}`, signal);
				return {
					content: [{ type: "text", text: `step:${params.round}` }],
					details: undefined,
				};
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "pressure_leaf",
			label: "Pressure fixture leaf",
			description: "An immediate nested tool",
			parameters: Type.Object({}),
			async execute() {
				return {
					content: [{ type: "text", text: "leaf" }],
					details: undefined,
				};
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "pressure_nested",
			label: "Pressure fixture nested batch",
			description:
				"Runs two real nested tools in parallel, without creating assistant turns",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _update, ctx) {
				const results = await Promise.all([
					ctx.executeTool("pressure_leaf", {}),
					ctx.executeTool("pressure_leaf", {}),
				]);
				return {
					content: [{ type: "text", text: "nested leaves completed" }],
					details: { errors: results.map((r) => r.isError) },
				};
			},
		}),
	);
	pi.registerProvider("pressure-fixture", {
		api: "pressure-fixture-api",
		apiKey: "local-fixture-only",
		baseUrl: "http://127.0.0.1:1/never-requested",
		models: [
			{
				id: "deterministic",
				name: "Local pressure fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
		],
		streamSimple(model, context, options) {
			const stream = createAssistantMessageEventStream();
			const call = calls++;
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
					cost: {
						input: 0.02,
						output: 0.01,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0.03,
					},
				},
			};
			let finished = false;
			let started = false;
			const start = () => {
				if (started) return;
				started = true;
				stream.push({ type: "start", partial: message });
			};
			const end = () => {
				finished = true;
				stream.end();
			};
			const respond = (
				text: string,
				reason: "stop" | "length" | "error" = "stop",
			) => {
				if (finished) return;
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
				message.stopReason = reason;
				if (reason === "error") {
					message.errorMessage = "pressure fixture model failure";
					stream.push({ type: "error", reason, error: message });
				} else stream.push({ type: "done", reason, message });
				end();
			};
			const invoke = (
				tools: { name: string; args: Record<string, unknown> }[],
			) => {
				start();
				message.content = tools.map((t, n) => ({
					type: "toolCall",
					id: `fixture-${call}-${n}`,
					name: t.name,
					arguments: JSON.parse(JSON.stringify(t.args)),
				}));
				for (const [contentIndex, toolCall] of message.content.entries()) {
					if (toolCall.type !== "toolCall") continue;
					stream.push({
						type: "toolcall_start",
						contentIndex,
						partial: message,
					});
					stream.push({
						type: "toolcall_end",
						contentIndex,
						toolCall,
						partial: message,
					});
				}
				message.stopReason = "toolUse";
				stream.push({ type: "done", reason: "toolUse", message });
				end();
			};
			void (async () => {
				try {
					// Preserve the original task even after steering adds newer user messages.
					const users = context.messages
						.filter((m) => m.role === "user")
						.map((m) => textOf(m.content));
					const reminders = users.filter((t) =>
						t.startsWith("[pi-delegate pressure:"),
					);
					if (child) {
						const root = users.find((t) => t.startsWith("Task:\n"));
						if (!root) throw new Error("Missing actual child task");
						const task: PressureFixtureTask = JSON.parse(
							root.slice(6).split("\n\nSupplementary context:")[0] ?? "",
						);
						trace("model", {
							id: task.id,
							call,
							reminders,
							tools: getCurrentTools(context.messages).map((t) => ({
								name: t.name,
								parameters: t.parameters,
							})),
						});
						start(); // The gate holds an actual unfinished assistant stream.
						if (!task.fast) await gate(`model-${call}`, options?.signal);
						if (call >= (task.finishAt ?? 6) || task.fast)
							respond(
								`REPORT:${task.id}: current findings; unfinished work and blockers disclosed.`,
								task.reason,
							);
						else {
							const tools: { name: string; args: Record<string, unknown> }[] = [
								{
									name: "pressure_step",
									args: {
										round: call,
										hold: task.holdToolsAt?.includes(call) ?? false,
									},
								},
							];
							if (task.batch && call === 0)
								tools.unshift(
									{ name: "pressure_step", args: { round: -1, hold: false } },
									{
										name: "pressure_nested",
										args: {},
									},
								);
							invoke(tools);
						}
					} else {
						const prompt = users.at(-1) ?? "";
						trace("parent-model", {
							call,
							text: prompt,
							tools: getCurrentTools(context.messages).map((t) => ({
								name: t.name,
								parameters: t.parameters,
							})),
						});
						let lastUser = -1;
						for (let i = 0; i < context.messages.length; i++)
							if (context.messages[i]?.role === "user") lastUser = i;
						const results = context.messages
							.slice(lastUser + 1)
							.filter((m) => m.role === "toolResult");
						if (prompt.startsWith("RUN ")) {
							const request: PressureFixtureRequest = JSON.parse(
								prompt.slice(4),
							);
							if (results.length === 0)
								invoke(
									request.calls.map((c) => ({
										name: "delegate",
										args: {
											task: JSON.stringify(c.task),
											background: c.background ?? false,
											pressure: c.pressure,
											context: "fixture-only",
										},
									})),
								);
							else {
								if (request.holdAfterAck)
									await gate("parent-after-ack", options?.signal);
								respond("PARENT_FINISHED");
							}
						} else if (prompt.startsWith("STATUS ") && results.length === 0)
							invoke([
								{ name: "delegate_status", args: { taskId: prompt.slice(7) } },
							]);
						else if (prompt.startsWith("CANCEL ") && results.length === 0)
							invoke([
								{ name: "delegate_cancel", args: { taskId: prompt.slice(7) } },
							]);
						else respond(`PARENT_SAW:${prompt}`);
					}
				} catch (error) {
					if (finished) return;
					message.stopReason = options?.signal?.aborted ? "aborted" : "error";
					message.errorMessage =
						error instanceof Error ? error.message : String(error);
					trace("provider-aborted", { call, text: message.errorMessage });
					stream.push({
						type: "error",
						reason: message.stopReason,
						error: message,
					});
					end();
				}
			})();
			return stream;
		},
	});
}
