import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	parseArgs,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";

export const DELEGATE_TOOL = "delegate";
export const DELEGATION_TOOLS = [
	DELEGATE_TOOL,
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

export function captureInheritance(
	pi: Pick<ExtensionAPI, "getAllTools" | "getActiveTools" | "getCommands">,
	ctx: Pick<
		ExtensionContext,
		"cwd" | "model" | "thinkingLevel" | "isProjectTrusted"
	>,
	entryPath: string,
	argv: string[] = process.argv.slice(2),
): { args: string[]; snapshot: InheritanceSnapshot } {
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
	for (const path of parsed.extensions ?? []) addSource(path, "extension");
	for (const tool of tools)
		addSource(tool.sourceInfo.path, `tool ${tool.name}`);
	for (const command of pi.getCommands()) {
		if (command.source === "extension")
			addSource(command.sourceInfo.path, `command ${command.name}`);
	}
	paths.add(entryPath);

	const args = [
		"--no-session",
		ctx.isProjectTrusted() ? "--approve" : "--no-approve",
	];
	if (parsed.noExtensions) args.push("--no-extensions");
	for (const path of paths) args.push("--extension", path);
	// Names here are a registration allowlist, not just the active subset. Child initialization
	// restores the active subset after session_start (including MCP discovery) has completed.
	if (tools.length)
		args.push("--tools", tools.map((tool) => tool.name).join(","));
	else args.push("--no-tools");
	args.push("--exclude-tools", DELEGATION_TOOLS.join(","));
	if (ctx.model)
		args.push("--provider", ctx.model.provider, "--model", ctx.model.id);
	if (ctx.thinkingLevel) args.push("--thinking", ctx.thinkingLevel);
	if (parsed.offline) args.push("--offline");
	if (parsed.noContextFiles) args.push("--no-context-files");
	if (parsed.noSkills) args.push("--no-skills");
	if (parsed.noPromptTemplates) args.push("--no-prompt-templates");
	for (const path of parsed.skills ?? []) args.push("--skill", path);
	for (const path of parsed.promptTemplates ?? [])
		args.push("--prompt-template", path);
	for (const [name, value] of parsed.unknownFlags) {
		args.push(`--${name}`);
		if (typeof value === "string") args.push(value);
	}
	return {
		args,
		snapshot: {
			version: 1,
			tools: tools.map(snapshotTool),
			active: pi
				.getActiveTools()
				.filter((name) => !DELEGATION_TOOLS.includes(name)),
		},
	};
}
