import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ExtensionAPI,
	type ExtensionContext,
	parseArgs,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";

import type { TaskConfiguration } from "./configuration.ts";
export const DELEGATE_TOOL = "delegate";
export const DELEGATION_TOOLS = [
	DELEGATE_TOOL,
	"delegate_list",
	"delegate_status",
	"delegate_cancel",
	"delegate_steer",
];
export const CHILD_ENV = "PI_DELEGATE_CHILD";
export const SNAPSHOT_ENV = "PI_DELEGATE_SNAPSHOT";
export const INIT_COMMAND = "pi-delegate-init";
export const INIT_ENTRY = "pi-delegate:init";

export interface ToolSnapshot {
	name: string;
	fingerprint: string;
}
export interface InheritanceSnapshot {
	version: 1;
	tools: ToolSnapshot[];
	active: string[];
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export function snapshotTool(tool: ToolInfo): ToolSnapshot {
	// Remove schema functions/symbols before making a stable cross-process comparison.
	const data = JSON.parse(
		JSON.stringify({
			parameters: tool.parameters,
			exposure: tool.exposure,
			namespace: tool.namespace,
		}),
	);
	return { name: tool.name, fingerprint: canonical(data) };
}

export function validateChild(
	pi: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "setActiveTools">,
	snapshot: InheritanceSnapshot,
): void {
	const tools = pi.getAllTools();
	if (tools.some((tool) => DELEGATION_TOOLS.includes(tool.name))) {
		throw new Error("Delegation must not be registered in a child agent");
	}
	const actual = new Map(tools.map((tool) => [tool.name, snapshotTool(tool)]));
	for (const expected of snapshot.tools) {
		const tool = actual.get(expected.name);
		if (!tool || tool.fingerprint !== expected.fingerprint) {
			throw new Error(
				`Unable to reinitialize inherited tool: ${expected.name}`,
			);
		}
	}
	const expectedNames = new Set(snapshot.tools.map((tool) => tool.name));
	for (const tool of tools) {
		if (!expectedNames.has(tool.name)) {
			throw new Error(`Unexpected child tool: ${tool.name}`);
		}
	}
	pi.setActiveTools(snapshot.active);
	if (
		canonical([...pi.getActiveTools()].sort()) !==
		canonical([...snapshot.active].sort())
	) {
		throw new Error("Unable to restore inherited tool activation state");
	}
}

// Pi resolves CLI resources before selecting the session/runtime cwd. Capture this
// at module load so later session changes cannot rebase the original argv.
const startupCwd = process.cwd();

function isCliPackageSource(path: string): boolean {
	// Matches the non-local prefixes in the host's utils/paths.isLocalPath.
	return /^(npm:|git:|github:|http:|https:|ssh:|builtin:)/.test(path.trim());
}

function resolveCliResource(path: string): string {
	if (isCliPackageSource(path)) return path;
	if (path.startsWith("file://")) return fileURLToPath(path);
	if (path === "~") return homedir();
	if (
		path.startsWith("~/") ||
		(process.platform === "win32" && path.startsWith("~\\"))
	)
		return resolve(homedir(), path.slice(2));
	// Pi also accepts Git Bash/MSYS, WSL and Cygwin drive paths on Windows.
	if (process.platform === "win32" && !path.includes("\\")) {
		const drive = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
		if (drive) return resolve(`${drive[1].toUpperCase()}:\\${drive[2] ?? ""}`);
	}
	return resolve(startupCwd, path);
}

export function captureInheritance(
	pi: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "getCommands">,
	ctx: Pick<
		ExtensionContext,
		"cwd" | "model" | "thinkingLevel" | "isProjectTrusted"
	>,
	entryPath: string,
	argv: string[] = process.argv.slice(2),
	childCwd: string = ctx.cwd,
): {
	args: string[];
	snapshot: InheritanceSnapshot;
	requestedConfiguration?: TaskConfiguration;
} {
	const parsed = parseArgs(argv);
	const tools = pi
		.getAllTools()
		.filter((tool) => !DELEGATION_TOOLS.includes(tool.name));
	const paths = new Set<string>();
	const addSource = (path: string, owner: string) => {
		if (path.startsWith("builtin:")) {
			// Built-in tools need no extension path; built-in extensions do.
			if (
				![
					"builtin:read",
					"builtin:bash",
					"builtin:edit",
					"builtin:write",
					"builtin:grep",
					"builtin:find",
					"builtin:ls",
					"builtin:powershell",
				].includes(path)
			) {
				paths.add(path);
			}
			return;
		}
		if (path.startsWith("<")) {
			throw new Error(
				`Cannot reinitialize ${owner}: runtime-only source ${path}`,
			);
		}
		const absolute = isAbsolute(path) ? path : resolve(ctx.cwd, path);
		if (!existsSync(absolute))
			throw new Error(`Cannot reload ${owner}: ${absolute}`);
		paths.add(absolute);
	};
	for (const path of parsed.extensions ?? []) {
		// CLI package sources are host-managed, unlike observed runtime sources:
		// keep their source/ref intact and let Pi resolve/install them again.
		if (isCliPackageSource(path)) paths.add(path);
		else
			addSource(
				path.startsWith("<") ? path : resolveCliResource(path),
				"extension",
			);
	}
	for (const tool of tools)
		addSource(tool.sourceInfo.path, `tool ${tool.name}`);
	for (const command of pi.getCommands()) {
		if (command.source === "extension")
			addSource(command.sourceInfo.path, `command ${command.name}`);
	}
	paths.add(entryPath);

	const args = ["--no-session"];
	// A parent-directory trust decision does not authorize a different project.
	// Explicit CLI overrides still have their native per-run meaning.
	const trust =
		resolve(childCwd) === resolve(ctx.cwd)
			? ctx.isProjectTrusted()
			: parsed.projectTrustOverride;
	if (trust !== undefined) args.push(trust ? "--approve" : "--no-approve");
	if (parsed.noExtensions) args.push("--no-extensions");
	for (const path of paths) args.push("--extension", path);
	// Names here are a registration allowlist, not just the active subset. Child initialization
	// restores the active subset after session_start (including MCP discovery) has completed.
	if (tools.length)
		args.push("--tools", tools.map((tool) => tool.name).join(","));
	else args.push("--no-tools");
	args.push("--exclude-tools", DELEGATION_TOOLS.join(","));
	// Model IDs are not CLI patterns: the shared runner selects and verifies via exact RPC.
	if (parsed.offline) args.push("--offline");
	if (parsed.noContextFiles) args.push("--no-context-files");
	if (parsed.noSkills) args.push("--no-skills");
	if (parsed.noPromptTemplates) args.push("--no-prompt-templates");
	for (const path of parsed.skills ?? [])
		args.push("--skill", resolveCliResource(path));
	for (const path of parsed.promptTemplates ?? [])
		args.push("--prompt-template", resolveCliResource(path));
	for (const [name, value] of parsed.unknownFlags) {
		// A separate token starting with - or @ would become an option/file input.
		args.push(typeof value === "string" ? `--${name}=${value}` : `--${name}`);
	}
	return {
		args,
		...(ctx.model && ctx.thinkingLevel !== undefined
			? {
					requestedConfiguration: {
						model: { provider: ctx.model.provider, id: ctx.model.id },
						thinkingLevel: ctx.thinkingLevel,
					},
				}
			: {}),
		snapshot: {
			version: 1,
			tools: tools.map(snapshotTool),
			active: pi
				.getActiveTools()
				.filter((name) => !DELEGATION_TOOLS.includes(name)),
		},
	};
}
