import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type JsonObject,
	Type,
} from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface WorktreeHandoff {
	workspace: string;
	main: string;
	baseline: string;
	branch: string;
	modified: string;
	added: string;
	original: string;
	replacement: string;
	addition: string;
	outcome: "commit" | "fail-after-write";
}

export interface WorktreeReport {
	workspace: string;
	branch: string;
	baseline: string;
	artifact: { kind: "commit"; commit: string };
	changedFiles: { path: string; status: string; rationale: string }[];
	performedChecks: { command: string; result: string }[];
	omittedChecks: { command: string; reason: string }[];
	blockers: string[];
	unfinishedWork: string[];
	execution: {
		pid: number;
		child: boolean;
		userCount: number;
		prompt: string;
		tools: string[];
		active: string[];
		toolResults: { name: string; isError: boolean }[];
		baselineRead: string;
	};
}

// Argument arrays, no shell; suppress user Git config/hooks/signing and inherited
// Git routing variables. Every caller supplies a disposable repository's cwd.
export function worktreeGit(cwd: string, ...args: string[]): string {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
	);
	const result = spawnSync(
		"git",
		[
			"-C",
			cwd,
			"-c",
			"core.autocrlf=false",
			"-c",
			"core.quotepath=false",
			"-c",
			"commit.gpgSign=false",
			...args,
		],
		{
			encoding: "utf8",
			timeout: 5_000,
			windowsHide: true,
			env: {
				...env,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
				GIT_TERMINAL_PROMPT: "0",
			},
		},
	);
	if (result.status !== 0)
		throw new Error(
			`git ${args.join(" ")}: ${result.error?.message || result.stderr}`,
		);
	return result.stdout.trim();
}

function requireCondition(ok: boolean, message: string): void {
	if (!ok) throw new Error(message);
}

export default function worktreeFixture(pi: ExtensionAPI): void {
	pi.registerCommand("worktree-inspect", {
		description: "Capture the real parent's reconstructible registry and state",
		handler: async (_args, ctx) => {
			pi.appendEntry("worktree:parent", {
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
	pi.on("session_start", () => {
		if (process.env.PI_DELEGATE_CHILD !== "1") return;
		writeFileSync(
			join(process.env.WORKTREE_LOG_DIR as string, `${process.pid}.json`),
			JSON.stringify({
				pid: process.pid,
				cwd: process.cwd(),
				snapshot: process.env.PI_DELEGATE_SNAPSHOT,
			}),
		);
	});
	pi.on("session_shutdown", () => {
		if (process.env.PI_DELEGATE_CHILD === "1")
			writeFileSync(
				join(process.env.WORKTREE_LOG_DIR as string, `${process.pid}.closed`),
				"closed",
			);
	});
	pi.registerTool(
		defineTool({
			name: "worktree_artifact",
			label: "Worktree artifact",
			description:
				"Inspect and commit only explicitly authorized fixture task files; return observed artifact and check evidence",
			parameters: Type.Object({ handoff: Type.String() }),
			async execute(_id, params, signal, _update, ctx) {
				signal?.throwIfAborted();
				const handoff: WorktreeHandoff = JSON.parse(params.handoff);
				requireCondition(
					process.env.PI_DELEGATE_CHILD === "1",
					"Child-only artifact tool",
				);
				requireCondition(
					resolve(ctx.cwd) === resolve(handoff.workspace),
					"Wrong workspace",
				);
				requireCondition(
					resolve(ctx.cwd) !== resolve(handoff.main),
					"Must not modify main",
				);
				requireCondition(
					worktreeGit(ctx.cwd, "rev-parse", "HEAD") === handoff.baseline,
					"Wrong baseline",
				);
				requireCondition(
					worktreeGit(ctx.cwd, "branch", "--show-current") === handoff.branch,
					"Wrong task branch",
				);
				requireCondition(
					!existsSync(join(ctx.cwd, "main-only.txt")),
					"Dirty main was copied",
				);
				for (const [path, expected] of [
					[handoff.modified, handoff.replacement],
					[handoff.added, handoff.addition],
				])
					requireCondition(
						readFileSync(join(ctx.cwd, path), "utf8") === expected,
						`Content check failed: ${path}`,
					);
				worktreeGit(ctx.cwd, "add", "--", handoff.modified, handoff.added);
				const files = worktreeGit(ctx.cwd, "diff", "--cached", "--name-status")
					.split("\n")
					.map((line) => {
						const [status, path] = line.split("\t");
						return {
							status,
							path,
							rationale:
								status === "A"
									? "Added by child's built-in write"
									: "Updated baseline file by child's built-in write",
						};
					});
				requireCondition(
					JSON.stringify(files.map((file) => file.path).sort()) ===
						JSON.stringify([handoff.modified, handoff.added].sort()),
					"Unexpected staged scope",
				);
				worktreeGit(ctx.cwd, "diff", "--cached", "--check");
				const patch = worktreeGit(ctx.cwd, "diff", "--cached", "--binary");
				requireCondition(
					patch.includes("new file mode"),
					"Added file missing from artifact",
				);
				worktreeGit(ctx.cwd, "commit", "-m", `Fixture task ${handoff.branch}`);
				const report = {
					workspace: ctx.cwd,
					branch: worktreeGit(ctx.cwd, "branch", "--show-current"),
					baseline: handoff.baseline,
					artifact: {
						kind: "commit",
						commit: worktreeGit(ctx.cwd, "rev-parse", "HEAD"),
					},
					changedFiles: files,
					performedChecks: [
						{
							command: "git rev-parse HEAD / git branch --show-current",
							result:
								"PASS: explicit baseline and assigned branch before commit",
						},
						{
							command: "readFileSync task files",
							result: "PASS: both real write outputs match requested content",
						},
						{ command: "git diff --cached --check", result: "PASS: exit 0" },
						{
							command: "git diff --cached --binary",
							result: "PASS: staged artifact includes added file",
						},
					],
					omittedChecks: [
						{
							command: "project full test suite",
							reason:
								"Minimal disposable repository has no project test runner",
						},
					],
					blockers: [],
					unfinishedWork: [],
				};
				return {
					content: [{ type: "text", text: JSON.stringify(report) }],
					details: report,
				};
			},
		}),
	);
	pi.registerProvider("worktree-fixture", {
		api: "worktree-fixture-api",
		apiKey: "local-fixture-only",
		baseUrl: "https://invalid.example",
		models: [
			{
				id: "deterministic",
				name: "Deterministic local worktree fixture",
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
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			};
			queueMicrotask(() => {
				const fail = (error: unknown) => {
					message.stopReason = options?.signal?.aborted ? "aborted" : "error";
					message.errorMessage = String(error);
					stream.push({
						type: "error",
						reason: message.stopReason,
						error: message,
					});
					stream.end();
				};
				try {
					options?.signal?.throwIfAborted();
					const users = context.messages.filter((item) => item.role === "user");
					const user = users.at(-1);
					const prompt = !user
						? ""
						: typeof user.content === "string"
							? user.content
							: user.content
									.filter((block) => block.type === "text")
									.map((block) => block.text)
									.join("\n");
					const results = context.messages.filter(
						(item) => item.role === "toolResult",
					);
					const last = results.at(-1);
					if (last?.isError)
						throw new Error(`Real child tool failed: ${JSON.stringify(last)}`);
					stream.push({ type: "start", partial: message });
					const call = (name: string, args: JsonObject) => {
						const block = {
							type: "toolCall" as const,
							id: `worktree-${results.length}`,
							name,
							arguments: args,
						};
						message.content = [block];
						message.stopReason = "toolUse";
						stream.push({
							type: "toolcall_start",
							contentIndex: 0,
							partial: message,
						});
						stream.push({
							type: "toolcall_end",
							contentIndex: 0,
							toolCall: block,
							partial: message,
						});
						stream.push({ type: "done", reason: "toolUse", message });
						stream.end();
					};
					let answer = "parent fixture";
					if (process.env.PI_DELEGATE_CHILD === "1") {
						const encoded = prompt.split("WORKTREE_HANDOFF=")[1];
						if (!encoded) throw new Error("Missing self-contained handoff");
						const handoff: WorktreeHandoff = JSON.parse(encoded);
						if (results.length === 0)
							return call("read", { path: handoff.modified });
						if (results.length === 1) {
							requireCondition(
								JSON.stringify(last?.content).includes(handoff.original.trim()),
								"Baseline read did not match explicit handoff",
							);
							return call("write", {
								path: handoff.modified,
								content: handoff.replacement,
							});
						}
						if (results.length === 2)
							return call("write", {
								path: handoff.added,
								content: handoff.addition,
							});
						if (handoff.outcome === "fail-after-write")
							throw new Error(
								"Intentional worktree fixture failure after real writes; no final report",
							);
						if (results.length === 3)
							return call("worktree_artifact", { handoff: encoded });
						requireCondition(
							last?.toolName === "worktree_artifact",
							"Missing actual artifact tool result",
						);
						const text =
							last?.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join("\n") ?? "";
						answer = JSON.stringify({
							...JSON.parse(text),
							execution: {
								pid: process.pid,
								child: true,
								userCount: users.length,
								prompt,
								tools: pi.getAllTools().map((tool) => tool.name),
								active: pi.getActiveTools(),
								toolResults: results.map((result) => ({
									name: result.toolName,
									isError: result.isError,
								})),
								baselineRead: JSON.stringify(results[0]?.content),
							},
						});
					}
					message.content = [{ type: "text", text: answer }];
					message.stopReason = "stop";
					stream.push({
						type: "text_start",
						contentIndex: 0,
						partial: message,
					});
					stream.push({
						type: "text_delta",
						contentIndex: 0,
						delta: answer,
						partial: message,
					});
					stream.push({
						type: "text_end",
						contentIndex: 0,
						content: answer,
						partial: message,
					});
					stream.push({ type: "done", reason: "stop", message });
					stream.end();
				} catch (error) {
					fail(error);
				}
			});
			return stream;
		},
	});
}
