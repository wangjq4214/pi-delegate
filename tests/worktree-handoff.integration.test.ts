import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { resolveCli, runDelegation } from "../src/delegate.ts";
import { captureInheritance } from "../src/inheritance.ts";
import { RpcProcess } from "../src/rpc.ts";
import {
	worktreeGit as git,
	type WorktreeHandoff,
	type WorktreeReport,
} from "./fixtures/worktree-provider.ts";

const entry = resolve("src/index.ts");
const provider = resolve("tests/fixtures/worktree-provider.ts");
interface ParentState {
	tools: ToolInfo[];
	active: string[];
	commands: ReturnType<ExtensionAPI["getCommands"]>;
	model: ExtensionContext["model"];
	thinkingLevel: ExtensionContext["thinkingLevel"];
	cwd: string;
	trusted: boolean;
}

function mainSnapshot(main: string) {
	return {
		head: git(main, "rev-parse", "HEAD"),
		branch: git(main, "branch", "--show-current"),
		status: git(main, "status", "--short"),
		index: git(main, "ls-files", "--stage"),
		staged: git(main, "diff", "--cached", "--binary"),
		unstaged: git(main, "diff", "--binary"),
		stash: git(main, "stash", "list"),
		files: [
			"first.txt",
			"second.txt",
			"failed.txt",
			"staged.txt",
			"main-only.txt",
		].map((path) => [path, readFileSync(join(main, path), "utf8")]),
	};
}

async function promptAndWait(parent: RpcProcess, message: string) {
	const settled = parent.waitForSettled();
	try {
		await parent.request("prompt", { message });
		await settled.promise;
	} finally {
		settled.dispose();
	}
}

// R6/R7 (and R8 ordering): the parent authors only baseline/dirty-main setup.
// All task writes and artifact creation happen in real Pi child tool execution.
// Deterministic provider selection is not a claim of autonomous model compliance.
test("real Pi RPC worktree handoff: child tools return reviewable added-file commits; dirty main unchanged; integrate/validate before cleanup and retain failed/unmerged work", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-worktree-handoff-"));
	const main = join(directory, "dirty main");
	const agent = join(directory, "agent");
	const logs = join(directory, "logs");
	const hooks = join(directory, "empty hooks");
	const integration = join(directory, "reviewed integration");
	const originalCwd = process.cwd();
	const deadline = new AbortController();
	const timer = setTimeout(() => deadline.abort(), 40_000);
	let parent: RpcProcess | undefined;
	let verified = false;
	try {
		for (const path of [main, agent, logs, hooks]) await mkdir(path);
		git(main, "init", "--initial-branch=main");
		git(main, "config", "user.name", "Worktree Fixture");
		git(main, "config", "user.email", "worktree@example.invalid");
		git(main, "config", "core.hooksPath", hooks);
		for (const name of ["first", "second", "failed", "staged"])
			await writeFile(join(main, `${name}.txt`), `baseline ${name}\n`);
		git(
			main,
			"add",
			"--",
			"first.txt",
			"second.txt",
			"failed.txt",
			"staged.txt",
		);
		git(main, "commit", "-m", "Explicit fixture baseline");
		const baseline = git(main, "rev-parse", "--verify", "HEAD^{commit}");
		expect(baseline).toMatch(/^[a-f0-9]{40}$/);
		await writeFile(
			join(main, "first.txt"),
			"dirty main must remain untouched\n",
		);
		await writeFile(
			join(main, "staged.txt"),
			"staged main must remain untouched\n",
		);
		git(main, "add", "--", "staged.txt");
		await writeFile(
			join(main, "main-only.txt"),
			"untracked main must not be copied\n",
		);
		const dirtyMain = mainSnapshot(main);
		const handoffs: WorktreeHandoff[] = ["first", "second", "failed"].map(
			(name) => ({
				workspace: join(directory, `task ${name}`),
				main,
				baseline,
				branch: `task-${name}`,
				modified: `${name}.txt`,
				added: `${name}-added.txt`,
				original: `baseline ${name}\n`,
				replacement: `child changed ${name}\n`,
				addition: `child added ${name}\n`,
				outcome: name === "failed" ? "fail-after-write" : "commit",
			}),
		);
		for (const handoff of handoffs) {
			git(
				main,
				"worktree",
				"add",
				"-b",
				handoff.branch,
				handoff.workspace,
				baseline,
			);
			expect(git(handoff.workspace, "rev-parse", "HEAD")).toBe(baseline);
			expect(
				readFileSync(join(handoff.workspace, handoff.modified), "utf8"),
			).toBe(handoff.original);
			expect(readFileSync(join(handoff.workspace, "staged.txt"), "utf8")).toBe(
				"baseline staged\n",
			);
			expect(existsSync(join(handoff.workspace, "main-only.txt"))).toBe(false);
		}
		expect(
			git(main, "worktree", "list", "--porcelain").match(/^worktree /gm),
		).toHaveLength(4);
		expect(mainSnapshot(main)).toEqual(dirtyMain);
		const args = [
			"--offline",
			"--no-session",
			"--no-approve",
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-context-files",
			"--extension",
			entry,
			"--extension",
			provider,
			"--tools",
			"read,write,delegate,worktree_artifact",
			"--provider",
			"worktree-fixture",
			"--model",
			"deterministic",
		];
		const env = {
			...process.env,
			PI_CODING_AGENT_DIR: agent,
			PI_OFFLINE: "1",
			WORKTREE_LOG_DIR: logs,
			PI_DELEGATE_CHILD: undefined,
			PI_DELEGATE_SNAPSHOT: undefined,
		};
		parent = new RpcProcess(
			"node",
			[resolveCli(), "--mode", "rpc", ...args],
			{ cwd: main, env },
			deadline.signal,
		);
		await promptAndWait(
			parent,
			"PARENT_HISTORY_ONLY: never copy this to a child",
		);
		await parent.request("prompt", { message: "/worktree-inspect" });
		const { entries } = await parent.request<{ entries: SessionEntry[] }>(
			"get_entries",
		);
		const captured = entries.find(
			(item) => item.type === "custom" && item.customType === "worktree:parent",
		);
		if (captured?.type !== "custom")
			throw new Error("Missing real parent snapshot");
		const state = captured.data as ParentState;
		expect(state.cwd).toBe(main);
		expect(
			state.tools.find((tool) => tool.name === "worktree_artifact")?.sourceInfo
				.path,
		).toBe(provider);
		const results = await Promise.all(
			handoffs.map((handoff) =>
				runDelegation({
					...captureInheritance(
						{
							getAllTools: () => state.tools,
							getActiveTools: () => state.active,
							getCommands: () => state.commands,
						},
						{ ...state, isProjectTrusted: () => state.trusted },
						entry,
						args,
						handoff.workspace,
					),
					cwd: handoff.workspace,
					env,
					signal: deadline.signal,
					task: "Modify only the two permitted task files using local tools. Return actual commit artifact and changed-file rationale, performed/omitted checks, blockers and unfinished work. Do not merge or remove any workspace.",
					context: `Use the explicit committed baseline, never dirty main content. You are authorized to stage only the named files and commit on the assigned task branch. Read the original baseline file before writing. Required checks: content equality and git diff --cached --check; report the unavailable full suite honestly. Workspace, branch, baseline, goal and allowed contents follow.\nWORKTREE_HANDOFF=${JSON.stringify(handoff)}`,
				}),
			),
		);
		expect(results.map((result) => result.details.cwd)).toEqual(
			handoffs.map((handoff) => handoff.workspace),
		);
		expect(results.map((result) => result.details.status)).toEqual([
			"completed",
			"completed",
			"failed",
		]);
		expect(
			new Set(results.map((result) => result.details.sessionId)).size,
		).toBe(3);
		const reports = results.slice(0, 2).map((result) => {
			expect(result.isError).toBe(false);
			// Read through the actual delegation return, never from a parent-authored report/log.
			return JSON.parse(result.content[0].text) as WorktreeReport;
		});
		expect(new Set(reports.map((report) => report.execution.pid)).size).toBe(2);
		for (const [index, report] of reports.entries()) {
			const handoff = handoffs[index];
			if (!handoff) throw new Error("Missing handoff");
			expect(report.workspace).toBe(handoff.workspace);
			expect(report.branch).toBe(handoff.branch);
			expect(report.baseline).toBe(baseline);
			expect(report.artifact.kind).toBe("commit");
			expect(report.execution.child).toBe(true);
			expect(report.execution.userCount).toBe(1);
			expect(
				JSON.parse(
					report.execution.prompt.split("WORKTREE_HANDOFF=")[1] ?? "null",
				),
			).toEqual(handoff);
			expect(report.execution.prompt).not.toContain("PARENT_HISTORY_ONLY");
			expect(JSON.stringify(report.execution.baselineRead)).toContain(
				handoff.original.trim(),
			);
			expect(report.execution.tools.sort()).toEqual(
				state.tools
					.map((tool) => tool.name)
					.filter((name) => !name.startsWith("delegate"))
					.sort(),
			);
			expect(report.execution.active.sort()).toEqual(
				state.active.filter((name) => !name.startsWith("delegate")).sort(),
			);
			expect(report.execution.toolResults).toEqual(
				["read", "write", "write", "worktree_artifact"].map((name) => ({
					name,
					isError: false,
				})),
			);
			expect(
				report.changedFiles
					.map(({ path, status }) => ({ path, status }))
					.sort((a, b) => a.path.localeCompare(b.path)),
			).toEqual(
				[
					{ path: handoff.added, status: "A" },
					{ path: handoff.modified, status: "M" },
				].sort((a, b) => a.path.localeCompare(b.path)),
			);
			expect(
				report.changedFiles.every((file) => file.rationale.length > 0),
			).toBe(true);
			expect(
				report.performedChecks.find(
					(check) => check.command === "git diff --cached --check",
				)?.result,
			).toBe("PASS: exit 0");
			expect(report.omittedChecks).toEqual([
				{
					command: "project full test suite",
					reason: "Minimal disposable repository has no project test runner",
				},
			]);
			expect(report.blockers).toEqual([]);
			expect(report.unfinishedWork).toEqual([]);
			// Parent reviews the actual returned commit, including new files and clean source status.
			const commit = report.artifact.commit;
			expect(git(handoff.workspace, "rev-parse", "HEAD")).toBe(commit);
			expect(git(main, "rev-parse", `${commit}^`)).toBe(baseline);
			expect(git(main, "show", "--stat", commit)).toContain(handoff.added);
			const patch = git(main, "diff", "--binary", baseline, commit);
			expect(patch).toContain("new file mode");
			expect(patch).toContain(`+${handoff.addition.trim()}`);
			expect(patch).toContain(`+${handoff.replacement.trim()}`);
			expect(
				git(main, "diff", "--name-only", baseline, commit).split("\n").sort(),
			).toEqual([handoff.added, handoff.modified].sort());
			expect(git(handoff.workspace, "status", "--short")).toBe("");
			expect(existsSync(handoff.workspace)).toBe(true);
			// Result collection has neither integrated nor removed a source worktree.
			expect(existsSync(join(main, handoff.added))).toBe(false);
		}
		expect(results[2]?.isError).toBe(true);
		expect(results[2]?.details.stopReason).toBe("error");
		expect(results[2]?.details.error).toContain(
			"Intentional worktree fixture failure after real writes; no final report",
		);
		expect(results[2]?.content[0].text).toContain("Delegation failed");
		expect(results[2]?.content[0].text).not.toContain('"artifact"');
		const failed = handoffs[2];
		const first = handoffs[0];
		const unmerged = handoffs[1];
		const reviewed = reports[0];
		if (!failed || !first || !unmerged || !reviewed)
			throw new Error("Missing workflow fixture");
		expect(git(failed.workspace, "rev-parse", "HEAD")).toBe(baseline);
		expect(git(failed.workspace, "status", "--short")).toContain(
			`?? ${failed.added}`,
		);
		expect(readFileSync(join(failed.workspace, failed.modified), "utf8")).toBe(
			failed.replacement,
		);
		expect(readFileSync(join(failed.workspace, failed.added), "utf8")).toBe(
			failed.addition,
		);
		// The runner has stopped each child and deleted only its initialization snapshot.
		const childLogs = readdirSync(logs).filter((name) =>
			name.endsWith(".json"),
		);
		expect(childLogs).toHaveLength(3);
		for (const file of childLogs) {
			const log = JSON.parse(readFileSync(join(logs, file), "utf8"));
			expect(handoffs.map((handoff) => handoff.workspace)).toContain(log.cwd);
			expect(existsSync(join(logs, `${log.pid}.closed`))).toBe(true);
			expect(existsSync(dirname(log.snapshot))).toBe(false);
			expect(existsSync(log.cwd)).toBe(true);
		}
		expect(mainSnapshot(main)).toEqual(dirtyMain);
		// Do not cherry-pick into dirty main: use a clean, explicitly selected destination.
		git(main, "worktree", "add", "-b", "integration", integration, baseline);
		expect(git(integration, "branch", "--show-current")).toBe("integration");
		expect(git(integration, "status", "--short")).toBe("");
		git(integration, "cherry-pick", reviewed.artifact.commit);
		// Independently validate combined destination content/diff, not just child's success claim.
		expect(readFileSync(join(integration, first.modified), "utf8")).toBe(
			first.replacement,
		);
		expect(readFileSync(join(integration, first.added), "utf8")).toBe(
			first.addition,
		);
		expect(readFileSync(join(integration, unmerged.modified), "utf8")).toBe(
			unmerged.original,
		);
		expect(existsSync(join(integration, unmerged.added))).toBe(false);
		expect(existsSync(join(integration, "main-only.txt"))).toBe(false);
		expect(git(integration, "diff", "--check", baseline, "HEAD")).toBe("");
		expect(git(integration, "diff", "--binary", baseline, "HEAD")).toBe(
			git(main, "diff", "--binary", baseline, reviewed.artifact.commit),
		);
		expect(git(integration, "status", "--short")).toBe("");
		expect(git(first.workspace, "status", "--short")).toBe("");
		// Only now is first's workspace eligible for non-force removal; branch/artifact retained.
		git(main, "worktree", "remove", first.workspace);
		expect(existsSync(first.workspace)).toBe(false);
		expect(git(main, "cat-file", "-t", reviewed.artifact.commit)).toBe(
			"commit",
		);
		expect(existsSync(unmerged.workspace)).toBe(true);
		expect(existsSync(failed.workspace)).toBe(true);
		expect(git(unmerged.workspace, "rev-parse", "HEAD")).toBe(
			reports[1]?.artifact.commit,
		);
		expect(git(main, "worktree", "list", "--porcelain")).toContain(
			git(failed.workspace, "rev-parse", "--show-toplevel"),
		);
		expect(mainSnapshot(main)).toEqual(dirtyMain);
		expect(process.cwd()).toBe(originalCwd);
		await parent.request("prompt", { message: "/worktree-inspect" });
		const finalEntries = await parent.request<{ entries: SessionEntry[] }>(
			"get_entries",
		);
		const finalState = finalEntries.entries
			.filter(
				(item) =>
					item.type === "custom" && item.customType === "worktree:parent",
			)
			.at(-1);
		expect(
			finalState?.type === "custom" && (finalState.data as ParentState).cwd,
		).toBe(main);
		verified = true;
	} finally {
		clearTimeout(timer);
		deadline.abort();
		await parent?.stop();
		// Disposable-test teardown AFTER retention/ordering assertions, not skill cleanup.
		// Unexpected failure retains the entire repository, partial edits and artifacts for diagnosis.
		if (verified) await rm(directory, { recursive: true, force: true });
		else
			console.error(`Worktree handoff test evidence retained at: ${directory}`);
	}
}, 60_000);
