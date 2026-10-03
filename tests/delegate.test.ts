import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { registerDelegate } from "../src/delegate.ts";

function registeredTool() {
	let tool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
	registerDelegate({
		registerTool: (definition: Parameters<ExtensionAPI["registerTool"]>[0]) => {
			tool = definition;
		},
		on: () => () => {},
		getAllTools: () => {
			throw new Error("fixture inheritance failure");
		},
	} as unknown as ExtensionAPI);
	if (!tool) throw new Error("Delegate not registered");
	return tool;
}

for (const [task, signal, status, error] of [
	["   ", undefined, "failed", "Delegation task must not be blank"],
	["task", undefined, "failed", "fixture inheritance failure"],
	["task", AbortSignal.abort(), "cancelled", "Delegation cancelled"],
] as const) {
	test(`registered delegate returns ${status} for ${error}`, async () => {
		const tool = registeredTool();
		const result = await tool.execute(
			"test",
			{ task },
			signal,
			undefined,
			{} as ExtensionToolContext,
		);
		expect(result.details).toMatchObject({ status, error });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({
			type: "text",
			text: `[Delegation ${status}: ${error}]`,
		});
		expect(result.usage?.totalTokens).toBe(0);
	});
}
