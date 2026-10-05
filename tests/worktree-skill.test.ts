import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	DefaultPackageManager,
	loadSkills,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { runDelegation } from "../src/delegate.ts";

const root = process.cwd();
const skillPath = resolve("skills/delegate-worktree/SKILL.md");
const fixture = resolve("tests/fixtures/failure-rpc.mjs");

test("Pi package discovery loads the bundled worktree skill without a personal copy", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-package-"));
	const agent = join(directory, "agent");
	await mkdir(agent);
	try {
		const settingsManager = SettingsManager.inMemory({ packages: [root] });
		const manager = new DefaultPackageManager({
			cwd: directory,
			agentDir: agent,
			settingsManager,
		});
		const paths = await manager.resolve();
		expect(
			paths.extensions.some(
				(resource) =>
					resource.path === resolve("dist/index.js") && resource.enabled,
			),
		).toBe(true);
		const result = loadSkills({
			cwd: directory,
			agentDir: agent,
			skillPaths: paths.skills
				.filter(
					(resource) =>
						resource.enabled && resource.metadata.packageRoot === root,
				)
				.map((resource) => resource.path),
			includeDefaults: false,
		});
		expect(result.diagnostics).toEqual([]);
		expect(result.skills).toHaveLength(1);
		expect(result.skills[0]?.name).toBe("delegate-worktree");
		expect(result.skills[0]?.filePath).toBe(skillPath);
		const instructions = readFileSync(skillPath, "utf8");
		for (const required of [
			"delegate.cwd",
			"uncommitted",
			"baseline",
			"newly added files",
			"Checks performed",
			"parent",
			"unmerged",
			"sandbox",
		])
			expect(instructions).toContain(required);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

function git(cwd: string, ...args: string[]): string {
	const result = spawnSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		},
	});
	if (result.status !== 0)
		throw new Error(result.stderr || result.error?.message || "git failed");
	return result.stdout.trim();
}

test("skill workflow: explicit baseline, parallel worktrees, added-file artifact, review/integration before cleanup, failed work retained", async () => {
	const directory = await mkdtemp(join(tmpdir(), "delegate-worktree-"));
	const main = join(directory, "main");
	const first = join(directory, "task one");
	const failed = join(directory, "task two");
	await mkdir(main);
	try {
		git(main, "init");
		git(main, "config", "user.name", "Fixture");
		git(main, "config", "user.email", "fixture@example.invalid");
		await writeFile(join(main, "baseline.txt"), "baseline");
		git(main, "add", "baseline.txt");
		git(main, "commit", "-m", "baseline");
		const baseline = git(main, "rev-parse", "--verify", "HEAD^{commit}");
		await writeFile(join(main, "baseline.txt"), "dirty-main");
		await writeFile(join(main, "untracked.txt"), "main-only");
		const status = git(main, "status", "--short");
		for (const [branch, cwd] of [
			["task-one", first],
			["task-two", failed],
		] as const) {
			git(main, "worktree", "add", "-b", branch, cwd, baseline);
			expect(git(cwd, "rev-parse", "HEAD")).toBe(baseline);
			expect(readFileSync(join(cwd, "baseline.txt"), "utf8")).toBe("baseline");
			expect(existsSync(join(cwd, "untracked.txt"))).toBe(false);
		}
		// Fixture-authored task changes must survive runner cleanup in both outcomes.
		await writeFile(join(first, "added.txt"), "reviewable task change");
		await writeFile(join(failed, "partial.txt"), "unfinished");
		const reports = await Promise.all(
			[first, failed].map((cwd, index) =>
				runDelegation({
					cwd,
					task: `Workspace: ${cwd}; baseline: ${baseline}; return artifact, changed files, performed/omitted checks and remaining work`,
					args: [],
					snapshot: { version: 1, tools: [], active: [] },
					cliPath: fixture,
					env: {
						FAILURE_SCENARIO: index === 0 ? "usage-completed" : "usage-exit",
					},
				}),
			),
		);
		expect(reports.map((report) => report.details.cwd)).toEqual([
			first,
			failed,
		]);
		expect(reports[1]?.details.status).toBe("failed");
		// Simulate the authorized child artifact handoff; fixture transport does not author Git changes.
		git(first, "add", "added.txt");
		const patch = git(first, "diff", "--cached", "--binary");
		expect(patch).toContain("new file mode");
		expect(patch).toContain("reviewable task change");
		git(first, "commit", "-m", "task artifact");
		const commit = git(first, "rev-parse", "HEAD");
		expect(git(main, "diff", "--binary", baseline, commit)).toContain(
			"added.txt",
		);
		expect(git(main, "status", "--short")).toBe(status);
		expect(readFileSync(join(main, "baseline.txt"), "utf8")).toBe("dirty-main");
		// Integrate into a clean temporary destination: never handle the dirty main implicitly.
		const integration = join(directory, "integration");
		git(main, "worktree", "add", "-b", "integration", integration, baseline);
		git(integration, "cherry-pick", commit);
		expect(readFileSync(join(integration, "added.txt"), "utf8")).toBe(
			"reviewable task change",
		);
		expect(git(integration, "status", "--short")).toBe("");
		git(main, "worktree", "remove", first);
		expect(existsSync(first)).toBe(false);
		expect(existsSync(failed)).toBe(true);
		expect(readFileSync(join(failed, "partial.txt"), "utf8")).toBe(
			"unfinished",
		);
		expect(git(main, "status", "--short")).toBe(status);
	} finally {
		// Test-fixture teardown, not the skill's cleanup policy.
		await rm(directory, { recursive: true, force: true });
	}
}, 15_000);
