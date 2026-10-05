import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type JsonObject,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(pi: ExtensionAPI): void {
	let calls = 0;
	let startupConfiguration:
		| {
				model: { provider: string; id: string };
				thinkingLevel: string | undefined;
		  }
		| undefined;
	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.model)
			startupConfiguration = {
				model: { provider: ctx.model.provider, id: ctx.model.id },
				thinkingLevel: ctx.thinkingLevel,
			};
		const directory = process.env.FIXTURE_LOG_DIR;
		if (directory)
			writeFileSync(
				join(directory, `${process.pid}.onset`),
				JSON.stringify(startupConfiguration),
			);
	});
	pi.registerFlag("fixture-prefix", { type: "string", default: "default" });
	pi.registerTool(
		defineTool({
			name: "fixture_echo",
			label: "Fixture echo",
			description: "Echo a value with a configured prefix",
			exposure: "deferred",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id, params) {
				calls++;
				return {
					content: [
						{
							type: "text",
							text: `${pi.getFlag("fixture-prefix")}:${params.value}`,
						},
					],
					details: undefined,
				};
			},
		}),
	);
	pi.on("session_start", async () => {
		const directory = process.env.FIXTURE_LOG_DIR;
		if (directory)
			writeFileSync(
				join(directory, `${process.pid}.json`),
				JSON.stringify({
					pid: process.pid,
					child: process.env.PI_DELEGATE_CHILD === "1",
					snapshot: process.env.PI_DELEGATE_SNAPSHOT,
				}),
			);
		if (
			directory &&
			process.env.PI_DELEGATE_CHILD === "1" &&
			process.env.FIXTURE_HOLD_INIT === "1"
		) {
			writeFileSync(join(directory, `${process.pid}.pending`), "pending");
			while (!existsSync(join(directory, "release-init")))
				await new Promise((resolve) => setTimeout(resolve, 5));
		}
	});
	pi.on("session_shutdown", () => {
		const directory = process.env.FIXTURE_LOG_DIR;
		if (directory)
			writeFileSync(join(directory, `${process.pid}.closed`), "closed");
	});
	pi.registerCommand("fixture-inspect", {
		description: "Capture fixture parent state",
		handler: async (_args, ctx) => {
			pi.setActiveTools(
				pi.getActiveTools().filter((name) => name !== "fixture_echo"),
			);
			pi.appendEntry("fixture:state", {
				tools: pi.getAllTools(),
				active: pi.getActiveTools(),
				commands: pi.getCommands(),
				model: ctx.model,
				thinkingLevel: ctx.thinkingLevel,
				cwd: ctx.cwd,
				trusted: ctx.isProjectTrusted(),
			});
		},
	});
	const providerConfig: Parameters<ExtensionAPI["registerProvider"]>[1] = {
		api: "delegate-fixture-api",
		apiKey: "fixture-only",
		baseUrl: "https://invalid.example",
		models: [
			{
				id: "deterministic",
				name: "Deterministic fixture",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 8192,
			},
			...(process.env.PI_DELEGATE_CHILD === "1" &&
			process.env.FIXTURE_HIDE_MODEL === "1"
				? []
				: [
						{
							id: "reasoning/path:variant",
							name: "Reasoning exact fixture",
							reasoning: true,
							input: ["text" as const],
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							contextWindow: 128000,
							maxTokens: 8192,
						},
					]),
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
			queueMicrotask(() => {
				const users = context.messages.filter((item) => item.role === "user");
				const user = users[users.length - 1];
				const prompt = user
					? typeof user.content === "string"
						? user.content
						: user.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n")
					: "";
				const results = context.messages.filter(
					(item) => item.role === "toolResult",
				);
				const last = results[results.length - 1];
				const terminalError = (reason: "error" | "aborted", text: string) => {
					message.stopReason = reason;
					message.errorMessage = text;
					stream.push({ type: "error", reason, error: message });
					stream.end();
				};
				if (prompt.includes("hang") && !prompt.startsWith("DELEGATE ")) {
					options?.signal?.addEventListener(
						"abort",
						() => terminalError("aborted", "fixture aborted"),
						{ once: true },
					);
					return;
				}
				if (
					prompt.includes("fail-model") ||
					(process.env.PI_DELEGATE_CHILD === "1" &&
						prompt.includes("child-failure"))
				) {
					terminalError("error", "fixture model failure");
					return;
				}
				if (prompt.includes("abort-model")) {
					terminalError("aborted", "fixture model aborted");
					return;
				}
				stream.push({ type: "start", partial: message });
				const toolCall = (name: string, args: JsonObject) => {
					message.content = [
						{
							type: "toolCall",
							id: `call-${results.length}`,
							name,
							arguments: args,
						},
					];
					message.stopReason = "toolUse";
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
					stream.push({ type: "done", reason: "toolUse", message });
					stream.end();
				};
				if (prompt.startsWith("CONFIG ") && !last) {
					toolCall("delegate", JSON.parse(prompt.slice(7)));
					return;
				}
				if (prompt.startsWith("DELEGATE ") && !last) {
					toolCall("delegate", {
						task: prompt.slice(9),
						context: "explicit child context",
					});
					return;
				}
				if (
					prompt.includes("exercise-tools") &&
					!prompt.startsWith("DELEGATE ")
				) {
					if (!last) {
						toolCall("tool_search", { query: "fixture_echo" });
						return;
					}
					if (last.toolName === "tool_search") {
						toolCall("codemode", {
							code: "text(await tools.fixture_echo({value: 'payload'}));",
						});
						return;
					}
				}
				if (
					prompt.includes("exercise-mcp") &&
					!prompt.startsWith("DELEGATE ")
				) {
					if (!last) {
						toolCall("tool_search", { query: "mcp__fixture__echo" });
						return;
					}
					if (last.toolName === "tool_search") {
						toolCall("codemode", {
							code: "text(await tools.mcp__fixture__echo({value: 'payload'}));",
						});
						return;
					}
				}
				if (prompt.includes("exercise-read") && !last) {
					toolCall("read", { path: "workspace-proof.txt" });
					return;
				}
				const text =
					prompt.startsWith("DELEGATE ") && last
						? last.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n")
						: process.env.PI_DELEGATE_CHILD === "1" &&
								process.env.FIXTURE_FINAL_TEXT !== undefined
							? process.env.FIXTURE_FINAL_TEXT
							: JSON.stringify({
									pid: process.pid,
									cwd: process.cwd(),
									systemPrompt: context.messages.filter(
										(item) => item.role === "system",
									),
									startupConfiguration,
									calls,
									prefix: pi.getFlag("fixture-prefix"),
									active: pi.getActiveTools(),
									tools: pi.getAllTools().map((tool) => tool.name),
									prompt,
									userCount: users.length,
									lastResult: last?.content,
									child: process.env.PI_DELEGATE_CHILD === "1",
								});
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
				const reason = prompt.includes("length-model") ? "length" : "stop";
				message.stopReason = reason;
				stream.push({ type: "done", reason, message });
				stream.end();
			});
			return stream;
		},
	};
	pi.registerProvider("delegate-fixture", providerConfig);
	pi.registerProvider("delegate-fixture-other", providerConfig);
	pi.registerProvider("delegate-fixture-no-auth", {
		...providerConfig,
		apiKey: undefined,
	});
}
