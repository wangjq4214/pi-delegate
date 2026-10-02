import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	createSyntheticSourceInfo,
	type ExtensionAPI,
	type ExtensionContext,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import {
	CHILD_ENV,
	captureInheritance,
	snapshotTool,
	validateChild,
} from "../src/inheritance.ts";

const entry = resolve("src/index.ts");
const source = resolve("tests/fixtures/provider.ts");
const tool = (
	name: string,
	path = `builtin:${name}`,
	exposure: ToolInfo["exposure"] = "direct",
): ToolInfo => ({
	name,
	description: name,
	parameters: Type.Object({}),
	exposure,
	sourceInfo: createSyntheticSourceInfo(path, { source: "test" }),
});
const ctx = {
	cwd: process.cwd(),
	model: undefined,
	thinkingLevel: "off",
	isProjectTrusted: () => false,
} as Pick<
	ExtensionContext,
	"cwd" | "model" | "thinkingLevel" | "isProjectTrusted"
>;

function api(tools: ToolInfo[], active: string[]) {
	let enabled = [...active];
	return {
		getAllTools: () => tools,
		getActiveTools: () => enabled,
		getCommands: () => [],
		setActiveTools: (names: string[]) => {
			enabled = names;
		},
	};
}

test("reloads tool and command extensions, retains deferred registry and strips parent session/prompt", () => {
	const parent = {
		...api(
			[
				tool("read"),
				tool("delegate", entry),
				tool("optional", source, "deferred"),
			],
			["read", "delegate"],
		),
		getCommands: () => [
			{
				name: "hook-command",
				source: "extension" as const,
				sourceInfo: createSyntheticSourceInfo(source, { source: "test" }),
			},
		],
	};
	const result = captureInheritance(parent, ctx, entry, [
		"--no-extensions",
		"--extension",
		source,
		"--session",
		"private-session",
		"--fixture-prefix",
		"configured",
		"parent secret",
	]);
	expect(result.snapshot.active).toEqual(["read"]);
	expect(result.snapshot.tools.map((item) => item.name)).toEqual([
		"read",
		"optional",
	]);
	expect(result.args).toContain("read,optional");
	expect(result.args).toContain("--no-extensions");
	expect(result.args).toContain("--no-approve");
	expect(result.args.filter((item) => item === source)).toHaveLength(1);
	expect(result.args).toContain("--fixture-prefix");
	expect(result.args).toContain("configured");
	expect(result.args).not.toContain("private-session");
	expect(result.args).not.toContain("parent secret");
});

test("explicit hook-only extensions are replayed even without tool metadata", () => {
	const result = captureInheritance(api([tool("read")], ["read"]), ctx, entry, [
		"--extension",
		source,
	]);
	expect(result.args).toContain(source);
});

test("rejects runtime-only tools rather than silently dropping them", () => {
	expect(() =>
		captureInheritance(
			api([tool("remote", "<sdk:remote>")], ["remote"]),
			ctx,
			entry,
			[],
		),
	).toThrow("runtime-only source");
	const builtin = captureInheritance(
		api([tool("custom", "builtin:llama.cpp")], ["custom"]),
		ctx,
		entry,
		[],
	);
	expect(builtin.args).toContain("builtin:llama.cpp");
});

test("validates exposure/schema and restores only the active subset", () => {
	const tools = [tool("read"), tool("optional", source, "deferred")];
	const child = api(tools, ["read", "optional"]);
	validateChild(child, {
		version: 1,
		tools: tools.map(snapshotTool),
		active: ["read"],
	});
	expect(child.getActiveTools()).toEqual(["read"]);
	expect(() =>
		validateChild(
			api(
				[
					tool("read"),
					{ ...tools[1], parameters: Type.Object({ changed: Type.String() }) },
				],
				["read"],
			),
			{ version: 1, tools: tools.map(snapshotTool), active: ["read"] },
		),
	).toThrow("optional");
	expect(() =>
		validateChild(api([tool("read")], ["read"]), {
			version: 1,
			tools: tools.map(snapshotTool),
			active: ["read"],
		}),
	).toThrow("optional");
	expect(() =>
		validateChild(api([tool("read"), tool("optional", source)], ["read"]), {
			version: 1,
			tools: tools.map(snapshotTool),
			active: ["read"],
		}),
	).toThrow("optional");
});

test("child registration excludes delegate entirely, not just its activation", () => {
	const previous = process.env[CHILD_ENV];
	try {
		for (const child of [false, true]) {
			if (child) process.env[CHILD_ENV] = "1";
			else delete process.env[CHILD_ENV];
			const tools: string[] = [];
			const commands: string[] = [];
			extension({
				registerTool: (definition: { name: string }) =>
					tools.push(definition.name),
				registerCommand: (name: string) => commands.push(name),
				on: () => () => {},
			} as unknown as ExtensionAPI);
			expect(tools).toEqual(child ? [] : ["delegate"]);
			expect(commands).toEqual(child ? ["pi-delegate-init"] : []);
		}
	} finally {
		if (previous === undefined) delete process.env[CHILD_ENV];
		else process.env[CHILD_ENV] = previous;
	}
});
