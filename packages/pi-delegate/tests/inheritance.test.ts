import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Type } from "@earendil-works/pi-ai";
import {
	createSyntheticSourceInfo,
	type ExtensionAPI,
	type ExtensionContext,
	parseArgs,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import {
	CHILD_ENV,
	captureInheritance,
	DELEGATION_TOOLS,
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
				tool("delegate_status", entry),
				tool("delegate_cancel", entry),
				tool("delegate_steer", entry),
				tool("optional", source, "deferred"),
			],
			["read", ...DELEGATION_TOOLS],
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
	expect(result.args).toContain("--fixture-prefix=configured");
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

for (const value of [
	"-negative",
	"--no-extensions",
	"@attachment",
	"",
	"a=b",
	"two words",
]) {
	test(`extension string flag round-trips without option/file interpretation: ${JSON.stringify(value)}`, () => {
		const result = captureInheritance(api([], []), ctx, entry, [
			`--fixture-value=${value}`,
			"--fixture-enabled",
		]);
		const replayed = parseArgs(result.args);
		expect(replayed.unknownFlags).toEqual(
			new Map<string, string | boolean>([
				["fixture-value", value],
				["fixture-enabled", true],
			]),
		);
		expect(replayed.fileArgs).toEqual([]);
		expect(replayed.messages).toEqual([]);
		expect(replayed.diagnostics).toEqual([]);
		expect(replayed.noExtensions).toBeUndefined();
	});
}

test("CLI file URLs and home paths reload hook-only extensions and deduplicate observed sources", () => {
	for (const [path, target] of [
		[pathToFileURL(source).href, source],
		["~/", homedir()],
	]) {
		const hookOnly = captureInheritance(api([], []), ctx, entry, ["-e", path]);
		expect(parseArgs(hookOnly.args).extensions).toEqual([target, entry]);
		const observed = captureInheritance(
			api([tool("optional", target)], []),
			ctx,
			entry,
			["-e", path],
		);
		expect(parseArgs(observed.args).extensions).toEqual([target, entry]);
	}
});

for (const source of [
	"npm:@example/hooks@1.2.3",
	"git:github.com/example/hooks@v1",
	"github:example/hooks",
	"https://github.com/example/hooks.git",
	"ssh://git@example.com/example/hooks.git",
]) {
	test(`CLI hook-only package source remains host-resolvable: ${source}`, () => {
		const result = captureInheritance(api([], []), ctx, entry, [
			"--no-extensions",
			"-e",
			source,
		]);
		const replayed = parseArgs(result.args);
		expect(replayed.extensions).toEqual([source, entry]);
		expect(replayed.noExtensions).toBe(true);
	});
}

test("original relative CLI resources use startup cwd, not the session cwd", () => {
	const sessionCtx = { ...ctx, cwd: resolve("tests") };
	const result = captureInheritance(
		api([tool("optional", "fixtures/provider.ts")], []),
		sessionCtx,
		entry,
		[
			"-e",
			"./tests/fixtures/provider.ts",
			"--skill",
			"./tests/fixtures/skill",
			"--prompt-template",
			"./tests/fixtures/prompt.md",
			"--no-skills",
			"--no-prompt-templates",
		],
	);
	const replayed = parseArgs(result.args);
	// The CLI and runtime-relative source refer to the same extension.
	expect(replayed.extensions).toEqual([source, entry]);
	expect(replayed.skills).toEqual([resolve("tests/fixtures/skill")]);
	expect(replayed.promptTemplates).toEqual([
		resolve("tests/fixtures/prompt.md"),
	]);
	expect(replayed.noSkills).toBe(true);
	expect(replayed.noPromptTemplates).toBe(true);
});

test.skipIf(process.platform !== "win32")(
	"Windows shell drive paths keep their CLI targets across session cwd changes",
	() => {
		const drivePath = source.replaceAll("\\", "/");
		const drive = drivePath[0].toLowerCase();
		for (const prefix of ["/", "/mnt/", "/cygdrive/"]) {
			const path = `${prefix}${drive}${drivePath.slice(2)}`;
			const replayed = parseArgs(
				captureInheritance(
					api([], []),
					{ ...ctx, cwd: resolve("tests") },
					entry,
					["-e", path, "--skill", path, "--prompt-template", path],
				).args,
			);
			expect(replayed.extensions).toEqual([source, entry]);
			expect(replayed.skills).toEqual([source]);
			expect(replayed.promptTemplates).toEqual([source]);
		}
	},
);

test("skill and prompt home/file URL inputs retain their local targets", () => {
	const replayed = parseArgs(
		captureInheritance(api([], []), ctx, entry, [
			"--skill",
			"~/skills/example",
			"--prompt-template",
			pathToFileURL(resolve("prompt with spaces.md")).href,
		]).args,
	);
	expect(replayed.skills).toEqual([resolve(homedir(), "skills/example")]);
	expect(replayed.promptTemplates).toEqual([resolve("prompt with spaces.md")]);
});

test("CLI package replay does not weaken runtime tool or command source validation", () => {
	for (const path of [
		"<sdk:remote>",
		"npm:@example/hooks@1.2.3",
		"git:github.com/example/hooks@v1",
		"./missing-inheritance-source.ts",
	]) {
		for (const owner of ["tool", "command"]) {
			const parent = {
				...api(owner === "tool" ? [tool("remote", path)] : [], []),
				getCommands: () =>
					owner === "command"
						? [
								{
									name: "remote",
									source: "extension" as const,
									sourceInfo: createSyntheticSourceInfo(path, {
										source: "test",
									}),
								},
							]
						: [],
			};
			expect(() =>
				captureInheritance(parent, ctx, entry, [
					"-e",
					"npm:@example/hooks@1.2.3",
				]),
			).toThrow(
				path.startsWith("<")
					? "runtime-only source"
					: `Cannot reload ${owner} remote`,
			);
		}
	}
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

for (const name of DELEGATION_TOOLS) {
	test(`child validation rejects parent-only capability ${name}`, () => {
		expect(() =>
			validateChild(api([tool(name, entry)], []), {
				version: 1,
				tools: [],
				active: [],
			}),
		).toThrow("Delegation must not be registered");
	});
}

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
			expect(tools).toEqual(child ? [] : DELEGATION_TOOLS);
			expect(commands).toEqual(child ? ["pi-delegate-init"] : ["delegates"]);
		}
	} finally {
		if (previous === undefined) delete process.env[CHILD_ENV];
		else process.env[CHILD_ENV] = previous;
	}
});
