import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { readGitStatus } from "../src/git.ts";

function repository(t: TestContext) {
	const cwd = mkdtempSync(join(tmpdir(), "open-tui-git-status-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	git("init", "-b", "main");
	git("config", "user.name", "Test");
	git("config", "user.email", "test@example.invalid");
	git("config", "commit.gpgsign", "false");
	git("config", "core.hooksPath", ".no-hooks");
	return { cwd, git };
}

test("Git keeps unborn branch names and reads diverged/gone upstreams", async (t) => {
	const { cwd, git } = repository(t);
	assert.equal((await readGitStatus(cwd)).branch, "main");
	git("commit", "--allow-empty", "-m", "base");
	git("branch", "upstream");
	git("branch", "--set-upstream-to=upstream", "main");
	git("commit", "--allow-empty", "-m", "local");
	assert.equal((await readGitStatus(cwd)).ahead, 1);
	git("checkout", "upstream");
	git("commit", "--allow-empty", "-m", "other");
	git("checkout", "main");
	const status = await readGitStatus(cwd);
	assert.equal(status.branch, "main");
	assert.equal(status.ahead, 1);
	assert.equal(status.behind, 1);
	git("branch", "-D", "upstream");
	assert.equal((await readGitStatus(cwd)).branch, "main");
});

test("Git counts stashes, respects count opt-out and reads detached commits/tags", async (t) => {
	const { cwd, git } = repository(t);
	writeFileSync(join(cwd, "file"), "initial");
	git("add", "file");
	git("commit", "-m", "initial");
	for (const text of ["first", "second"]) {
		writeFileSync(join(cwd, "file"), text);
		git("stash", "push", "-m", text);
	}
	assert.equal((await readGitStatus(cwd)).stashed, 2);
	assert.equal((await readGitStatus(cwd, { readCounts: false })).stashed, 0);
	git("tag", "v-test");
	git("checkout", "--detach");
	const nested = join(cwd, "nested");
	mkdirSync(nested);
	const status = await readGitStatus(nested, { readCommit: true, readTag: true });
	assert.equal(status.branch, undefined);
	assert.deepEqual(status.commit, { oid: git("rev-parse", "HEAD"), detached: true, tag: "v-test" });
	assert.equal((await readGitStatus(cwd, { readCommit: true })).commit?.tag, null);
});

test("Git handles untracked, modified, staged, renamed, deleted and conflicted entries", async (t) => {
	const { cwd, git } = repository(t);
	for (const name of ["modified", "staged", "renamed", "deleted", "conflict"]) writeFileSync(join(cwd, name), "base\n");
	git("add", ".");
	git("commit", "-m", "base");
	git("checkout", "-b", "other");
	writeFileSync(join(cwd, "conflict"), "other\n");
	git("commit", "-am", "other");
	git("checkout", "main");
	writeFileSync(join(cwd, "conflict"), "main\n");
	git("commit", "-am", "main");
	assert.throws(() => git("merge", "other"));
	writeFileSync(join(cwd, "untracked"), "new");
	writeFileSync(join(cwd, "modified"), "modified");
	writeFileSync(join(cwd, "staged"), "staged");
	git("add", "staged");
	git("mv", "renamed", "new-name");
	git("rm", "deleted");
	const status = await readGitStatus(cwd);
	for (const key of ["untracked", "modified", "staged", "renamed", "deleted", "conflicted"] as const) assert.equal(status[key], 1, key);
	const omitted = await readGitStatus(cwd, { readCounts: false });
	for (const key of ["untracked", "modified", "staged", "renamed", "deleted", "conflicted"] as const) assert.equal(omitted[key], 0, key);
});
