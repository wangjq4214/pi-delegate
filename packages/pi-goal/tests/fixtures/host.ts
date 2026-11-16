import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcProcess } from "../../../pi-delegate/src/rpc.ts";
import type { GoalState } from "../../src/model.ts";

// RPC envelopes and fixture traces are heterogeneous; durable goal state stays typed.
// biome-ignore lint/suspicious/noExplicitAny: test-only inspection of native host protocol envelopes
export type HostRecord = Record<string, any>;

export function required<T>(
	value: T | undefined,
	label = "host observation",
): T {
	if (value === undefined) throw new Error(`Missing ${label}`);
	return value;
}

export const root = fileURLToPath(new URL("../../../../", import.meta.url));
const goal = join(root, "packages/pi-goal");
export const names = [
	"goal_propose",
	"goal_status",
	"goal_plan",
	"goal_work",
	"goal_accept",
	"goal_review",
	"goal_reinspect",
	"goal_block",
];
export interface Options {
	built?: boolean;
	goalFirst?: boolean;
	/** Route pending goal tools through a public nested-tool observation probe. */
	progress?: boolean;
	cleanupHold?: boolean;
	scenario?:
		| "complete"
		| "mixed-creation"
		| "codemode-creation"
		| "creation-boundary-hold"
		| "boundary"
		| "boundary-pause"
		| "idle"
		| "hold"
		| "review-hold";
	reject?: boolean;
	defaultRoot?: boolean;
	noDelegate?: boolean;
	confirmation?: "Start" | "Cancel" | "dismiss" | "hold";
}
export async function eventually<T>(
	observe: () => T | Promise<T>,
	accept: (v: T) => boolean,
	label: string,
): Promise<T> {
	const deadline = Date.now() + 25000;
	for (;;) {
		const value = await observe();
		if (accept(value)) return value;
		if (Date.now() > deadline)
			throw new Error(`Timed out: ${label}; last=${JSON.stringify(value)}`);
		await Bun.sleep(20);
	}
}
export class Host {
	readonly events: HostRecord[] = [];
	readonly logs: string;
	readonly cwd: string;
	readonly agentDir: string;
	parent!: RpcProcess;
	readonly confirmations: {
		title: string;
		options: string[];
		answer(value?: string): void;
	}[] = [];
	constructor(
		readonly temp: string,
		readonly options: Options,
	) {
		this.logs = join(temp, "logs");
		this.cwd = join(temp, "project");
		this.agentDir = options.defaultRoot
			? join(temp, "home", ".pi", "agent")
			: join(temp, "global-agent");
	}
	async launch() {
		const pinned = join(goal, "node_modules/@earendil-works/pi-coding-agent");
		expect(
			JSON.parse(readFileSync(join(pinned, "package.json"), "utf8")).version,
		).toBe("1.1.0");
		const entry = this.options.built ? "dist/index.js" : "src/index.ts";
		const extensions = [
			join(goal, entry),
			...(this.options.noDelegate
				? []
				: [
						join(
							root,
							"packages/pi-delegate",
							this.options.built ? "dist/index.js" : "src/index.ts",
						),
					]),
		];
		if (!this.options.goalFirst) extensions.reverse();
		for (const path of extensions)
			if (!existsSync(path))
				throw new Error(`Parent build prerequisite missing: ${path}`);
		const api = this.options.built ? "host-api-built.ts" : "host-api-source.ts";
		this.parent = new RpcProcess(
			"node",
			[
				join(pinned, "dist/cli.js"),
				"--mode",
				"rpc",
				"--offline",
				"--no-session",
				"--no-approve",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				...extensions.flatMap((p) => ["--extension", p]),
				"--extension",
				join(goal, "tests/fixtures/host-provider.ts"),
				"--extension",
				join(goal, "tests/fixtures", api),
				"--extension",
				"builtin:codemode",
				"--extension",
				"builtin:tool-search",
				"--tools",
				[
					...names,
					"delegate",
					"delegate_list",
					"delegate_wait",
					"delegate_status",
					"delegate_cancel",
					"host_api",
					"host_evidence",
					"codemode",
					"tool_search",
				].join(","),
				"--provider",
				"goal-host-fixture",
				"--model",
				"deterministic",
			],
			{
				cwd: this.cwd,
				env: {
					...process.env,
					HOME: join(this.temp, "home"),
					USERPROFILE: join(this.temp, "home"),
					PI_CODING_AGENT_DIR: this.options.defaultRoot
						? undefined
						: this.agentDir,
					PI_CODING_AGENT_SESSION_DIR: join(this.temp, "sessions-override"),
					PI_PACKAGE_DIR: undefined,
					PI_OFFLINE: "1",
					PI_SKIP_VERSION_CHECK: "1",
					PI_TELEMETRY: "0",
					GOAL_HOST_LOGS: this.logs,
					GOAL_HOST_SCENARIO: this.options.scenario ?? "complete",
					GOAL_HOST_PROGRESS: this.options.progress ? "1" : "0",
					GOAL_HOST_CLEANUP_HOLD: this.options.cleanupHold ? "1" : "0",
					GOAL_HOST_REJECT: this.options.reject ? "1" : "0",
					PI_DELEGATE_CHILD: undefined,
					PI_DELEGATE_SNAPSHOT: undefined,
				},
			},
			undefined,
			async (request) => {
				if (
					request.method !== "select" ||
					!request.title?.startsWith("Start this goal?")
				)
					return undefined;
				return new Promise((resolve) => {
					const answer = (value?: string) =>
						resolve(
							value === undefined
								? {
										type: "extension_ui_response",
										id: request.id,
										cancelled: true,
									}
								: { type: "extension_ui_response", id: request.id, value },
						);
					this.confirmations.push({
						title: request.title ?? "",
						options: request.options ?? [],
						answer,
					});
					if (this.options.confirmation !== "hold")
						answer(
							this.options.confirmation === "dismiss"
								? undefined
								: (this.options.confirmation ?? "Start"),
						);
				});
			},
		);
		this.parent.subscribe((e) => this.events.push(e));
		try {
			await this.parent.request("get_state");
		} catch (error) {
			throw new Error(
				`${error}; startup diagnostics=${JSON.stringify(this.parent.diagnostics())}`,
			);
		}
	}
	trace(pid = this.parent.child.pid ?? 0): HostRecord[] {
		const path = join(this.logs, `${pid}.jsonl`);
		return existsSync(path)
			? readFileSync(path, "utf8")
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
			: [];
	}
	children(): HostRecord[] {
		return readdirSync(this.logs)
			.filter((p) => p.endsWith(".jsonl"))
			.flatMap((p) =>
				this.trace(Number(p.split(".")[0])).filter(
					(e) => e.type === "start" && e.child,
				),
			);
	}
	async prompt(message: string, settle = true) {
		const waiter = this.parent.waitForSettled();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await this.parent.request("prompt", { message });
			if (settle)
				await Promise.race([
					waiter.promise,
					new Promise<never>((_resolve, reject) => {
						timer = setTimeout(
							() =>
								reject(
									new Error(
										`No settlement for ${message}: ${JSON.stringify(this.parent.diagnostics())}; trace=${JSON.stringify(this.trace().slice(-8))}`,
									),
								),
							30000,
						);
					}),
				]);
		} finally {
			clearTimeout(timer);
			waiter.dispose();
		}
	}
	async call(name: string, args: object = {}): Promise<HostRecord> {
		await this.prompt(`CALL ${JSON.stringify({ name, args })}`);
		const { messages } = await this.parent.request<{ messages: HostRecord[] }>(
			"get_messages",
		);
		const result = messages
			.filter((m) => m.role === "toolResult" && m.toolName === name)
			.at(-1);
		if (!result)
			throw new Error(
				`No ${name} result; ${JSON.stringify(messages)}; diagnostics=${JSON.stringify(this.parent.diagnostics())}`,
			);
		return result;
	}
	async start(allowance: number, settle = true) {
		await this.prompt(
			`/goal Create and independently verify artifact.txt; acceptance: artifact.txt contains goal artifact verified. Allow at most ${allowance} goal dispatches.`,
			false,
		);
		await eventually(
			async () => {
				try {
					const state = this.state();
					const parent = await this.parent.request<{ isStreaming: boolean }>(
						"get_state",
					);
					return Boolean(
						state.run &&
							(!settle || (state.status !== "active" && !parent.isStreaming)),
					);
				} catch {
					return false;
				}
			},
			Boolean,
			"confirmed goal activates and reaches the requested boundary",
		);
	}
	journalPath(): string {
		const goals = join(this.agentDir, "goals");
		const files = existsSync(goals)
			? readdirSync(goals).filter((p) => p.endsWith(".jsonl"))
			: [];
		if (files.length !== 1)
			throw new Error(
				`Expected one global goal journal, got ${files}; trace=${JSON.stringify(this.trace())}; events=${JSON.stringify(this.events.filter((e) => e.type === "extension_ui_request" || e.type === "extension_error"))}; diagnostics=${JSON.stringify(this.parent.diagnostics())}`,
			);
		return join(goals, files[0] ?? "");
	}
	journal(): HostRecord[] {
		return readFileSync(this.journalPath(), "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
	}
	state(): GoalState {
		return required(this.journal().at(-1), "goal checkpoint").state;
	}
	async stop() {
		await this.parent?.stop();
	}
	async cleaned() {
		await eventually(
			() =>
				this.children().filter((c) => {
					try {
						process.kill(c.pid, 0);
						return true;
					} catch {
						return existsSync(dirname(c.snapshot));
					}
				}),
			(v) => v.length === 0,
			"all actual children exited and inheritance snapshots removed",
		);
	}
}
export async function withHost(
	options: Options,
	action: (host: Host) => Promise<void>,
) {
	const temp = await mkdtemp(join(tmpdir(), "pi-goal-host-"));
	const host = new Host(temp, options);
	try {
		await Promise.all([
			mkdir(host.logs),
			mkdir(host.cwd),
			mkdir(host.agentDir, { recursive: true }),
		]);
		await writeFile(
			join(host.agentDir, "settings.json"),
			JSON.stringify({
				compaction: { enabled: false },
				retry: { enabled: false },
				cacheWarming: "off",
				enableInstallTelemetry: false,
				enableAnalytics: false,
			}),
		);
		await host.launch();
		await action(host);
		expect(host.parent.diagnostics().extensionErrors ?? []).toEqual([]);
		expect(existsSync(join(host.cwd, ".pi"))).toBe(false);
	} finally {
		try {
			await host.stop();
			await host.cleaned();
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	}
}
