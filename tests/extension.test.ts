import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	RegisteredCommand,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

function register() {
	const commands = new Map<
		string,
		Omit<RegisteredCommand, "name" | "sourceInfo">
	>();
	const api: Pick<ExtensionAPI, "registerCommand"> = {
		registerCommand: (name, command) => {
			commands.set(name, command);
		},
	};
	extension(api as ExtensionAPI);
	return commands;
}

test("registers only the hello command", () => {
	const commands = register();
	expect([...commands.keys()]).toEqual(["hello"]);
	expect(commands.get("hello")?.description).toBeTruthy();
});

for (const [input, greeting] of [
	["", "Hello, world!"],
	["   ", "Hello, world!"],
	["  Derek  ", "Hello, Derek!"],
]) {
	test(`greets ${JSON.stringify(input)}`, async () => {
		const notifications: unknown[] = [];
		const ctx = {
			hasUI: true,
			ui: { notify: (...args: unknown[]) => notifications.push(args) },
		} as unknown as ExtensionCommandContext;
		await register().get("hello")?.handler(input, ctx);
		expect(notifications).toEqual([[greeting, "info"]]);
	});
}

test("does not access UI in non-interactive mode", async () => {
	await register()
		.get("hello")
		?.handler("", { hasUI: false } as ExtensionCommandContext);
});
