import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { resolveCli } from "../src/delegate.ts";
import { RpcProcess } from "../src/rpc.ts";
import type { TaskDetails, TaskPage } from "../src/tasks.ts";

type Message = AgentSession["messages"][number];
interface Outcome {
	isError: boolean;
	result: {
		content: [{ type: "text"; text: string }];
		details: {
			taskId?: string;
			task?: TaskDetails;
			status?: string;
			result?: { status: string; taskId?: string };
			accounting?: string;
		};
		usage?: { totalTokens: number };
	};
}
interface Probe {
	active: TaskPage;
	pending: Outcome;
	cancel: Outcome;
	steer: Outcome;
	syncResult: Outcome;
	finalSync: Outcome;
	repeatedSync: Outcome;
	background: Outcome;
	backgroundResult: Outcome;
	queuedBefore: Outcome;
	queuedCancel: Outcome;
	queuedAfter: Outcome;
	finished: { result: { details: TaskPage } };
}

test("actual parent/child RPC discovers sync while pending, preserves background results, excludes child tools and clears scope", async () => {
	const directory = await mkdtemp(join(tmpdir(), "task-center-integration-"));
	const agentDir = join(directory, "agent");
	await mkdir(agentDir);
	await writeFile(
		join(agentDir, "settings.json"),
		JSON.stringify({
			compaction: { enabled: false },
			retry: { enabled: false },
			cacheWarming: "off",
			enableInstallTelemetry: false,
			enableAnalytics: false,
		}),
	);
	const parent = new RpcProcess(
		"node",
		[
			resolveCli(),
			"--mode",
			"rpc",
			"--offline",
			"--no-session",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--extension",
			fileURLToPath(new URL("../src/index.ts", import.meta.url)),
			"--extension",
			fileURLToPath(
				new URL("./fixtures/task-center-provider.ts", import.meta.url),
			),
			"--tools",
			"delegate,delegate_list,delegate_status,delegate_cancel,delegate_steer,task_center_probe",
			"--provider",
			"task-center-fixture",
			"--model",
			"deterministic",
		],
		{
			cwd: directory,
			env: {
				...process.env,
				FIXTURE_LOG_DIR: directory,
				PI_CODING_AGENT_DIR: agentDir,
				PI_OFFLINE: "1",
				PI_DELEGATE_CONCURRENCY: "2",
				PI_DELEGATE_CHILD: undefined,
				PI_DELEGATE_SNAPSHOT: undefined,
				PI_CODING_AGENT_SESSION_DIR: undefined,
			},
		},
	);
	const prompt = async (message: string) => {
		const settled = parent.waitForSettled();
		try {
			await parent.request("prompt", { message });
			await settled.promise;
		} finally {
			settled.dispose();
		}
	};
	try {
		await parent.request("get_state");
		await prompt("run task center");
		const report = JSON.parse(
			readFileSync(join(directory, "observed.json"), "utf8"),
		) as Probe;
		expect(report.active.total).toBe(2);
		expect(report.active.tasks.map((task) => task.label).sort()).toEqual([
			1, 2,
		]);
		expect(report.pending.result.details.task).toMatchObject({
			mode: "synchronous",
			status: "running",
			resultAvailable: false,
			controls: { cancel: false, steer: false },
			configuration: {
				requested: {
					model: { provider: "task-center-fixture", id: "deterministic" },
					thinkingLevel: "high",
				},
				effective: {
					model: { provider: "task-center-fixture", id: "deterministic" },
					thinkingLevel: "off",
				},
			},
			cwd: { selected: directory, effective: directory },
		});
		expect(report.pending.result.content[0].text).toContain("Task metadata:");
		expect(report.queuedBefore.result.details.task).toMatchObject({
			mode: "background",
			label: 3,
			status: "queued",
			elapsedSeconds: 0,
			turns: 0,
			cwd: { selected: directory },
			configuration: { requested: { thinkingLevel: "high" } },
			controls: { cancel: true, steer: false },
		});
		expect(report.queuedCancel.isError).toBe(true);
		for (const outcome of [report.queuedCancel, report.queuedAfter]) {
			expect(outcome.result).not.toHaveProperty("usage");
			expect(outcome.result.details.task).toMatchObject({
				status: "cancelled",
				resultAvailable: true,
				elapsedSeconds: 0,
				turns: 0,
				controls: { cancel: false, steer: false },
			});
			expect(outcome.result.details.task?.cwd).not.toHaveProperty("effective");
			expect(outcome.result.details.task?.configuration).not.toHaveProperty(
				"effective",
			);
		}
		expect(report.cancel.isError).toBe(true);
		expect(report.steer.isError).toBe(true);
		expect(report.syncResult.isError).toBe(false);
		expect(report.syncResult.result.details.status).toBe("completed");
		const syncId = report.pending.result.details.taskId;
		expect(report.syncResult.result.details.taskId).toBe(syncId);
		expect(report.syncResult.result.usage?.totalTokens).toBe(3);
		for (const outcome of [
			report.finalSync,
			report.repeatedSync,
			report.backgroundResult,
		]) {
			expect(outcome.result).not.toHaveProperty("usage");
			expect(outcome.result.details.task).toMatchObject({
				resultAvailable: true,
				status: "completed",
				turns: 1,
				usage: { totalTokens: 3 },
				controls: { cancel: false, steer: false },
			});
		}
		expect(report.finalSync.result.content[0].text).toContain(
			"child result Task:\nHOLD",
		);
		expect(report.backgroundResult.result.content[0].text).toContain(
			"child result Task:\nHOLD background",
		);
		expect(report.finished.result.details).toMatchObject({
			total: 3,
			nextOffset: 1,
		});
		const children = readdirSync(directory).filter((file) =>
			file.endsWith(".child"),
		);
		expect(children).toHaveLength(2);
		for (const file of children) {
			const child = JSON.parse(readFileSync(join(directory, file), "utf8")) as {
				tools: string[];
				commands: string[];
			};
			for (const name of [
				"delegate",
				"delegate_list",
				"delegate_status",
				"delegate_cancel",
				"delegate_steer",
			])
				expect(child.tools).not.toContain(name);
			expect(child.commands).not.toContain("delegates");
		}
		await parent.request("new_session");
		await prompt("inspect");
		const messages = (
			await parent.request<{ messages: Message[] }>("get_messages")
		).messages;
		const result = messages.find(
			(message) =>
				message.role === "toolResult" &&
				message.toolName === "task_center_probe",
		);
		expect(
			result?.role === "toolResult" ? result.details : undefined,
		).toMatchObject({ total: 0, tasks: [] });
	} finally {
		await writeFile(join(directory, "release"), "release");
		await parent.stop();
		await rm(directory, { recursive: true, force: true });
	}
}, 45000);
