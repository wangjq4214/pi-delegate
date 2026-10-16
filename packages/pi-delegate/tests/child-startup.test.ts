import { afterEach, expect, spyOn, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
	createSyntheticSourceInfo,
	type ExtensionAPI,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { registerChild } from "../src/child.ts";
import {
	INIT_COMMAND,
	INIT_ENTRY,
	type InheritanceSnapshot,
	SNAPSHOT_ENV,
	snapshotTool,
} from "../src/inheritance.ts";
import { readInitializationProgress } from "../src/initialization-progress.ts";

const directories: string[] = [];
const previous = process.env[SNAPSHOT_ENV];
afterEach(() => {
	if (previous === undefined) delete process.env[SNAPSHOT_ENV];
	else process.env[SNAPSHOT_ENV] = previous;
	for (const directory of directories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});
const tool = (name: string): ToolInfo => ({
	name,
	description: name,
	parameters: Type.Object({}),
	exposure: "direct",
	sourceInfo: createSyntheticSourceInfo(`builtin:${name}`, { source: "test" }),
});
function setup(expected: ToolInfo[]) {
	const directory = mkdtempSync(join(tmpdir(), "delegate-child-startup-"));
	directories.push(directory);
	const path = join(directory, "snapshot.json");
	const snapshot: InheritanceSnapshot = {
		version: 1,
		tools: expected.map(snapshotTool),
		active: expected.slice(0, 1).map((item) => item.name),
	};
	writeFileSync(path, JSON.stringify(snapshot));
	process.env[SNAPSHOT_ENV] = path;
	let handler: () => Promise<void> = async () => {
		throw new Error("Not registered");
	};
	let active: string[] = [];
	let tools = expected;
	let enumerations = 0;
	const phases: string[] = [];
	const entries: unknown[] = [];
	const pi = {
		registerCommand: (
			name: string,
			command: { handler: () => Promise<void> },
		) => {
			expect(name).toBe(INIT_COMMAND);
			handler = command.handler;
		},
		getAllTools: () => {
			enumerations++;
			return tools;
		},
		getActiveTools: () => active,
		setActiveTools: (names: string[]) => {
			phases.push(
				JSON.parse(readFileSync(`${path}.progress.json`, "utf8")).phase,
			);
			active = names;
		},
		appendEntry: (type: string, data: unknown) => {
			expect(type).toBe(INIT_ENTRY);
			entries.push(data);
		},
	};
	return {
		path,
		snapshot,
		pi,
		phases,
		entries,
		register: () => registerChild(pi as unknown as ExtensionAPI),
		initialize: () => handler(),
		setTools: (next: ToolInfo[]) => {
			tools = next;
		},
		get enumerations() {
			return enumerations;
		},
		get active() {
			return active;
		},
	};
}

test("enumerates once for the ready waiting iteration, then separately validates all metadata", async () => {
	const tools = Array.from({ length: 200 }, (_, index) =>
		tool(`tool-${index}`),
	);
	const child = setup(tools);
	child.register();
	expect((await readInitializationProgress(child.path))?.phase).toBe(
		"extension-loaded",
	);
	expect(child.enumerations).toBe(0);
	await child.initialize();
	expect(child.enumerations).toBe(2);
	expect(child.entries).toEqual([{ ok: true }]);
	expect(child.active).toEqual(["tool-0"]);
	expect(child.phases).toEqual(["validating"]);
	expect(await readInitializationProgress(child.path)).toMatchObject({
		phase: "ready",
		expectedTools: 200,
		availableTools: 200,
		missingTools: [],
		missingToolCount: 0,
	});
});

test("waiting progress observes missing tools, then ready restores active tools", async () => {
	const tools = [tool("read"), tool("late")];
	const child = setup(tools);
	child.setTools([tools[0]]);
	child.register();
	const pending = child.initialize();
	expect(child.enumerations).toBe(1);
	let waitingIterations = 0;
	try {
		expect(await readInitializationProgress(child.path)).toMatchObject({
			phase: "waiting-tools",
			expectedTools: 2,
			availableTools: 1,
			missingTools: ["late"],
			missingToolCount: 1,
		});
		waitingIterations = child.enumerations;
	} finally {
		child.setTools(tools);
		await pending;
	}
	expect(child.enumerations).toBe(waitingIterations + 2);
	expect(child.entries).toEqual([{ ok: true }]);
	expect(child.active).toEqual(["read"]);
	expect((await readInitializationProgress(child.path))?.phase).toBe("ready");
});

test("30s waiting deadline still fails validation and retains observed missing names", async () => {
	const child = setup([tool("missing-a"), tool("missing-b")]);
	let now = 1000;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const enumerate = child.pi.getAllTools;
	child.pi.getAllTools = () => {
		now = 31_000;
		enumerate();
		return [];
	};
	try {
		child.register();
		await child.initialize();
		expect(child.enumerations).toBe(2);
		expect(child.entries).toEqual([
			{ ok: false, error: "Unable to reinitialize inherited tool: missing-a" },
		]);
		expect(await readInitializationProgress(child.path)).toEqual({
			phase: "failed",
			elapsedMs: 30_000,
			expectedTools: 2,
			availableTools: 0,
			missingTools: ["missing-a", "missing-b"],
			missingToolCount: 2,
			error: "Unable to reinitialize inherited tool: missing-a",
		});
	} finally {
		clock.mockRestore();
	}
});

for (const reason of ["schema", "unexpected", "delegation", "activation"]) {
	test(`ready names do not bypass ${reason} validation failures`, async () => {
		const tools = [tool("read")];
		const child = setup(tools);
		if (reason === "schema")
			child.setTools([
				{ ...tools[0], parameters: Type.Object({ changed: Type.String() }) },
			]);
		if (reason === "unexpected") child.setTools([...tools, tool("extra")]);
		if (reason === "delegation") child.setTools([...tools, tool("delegate")]);
		if (reason === "activation") child.pi.setActiveTools = () => {};
		child.register();
		await child.initialize();
		expect(child.enumerations).toBe(2);
		expect(child.entries).toMatchObject([{ ok: false }]);
		expect(await readInitializationProgress(child.path)).toMatchObject({
			phase: "failed",
			missingToolCount: 0,
			missingTools: [],
		});
	});
}

test("invalid snapshot fails explicitly without enumerating tools", async () => {
	const child = setup([]);
	writeFileSync(
		child.path,
		JSON.stringify({ version: 2, tools: [], active: [] }),
	);
	child.register();
	await child.initialize();
	expect(child.entries).toEqual([
		{ ok: false, error: "Invalid child inheritance snapshot" },
	]);
	expect(child.enumerations).toBe(0);
	expect(await readInitializationProgress(child.path)).toMatchObject({
		phase: "failed",
		error: "Invalid child inheritance snapshot",
	});
});

test("sidecar failure never fails actual initialization", async () => {
	const child = setup([]);
	mkdirSync(`${child.path}.progress.json`);
	child.pi.setActiveTools = () => {};
	child.register();
	await child.initialize();
	expect(child.entries).toEqual([{ ok: true }]);
	expect(await readInitializationProgress(child.path)).toBeUndefined();
});
