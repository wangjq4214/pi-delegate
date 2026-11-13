import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getCurrentTools,
	type ToolCall,
	type TranscriptContext,
	Type,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Explicitly loaded as an extension, not a *.test.ts fixture. No HTTP transport.
export default function fixture(pi: ExtensionAPI): void {
	const logs = process.env.GOAL_HOST_LOGS;
	if (!logs) throw new Error("Missing isolated GOAL_HOST_LOGS");
	const child = process.env.PI_DELEGATE_CHILD === "1";
	let calls = 0;
	let lastDraft = false;
	const trace = (type: string, data: object = {}) =>
		appendFileSync(
			join(logs, `${process.pid}.jsonl`),
			`${JSON.stringify({ type, pid: process.pid, child, ...data })}\n`,
		);
	pi.on("session_start", (_e, ctx) =>
		trace("start", {
			mode: ctx.mode,
			cwd: ctx.cwd,
			snapshot: process.env.PI_DELEGATE_SNAPSHOT,
			all: pi.getAllTools().map((t) => t.name),
			active: pi.getActiveTools(),
			commands: pi.getCommands().map((c) => c.name),
		}),
	);
	pi.on("session_shutdown", () => trace("shutdown"));
	pi.on("agent_before_settle", (e) => {
		trace("boundary", {
			draft: lastDraft,
			outcome: e.outcome,
			canContinue: e.context.canContinue,
			continue: e.continue,
			entries: e.entries,
		});
	});
	// Registered after goal: its continuation is already retained by emitBoundary.
	pi.on("agent_before_settle", async (e) => {
		if (
			child ||
			lastDraft ||
			process.env.GOAL_HOST_SCENARIO !== "boundary-pause" ||
			!e.continue
		)
			return;
		trace("boundary-held", { continue: e.continue, entries: e.entries });
		const deadline = Date.now() + 25000;
		while (!existsSync(join(logs, "boundary.release"))) {
			if (Date.now() > deadline) throw new Error("Boundary release timed out");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		trace("boundary-released", { continue: e.continue });
	});
	pi.on("agent_settled", (e) =>
		trace("settled", { aborted: e.aborted, draft: lastDraft }),
	);
	pi.on("agent_before_settle", async (e) => {
		if (
			child ||
			!lastDraft ||
			!e.continue ||
			process.env.GOAL_HOST_SCENARIO !== "creation-boundary-hold"
		)
			return;
		trace("creation-boundary-held");
		const deadline = Date.now() + 25000;
		while (!existsSync(join(logs, "creation-boundary.release"))) {
			if (Date.now() > deadline)
				throw new Error("Creation boundary release timed out");
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		trace("creation-boundary-released");
	});
	pi.on("tool_execution_end", (e) =>
		trace("tool-end", {
			name: e.toolName,
			isError: e.isError,
			result: e.result,
		}),
	);
	pi.registerCommand("host-tree", {
		description: "Test-only native navigation",
		async handler(target, ctx) {
			try {
				await ctx.navigateTree(target, { summarize: false });
				trace("navigated");
			} catch (error) {
				trace("navigation-rejected", { error: String(error) });
			}
		},
	});
	pi.registerCommand("host-reload", {
		description: "Test-only native reload",
		async handler(_args, ctx) {
			await ctx.reload();
		},
	});
	pi.registerTool({
		name: "host_evidence",
		label: "Fixture evidence",
		description: "Read or create the fixture artifact in the actual child cwd",
		parameters: Type.Object({ write: Type.Boolean() }),
		async execute(_id, args, _signal, _update, ctx) {
			if (args.write)
				writeFileSync(
					join(ctx.cwd, "artifact.txt"),
					"goal artifact verified\n",
				);
			const actual = readFileSync(join(ctx.cwd, "artifact.txt"), "utf8");
			trace("evidence", { actual, write: args.write });
			return { content: [{ type: "text", text: actual }], details: undefined };
		},
	});
	pi.registerProvider("goal-host-fixture", {
		api: "goal-host-local",
		apiKey: "local-only",
		baseUrl: "http://127.0.0.1:1/never-used",
		models: [
			{
				id: "deterministic",
				name: "Goal host local fixture",
				reasoning: false,
				input: ["text"],
				contextWindow: 128000,
				maxTokens: 8192,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
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
				timestamp: Date.now(),
				content: [],
				stopReason: "pending",
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
			const textOf = (m: TranscriptContext["messages"][number]): string =>
				typeof m.content === "string"
					? m.content
					: (m.content
							?.filter((b) => b.type === "text")
							.map((b) => b.text)
							.join("\n") ?? "");
			const invoke = (name: string, args: ToolCall["arguments"]) => {
				message.content = [
					{ type: "toolCall", id: `host-${call}`, name, arguments: args },
				];
				stream.push({
					type: "toolcall_start",
					contentIndex: 0,
					partial: message,
				});
				stream.push({
					type: "toolcall_end",
					contentIndex: 0,
					toolCall: message.content[0] as ToolCall,
					partial: message,
				});
				message.stopReason = "toolUse";
				if (
					!child &&
					name === "goal_propose" &&
					process.env.GOAL_HOST_SCENARIO === "mixed-creation"
				) {
					const sibling: ToolCall = {
						type: "toolCall",
						id: `host-${call}-status`,
						name: "goal_status",
						arguments: {},
					};
					message.content.push(sibling);
					stream.push({
						type: "toolcall_start",
						contentIndex: 1,
						partial: message,
					});
					stream.push({
						type: "toolcall_end",
						contentIndex: 1,
						toolCall: sibling,
						partial: message,
					});
				}
				stream.push({ type: "done", reason: "toolUse", message });
				stream.end();
			};
			const respond = (value: string) => {
				message.content = [{ type: "text", text: value }];
				stream.push({ type: "text_start", contentIndex: 0, partial: message });
				stream.push({
					type: "text_delta",
					contentIndex: 0,
					delta: value,
					partial: message,
				});
				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: value,
					partial: message,
				});
				message.stopReason = "stop";
				stream.push({ type: "done", reason: "stop", message });
				stream.end();
			};
			void (async () => {
				try {
					stream.push({ type: "start", partial: message });
					const users = context.messages
						.filter((m) => m.role === "user")
						.map(textOf);
					const results = context.messages.filter(
						(m) => m.role === "toolResult",
					);
					const draftContext = context.messages
						.map(textOf)
						.filter((value) =>
							value.startsWith("Goal creation discussion only:"),
						)
						.at(-1);
					lastDraft = Boolean(draftContext);
					trace("model", {
						call,
						draft: lastDraft,
						draftId: draftContext?.match(/Draft ID: ([^\n]+)/)?.[1],
						users,
						tools: getCurrentTools(context.messages).map((t) => t.name),
						results: results.map((m) => ({
							name: m.toolName,
							error: m.isError,
							content: m.content,
							details: m.details,
						})),
					});
					if (child) {
						const task = users.find((u) => u.startsWith("Task:\n")) ?? "";
						const reviewer = task.includes("Independently assess this goal");
						trace("child-task", { task, reviewer });
						if (
							task.includes("HOLD") ||
							(reviewer && process.env.GOAL_HOST_SCENARIO === "review-hold")
						) {
							trace("held");
							await new Promise<void>((resolve, reject) => {
								const signal = options?.signal;
								const abort = () => {
									clearInterval(timer);
									signal?.removeEventListener("abort", abort);
									trace("aborted");
									reject(new Error("fixture child aborted"));
								};
								const timer = setInterval(() => {
									if (existsSync(join(logs, `${process.pid}.release`))) {
										clearInterval(timer);
										signal?.removeEventListener("abort", abort);
										resolve();
									}
								}, 10);
								signal?.addEventListener("abort", abort, { once: true });
								if (signal?.aborted) abort();
							});
						}
						if (task.includes("ORDINARY")) {
							respond("ordinary result");
							return;
						}
						if (call === 0)
							invoke("tool_search", {
								query:
									"goal_propose goal_status goal_plan goal_work goal_accept goal_review goal_reinspect goal_block",
								limit: 50,
							});
						else if (call === 1)
							invoke("codemode", {
								code: 'const names = ["goal_propose","goal_status","goal_plan","goal_work","goal_accept","goal_review","goal_reinspect","goal_block"]; text({ registered: ALL_TOOLS.filter(t => names.includes(t.name)), search: await searchTools("goal", {limit:100}), attempts: await Promise.all(names.map(async n => { try { await tools[n]({}); return {name:n, reachable:true}; } catch(e) { return {name:n, reachable:false, error:String(e)}; } })) });',
							});
						else if (call === 2) invoke("host_evidence", { write: !reviewer });
						else {
							const evidence = readFileSync(
								join(process.cwd(), "artifact.txt"),
								"utf8",
							);
							respond(
								reviewer
									? `Fresh reviewer inspected artifact.txt: ${evidence.trim()}.\n${process.env.GOAL_HOST_REJECT === "1" ? "<disapproved/>" : "<approved/>"}`
									: "Worker completed artifact.txt; parent must assess evidence.",
							);
						}
						return;
					}
					const user = users.at(-1) ?? "";
					if (user.startsWith("CALL ")) {
						const request = JSON.parse(user.slice(5));
						let lastUser = -1;
						context.messages.forEach((m, i) => {
							if (m.role === "user") lastUser = i;
						});
						if (
							!context.messages
								.slice(lastUser + 1)
								.some((m) => m.role === "toolResult")
						)
							invoke(request.name, request.args ?? {});
						else respond("call finished");
						return;
					}
					if (draftContext) {
						const supplied = users
							.filter(
								(value) => !value.startsWith("Goal creation discussion only:"),
							)
							.map(
								(value) =>
									value.match(/Allow at most (\d+) goal dispatches\./)?.[1],
							)
							.filter(Boolean)
							.at(-1);
						if (!supplied)
							respond(
								"What positive integer allowance should this goal use? Clarification is ordinary chat; nothing has started.",
							);
						else {
							const proposed = {
								draftId: draftContext.match(/Draft ID: ([^\n]+)/)?.[1] ?? "",
								objective: "Create and independently verify artifact.txt",
								criteria: ["artifact.txt contains goal artifact verified"],
								allowance: Number(supplied),
							};
							if (process.env.GOAL_HOST_SCENARIO === "codemode-creation")
								invoke("codemode", {
									code: `text(await tools.goal_propose(${JSON.stringify(proposed)}));`,
								});
							else invoke("goal_propose", proposed);
						}
						return;
					}
					if (
						!users.some(
							(u) =>
								u.startsWith("Coordinate goal ") ||
								u.startsWith("Goal coordinator checkpoint."),
						)
					) {
						respond("Ordinary fixture parent response");
						return;
					}
					if (process.env.GOAL_HOST_SCENARIO === "idle") {
						respond("Coordinator checkpoint without further action");
						return;
					}
					const latest = (name: string) =>
						results.filter((m) => m.toolName === name).at(-1);
					if (!latest("goal_plan"))
						invoke("goal_plan", {
							items: [
								{
									id: "artifact",
									title: "Produce fixture artifact",
									acceptance: "artifact.txt contains goal artifact verified",
								},
							],
							checkpoint: "Bounded fixture plan",
						});
					else if (!latest("goal_work"))
						invoke("goal_work", {
							itemId: "artifact",
							task:
								process.env.GOAL_HOST_SCENARIO === "hold"
									? "HOLD create fixture artifact"
									: "Create fixture artifact",
							context: "Only artifact.txt is authorized. Never operate a goal.",
						});
					else if (!latest("goal_accept")) {
						if (
							["boundary", "boundary-pause"].includes(
								process.env.GOAL_HOST_SCENARIO ?? "",
							) &&
							!existsSync(join(logs, "boundary-returned"))
						) {
							writeFileSync(join(logs, "boundary-returned"), "1");
							respond("Inspect worker before the next actionable boundary");
						} else {
							const actual = readFileSync(
								join(process.cwd(), "artifact.txt"),
								"utf8",
							);
							if (actual !== "goal artifact verified\n")
								throw new Error("Parent evidence failed");
							trace("parent-evidence", { actual });
							invoke("goal_accept", {
								itemId: "artifact",
								evidence: ["Parent read artifact.txt: goal artifact verified"],
								artifacts: ["artifact.txt"],
							});
						}
					} else if (!latest("goal_review")) invoke("goal_review", {});
					else
						respond(
							"Coordinator finished; only independent approval can complete the goal",
						);
				} catch (error) {
					message.stopReason = options?.signal?.aborted ? "aborted" : "error";
					message.errorMessage = String(error);
					trace("provider-error", { error: String(error) });
					stream.push({
						type: "error",
						reason: message.stopReason,
						error: message,
					});
					stream.end();
				}
			})();
			return stream;
		},
	});
}
