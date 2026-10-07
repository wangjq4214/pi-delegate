import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2000;

export interface GitCommitInfo {
	oid: string | null;
	detached: boolean;
	tag: string | null;
}

export interface GitStatus {
	branch: string | undefined;
	ahead: number;
	behind: number;
	modified: number;
	untracked: number;
	staged: number;
	stashed: number;
	conflicted: number;
	renamed: number;
	deleted: number;
	commit: GitCommitInfo | null;
}

export function emptyGitStatus(): GitStatus {
	return {
		branch: undefined,
		ahead: 0,
		behind: 0,
		modified: 0,
		untracked: 0,
		staged: 0,
		stashed: 0,
		conflicted: 0,
		renamed: 0,
		deleted: 0,
		commit: null,
	};
}

async function gitExec(args: string[], cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: 1024 * 1024,
		});
		return stdout;
	} catch {
		return null;
	}
}

export async function readGitStatus(
	cwd: string,
	options: { readCommit?: boolean; readTag?: boolean; readCounts?: boolean } = {},
): Promise<GitStatus> {
	const stdout = await gitExec(
		["--no-optional-locks", "status", "--porcelain=v2", "--branch", "--show-stash"],
		cwd,
	);
	const status = emptyGitStatus();
	if (stdout === null) return status;
	let oid: string | null = null;
	let detached = false;
	for (const line of stdout.split("\n")) {
		if (line.startsWith("# branch.head ")) {
			const head = line.slice(14);
			detached = head === "(detached)";
			status.branch = detached ? undefined : head;
		} else if (line.startsWith("# branch.oid ")) {
			const value = line.slice(13);
			oid = value === "(initial)" ? null : value;
		} else if (line.startsWith("# branch.ab ")) {
			const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
			if (match) {
				status.ahead = Number(match[1]);
				status.behind = Number(match[2]);
			}
		} else if (options.readCounts !== false) {
			if (line.startsWith("# stash ")) status.stashed = Number(line.slice(8)) || 0;
			else if (line.startsWith("? ")) status.untracked++;
			else if (line.startsWith("u ")) status.conflicted++;
			else if (line.startsWith("1 ") || line.startsWith("2 ")) {
				const x = line[2];
				const y = line[3];
				// Preserve the exclusive renamed/deleted categories used by the footer.
				if (x === "R" || y === "R") status.renamed++;
				else if (x === "D" || y === "D") status.deleted++;
				else {
					if (x !== ".") status.staged++;
					if (y === "M") status.modified++;
				}
			}
		}
	}
	if (detached) {
		status.commit = { oid: options.readCommit ? oid : null, detached: true, tag: null };
		if (options.readCommit && options.readTag) {
			status.commit.tag = (await gitExec(["describe", "--tags", "--exact-match", "HEAD"], cwd))?.trim() || null;
		}
	}
	return status;
}
