import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
	CustomEditor,
	CustomMessageComponent,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionAPI,
	type ExtensionUIContext,
	initTheme,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type EditorTheme,
	stripTerminalSequences,
	type TUI,
} from "@earendil-works/pi-tui";

async function host(
	commandsEnabled = true,
	settings: {
		mode?: "tui" | "rpc";
		beforeReply?: (requestIndex: number) => Promise<void>;
	} = {},
) {
	const cwd = await mkdtemp(join(tmpdir(), "dollar-skills-host-"));
	const agentDir = join(cwd, "agent");
	const review = join(cwd, ".pi", "skills", "grimoire-review", "SKILL.md");
	const testing = join(cwd, ".pi", "skills", "grimoire-test", "SKILL.md");
	const received: TranscriptContext[] = [];
	const notices: string[] = [];
	const errors: string[] = [];
	let provider: AutocompleteProvider | undefined;
	let editorText = "";
	let api: ExtensionAPI | undefined;
	const providerExtension = (pi: ExtensionAPI) => {
		api = pi;
		pi.registerProvider("dollar-fixture", {
			api: "dollar-fixture-api",
			apiKey: "offline-fixture",
			baseUrl: "https://invalid.example",
			models: [
				{
					id: "local",
					name: "Offline fixture",
					reasoning: false,
					input: ["text", "image"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: 128000,
					maxTokens: 1024,
				},
			],
			streamSimple(model, context, options) {
				received.push(structuredClone(context));
				const stream = createAssistantMessageEventStream();
				const message: AssistantMessage = {
					role: "assistant",
					api: model.api,
					provider: model.provider,
					model: model.id,
					content: [{ type: "text", text: "ok" }],
					stopReason: "stop",
					timestamp: Date.now(),
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
				};
				void (async () => {
					await settings.beforeReply?.(received.length);
					await options?.onPayload?.({}, model);
					await options?.onResponse?.({ status: 200, headers: {} }, model);
					stream.push({ type: "done", reason: "stop", message });
					stream.end();
				})();
				return stream;
			},
		});
	};
	await mkdir(agentDir);
	for (const [path, name, body] of [
		[review, "grimoire-review", "FULL REVIEW INSTRUCTIONS"],
		[testing, "grimoire-test", "FULL TEST INSTRUCTIONS"],
	]) {
		await mkdir(resolve(path, ".."), { recursive: true });
		await writeFile(
			path,
			`---\nname: ${name}\ndescription: ${name} description\n---\n${body}`,
		);
	}
	const settingsManager = SettingsManager.inMemory({
		defaultProvider: "dollar-fixture",
		defaultModel: "local",
		enableSkillCommands: commandsEnabled,
		compaction: { enabled: false },
		retry: { enabled: false },
		cacheWarming: "off",
		enableInstallTelemetry: false,
		enableAnalytics: false,
	});
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir,
		settingsManager,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: [
			resolve(
				import.meta.dir,
				process.env.PI_DOLLAR_SKILLS_TEST_ENTRY ?? "../src/index.ts",
			),
		],
		noSkills: true,
		additionalSkillPaths: [join(cwd, ".pi", "skills")],
		extensionFactories: [providerExtension],
	});
	await resourceLoader.reload();
	expect(resourceLoader.getExtensions().errors).toEqual([]);
	const modelRuntime = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: join(agentDir, "models.json"),
		modelsStorePath: join(agentDir, "models-cache.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	const { session } = await createAgentSession({
		cwd,
		agentDir,
		settingsManager,
		modelRuntime,
		resourceLoader,
		sessionManager: SessionManager.inMemory(cwd),
		tools: ["read"],
		thinkingLevel: "off",
	});
	const model = modelRuntime.getModel("dollar-fixture", "local");
	if (!model) throw new Error("offline fixture model was not registered");
	await session.setModel(model);
	const ui = {
		addAutocompleteProvider(factory) {
			if (!api) throw new Error("fixture extension API was not bound");
			const commands = api
				.getCommands()
				.filter((command) => commandsEnabled || command.source !== "skill");
			provider = factory(
				new CombinedAutocompleteProvider(
					[{ name: "help", description: "Help" }, ...commands],
					cwd,
				),
			);
		},
		notify(message) {
			notices.push(message);
		},
		getEditorText() {
			return editorText;
		},
		setEditorText(value) {
			editorText = value;
		},
		setEditorComponent() {
			throw new Error("must not replace the active editor");
		},
	} satisfies Partial<ExtensionUIContext>;
	await session.bindExtensions({
		mode: settings.mode ?? "tui",
		uiContext: ui as unknown as ExtensionUIContext,
		onError: (event) => errors.push(event.error),
	});
	return {
		session,
		received,
		notices,
		errors,
		resourceLoader,
		review,
		testing,
		get provider() {
			if (!provider) throw new Error("autocomplete was not installed");
			return provider;
		},
		get editorText() {
			return editorText;
		},
		set editorText(value: string) {
			editorText = value;
		},
		async close() {
			await session.abort();
			session.dispose();
			await rm(cwd, { recursive: true, force: true });
		},
	};
}

function lastUser(context: TranscriptContext) {
	const message = [...context.messages]
		.reverse()
		.find((message) => message.role === "user");
	expect(message?.role).toBe("user");
	if (message?.role !== "user") throw new Error("missing user message");
	return typeof message.content === "string"
		? [{ type: "text" as const, text: message.content }]
		: message.content;
}

for (const commandsEnabled of [true, false]) {
	test(`real host: full multi-skill context, image preservation, discovery=${commandsEnabled}`, async () => {
		const h = await host(commandsEnabled);
		try {
			const result = await h.provider.getSuggestions(["/"], 0, 1, {
				signal: new AbortController().signal,
			});
			expect(
				result?.items.some((item) => item.value.replace(/^\//, "") === "help"),
			).toBe(true);
			expect(result?.items.some((item) => item.value.includes("skill:"))).toBe(
				false,
			);
			const request = "用 $grimoire-review 和 $grimoire-test 检查这些修改";
			const image = {
				type: "image" as const,
				mimeType: "image/png",
				data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
			};
			await h.session.prompt(request, { images: [image] });
			await eventually(() => h.received.length === 1 && h.session.isIdle);
			const content = lastUser(h.received[0]);
			const text = content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			expect(text).toContain("FULL REVIEW INSTRUCTIONS");
			expect(text).toContain("FULL TEST INSTRUCTIONS");
			expect(text).toContain(h.review);
			expect(text).toContain(h.testing);
			expect(text.includes(request)).toBe(true);
			expect(content.filter((part) => part.type === "image")).toHaveLength(1);
			expect(
				h.resourceLoader.getSkills().skills.map((skill) => skill.name),
			).toEqual(["grimoire-review", "grimoire-test"]);
			expect(h.session.systemPrompt).toContain("grimoire-review");
			const messages = h.session.messages.filter(
				(message) => message.role === "custom",
			);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({
				customType: "dollar-skills",
				display: true,
			});
			expect(h.errors).toEqual([]);
		} finally {
			await h.close();
		}
	}, 15000);
}

test("real host: failed reads stop delivery, restore empty drafts and do not clobber newer input", async () => {
	const h = await host();
	try {
		await rm(h.review);
		await h.session.prompt("$grimoire-review");
		expect(h.received).toHaveLength(0);
		expect(h.notices[0]).toContain("Cannot load $grimoire-review");
		expect(h.editorText).toBe("$grimoire-review");
		h.editorText = "newer draft";
		await h.session.prompt("$grimoire-review $grimoire-test");
		expect(h.received).toHaveLength(0);
		expect(h.editorText).toBe("newer draft");
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
}, 15000);

test("real host: ordinary prose and manual /skill commands retain host behavior", async () => {
	const h = await host();
	try {
		await h.session.prompt("literal `$grimoire-review` and $unknown");
		expect(JSON.stringify(lastUser(h.received[0]))).not.toContain(
			"FULL REVIEW",
		);
		await h.session.prompt("/skill:grimoire-review ordinary args");
		expect(JSON.stringify(lastUser(h.received[1]))).toContain(
			"FULL REVIEW INSTRUCTIONS",
		);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
}, 15000);

const identity = (text: string) => text;
const theme: EditorTheme = {
	borderColor: identity,
	selectList: {
		selectedPrefix: identity,
		selectedText: identity,
		description: identity,
		scrollInfo: identity,
		noMatch: identity,
	},
};
async function eventually(predicate: () => boolean) {
	const until = Date.now() + 2000;
	while (!predicate() && Date.now() < until) await Bun.sleep(10);
	expect(predicate()).toBe(true);
}

// Real native/Open TUI editing and the real host submission pipeline.
// The terminal render scheduler and extension UI mounting bridge are controlled;
// this does not establish pixel/IME behavior in an actual terminal.
for (const openTui of [false, true]) {
	test(`${openTui ? "Open TUI" : "native"} editor: $ triggers naturally, Enter selects without sending, later submit injects`, async () => {
		const h = await host();
		try {
			const tui = {
				terminal: { rows: 24, columns: 80, write() {} },
				requestRender() {},
				getShowHardwareCursor() {
					return false;
				},
				setShowHardwareCursor() {},
			} as unknown as TUI;
			const Editor = openTui
				? (await import("../../pi-open-tui/src/editor.ts")).OpenTuiEditor
				: CustomEditor;
			const editor = new Editor(tui as never, theme, {
				matches: () => false,
			} as never);
			editor.setAutocompleteProvider(h.provider);
			let submitted: Promise<void> | undefined;
			editor.onSubmit = (text) => {
				submitted = h.session.prompt(text);
			};
			editor.handleInput("$");
			await eventually(() =>
				editor.render(80).join("\n").includes("$grimoire-review"),
			);
			editor.handleInput("\r");
			expect(editor.getText()).toBe("$grimoire-review ");
			expect(submitted).toBeUndefined();
			editor.handleInput("检查这些修改");
			editor.handleInput("\r");
			expect(submitted).toBeDefined();
			await submitted;
			expect(JSON.stringify(lastUser(h.received[0]))).toContain(
				"FULL REVIEW INSTRUCTIONS",
			);
			expect(JSON.stringify(lastUser(h.received[0]))).toContain("检查这些修改");
			expect(h.errors).toEqual([]);
			editor.setAutocompleteProvider(
				new CombinedAutocompleteProvider([], process.cwd()),
			);
		} finally {
			await h.close();
		}
	}, 15000);
}

test("real host: rendered multi-skill transcript hides instructions until expanded", async () => {
	const h = await host();
	try {
		initTheme("dark");
		await h.session.prompt("$grimoire-review $grimoire-test 仅检查");
		await eventually(() => h.received.length === 1 && h.session.isIdle);
		const message = h.session.messages.find(
			(message) => message.role === "custom",
		);
		if (message?.role !== "custom")
			throw new Error("missing custom skill prompt");
		const render =
			h.session.extensionRunner.getMessageRenderer("dollar-skills");
		expect(render).toBeDefined();
		const component = new CustomMessageComponent(message, render);
		const collapsed = stripTerminalSequences(component.render(80).join("\n"));
		expect(collapsed.match(/\[skill\]/g)).toHaveLength(2);
		expect(collapsed).toContain("仅检查");
		expect(collapsed).not.toContain("FULL REVIEW INSTRUCTIONS");
		expect(collapsed).not.toContain("FULL TEST INSTRUCTIONS");
		component.setExpanded(true);
		const expanded = stripTerminalSequences(component.render(80).join("\n"));
		expect(expanded).toContain("FULL REVIEW INSTRUCTIONS");
		expect(expanded).toContain("FULL TEST INSTRUCTIONS");
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

test("RPC keeps the ordinary User input pipeline and complete multi-skill context", async () => {
	const h = await host(true, { mode: "rpc" });
	try {
		await h.session.prompt("$grimoire-review $grimoire-test 保留请求");
		const text = JSON.stringify(lastUser(h.received[0]));
		expect(text).toContain("FULL REVIEW INSTRUCTIONS");
		expect(text).toContain("FULL TEST INSTRUCTIONS");
		expect(text).toContain("保留请求");
		expect(
			h.session.messages.some((message) => message.role === "custom"),
		).toBe(false);
		expect(h.errors).toEqual([]);
	} finally {
		await h.close();
	}
});

for (const streamingBehavior of ["steer", "followUp"] as const) {
	test(`real host: queued ${streamingBehavior} delivers skills, request and image atomically once`, async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = await host(true, {
			beforeReply: async (index) => {
				if (index === 1) await gate;
			},
		});
		const running = h.session.prompt("start");
		try {
			await eventually(() => h.received.length === 1);
			const request = "$grimoire-test $grimoire-review $grimoire-test 排队需求";
			const image = {
				type: "image" as const,
				mimeType: "image/png",
				data: "fixture-image",
			};
			await h.session.prompt(request, { streamingBehavior, images: [image] });
			expect(h.received).toHaveLength(1);
			release();
			await running;
			await eventually(() => h.received.length === 2 && h.session.isIdle);
			const content = lastUser(h.received[1]);
			const text = content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("");
			expect(text).toContain(request);
			expect(text.match(/FULL TEST INSTRUCTIONS/g)).toHaveLength(1);
			expect(text.match(/FULL REVIEW INSTRUCTIONS/g)).toHaveLength(1);
			expect(text.indexOf("FULL TEST")).toBeLessThan(
				text.indexOf("FULL REVIEW"),
			);
			expect(content.filter((part) => part.type === "image")).toEqual([image]);
			expect(
				h.session.messages.filter((message) => message.role === "custom"),
			).toHaveLength(1);
			expect(h.errors).toEqual([]);
		} finally {
			release();
			await running;
			await h.close();
		}
	});
}
