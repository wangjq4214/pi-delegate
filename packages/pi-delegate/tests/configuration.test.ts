import { expect, test } from "bun:test";
import { type JsonObject, validateToolArguments } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { captureConfiguration } from "../src/configuration.ts";
import { type DelegationOptions, registerDelegate } from "../src/delegate.ts";
import { configurationContext } from "./fixtures/configuration-context.ts";

function required<T>(value: T | undefined): T {
	if (value === undefined)
		throw new Error("Missing configuration fixture value");
	return value;
}

function registration() {
	const tools = new Map<string, Parameters<ExtensionAPI["registerTool"]>[0]>();
	const hooks = new Map<string, () => unknown>();
	const calls: DelegationOptions[] = [];
	const delivered: unknown[] = [];
	registerDelegate(
		{
			registerTool: (tool: Parameters<ExtensionAPI["registerTool"]>[0]) =>
				tools.set(tool.name, tool),
			on: (name: string, hook: unknown) => {
				hooks.set(name, hook as () => unknown);
				return () => {};
			},
			getAllTools: () => [],
			getActiveTools: () => [],
			getCommands: () => [],
			sendMessage: (message: unknown) => {
				delivered.push(message);
			},
		} as unknown as ExtensionAPI,
		async (options) => {
			calls.push(options);
			return {
				content: [{ type: "text", text: "done" }],
				details: {
					status: "completed",
					configuration: {
						requested: required(options.requestedConfiguration),
					},
				},
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				isError: false,
			};
		},
	);
	const ctx = {
		...configurationContext,
		model: { ...required(configurationContext.model) },
		thinkingLevel: "medium",
		modelRegistry: {
			find: (provider: string, id: string) =>
				["fixture", "alternative"].includes(provider) &&
				["fixture-model", "path/id:variant"].includes(id)
					? { provider, id }
					: undefined,
		},
		cwd: process.cwd(),
		mode: "rpc",
		isProjectTrusted: () => false,
		isIdle: () => true,
		hasPendingMessages: () => false,
	} as unknown as ExtensionToolContext;
	const tool = required(tools.get("delegate"));
	const execute = (args: Record<string, unknown>, prepare = true) =>
		tool.execute(
			"selection",
			prepare
				? validateToolArguments(tool, {
						type: "toolCall",
						id: "selection",
						name: "delegate",
						arguments: required(tool.prepareArguments)(args) as JsonObject,
					})
				: args,
			undefined,
			undefined,
			ctx,
		);
	return {
		ctx,
		calls,
		tools,
		delivered,
		execute,
		close: () => hooks.get("session_shutdown")?.(),
	};
}

for (const background of [false, true]) {
	for (const overrides of [
		{},
		{ model: { provider: "alternative", id: "path/id:variant" } },
		{ thinkingLevel: "high" },
		{
			model: { provider: "alternative", id: "path/id:variant" },
			thinkingLevel: "max",
		},
	]) {
		test(`selection snapshots independent overrides in ${background ? "background" : "sync"}: ${JSON.stringify(overrides)}`, async () => {
			const r = registration();
			try {
				const expected = {
					model: overrides.model ?? {
						provider: "fixture",
						id: "fixture-model",
					},
					thinkingLevel: overrides.thinkingLevel ?? "medium",
				};
				const response = await r.execute({
					task: "task",
					background,
					...overrides,
				});
				if (background) expect(response.details).toHaveProperty("taskId");
				required(r.ctx.model).id = "changed-parent";
				r.ctx.thinkingLevel = "off";
				if (overrides.model) overrides.model.id = "changed-input";
				// expected must not alias caller-owned model data.
				expected.model = {
					provider: overrides.model ? "alternative" : "fixture",
					id: overrides.model ? "path/id:variant" : "fixture-model",
				};
				await Bun.sleep(10);
				expect(r.calls).toHaveLength(1);
				expect(required(r.calls[0]).requestedConfiguration).toMatchObject(
					expected,
				);
				expect(required(r.calls[0]).args).not.toContain("--model");
				if (background) {
					const taskId = (response.details as { taskId: string }).taskId;
					const result = await required(r.tools.get("delegate_status")).execute(
						"query",
						{ taskId },
						undefined,
						undefined,
						r.ctx,
					);
					expect(result.details).toMatchObject({
						result: { configuration: { requested: expected } },
					});
					expect(r.delivered).toHaveLength(1);
				}
			} finally {
				await r.close();
			}
		});
	}
	for (const invalid of [
		{ model: null },
		{ model: "fixture-model" },
		{ model: { provider: 123, id: "fixture-model" } },
		{ model: { provider: "fixture", id: "fixture-model", apiKey: "secret" } },
		{ model: { provider: "fixture", id: "fixture" } },
		{ model: { provider: "unknown", id: "fixture-model" } },
		{ thinkingLevel: null },
		{ thinkingLevel: true },
		{ thinkingLevel: "HIGH" },
	]) {
		for (const prepare of [false, true])
			test(`invalid selection rejects before acceptance: ${background}/${prepare}/${JSON.stringify(invalid)}`, async () => {
				const r = registration();
				try {
					const result = await r.execute(
						{ task: "task", background, ...invalid },
						prepare,
					);
					expect(result.isError).toBe(true);
					expect(result.details).toMatchObject({ status: "failed" });
					expect(result.details).not.toHaveProperty("taskId");
					await Bun.sleep(5);
					expect(r.calls).toEqual([]);
					expect(r.delivered).toEqual([]);
				} finally {
					await r.close();
				}
			});
	}
}

test("capture rejects absent parent selection and strips full-model metadata", () => {
	const ctx = { ...configurationContext };
	expect(captureConfiguration(ctx)).toEqual({
		model: { provider: "fixture", id: "fixture-model" },
		thinkingLevel: "off",
	});
	ctx.model = undefined;
	expect(() => captureConfiguration(ctx)).toThrow("selected model");
});
