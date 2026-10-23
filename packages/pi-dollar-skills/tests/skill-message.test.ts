import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	CustomMessageComponent,
	type ExtensionAPI,
	getPackageDir,
	initTheme,
	type MessageRenderer,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import {
	Container,
	ScrollView,
	stripTerminalSequences,
	type Terminal,
	TuiAltScreen,
	TuiMainScreen,
	VStack,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	DEFAULT_CONFIG,
	DEFAULT_USER_BORDER,
} from "../../pi-open-tui/src/config.ts";
import { installUserMessageLayout } from "../../pi-open-tui/src/user-message-layout.ts";
import {
	createSkillMessage,
	registerSkillMessages,
} from "../src/skill-message.ts";
import type { LoadedSkill } from "../src/skills.ts";

const hostTheme = await import(
	pathToFileURL(join(getPackageDir(), "dist/modes/interactive/theme/theme.js"))
		.href
);
initTheme("dark");

const skills: LoadedSkill[] = [
	{
		name: "first",
		path: "/first/SKILL.md",
		content:
			"FIRST INSTRUCTIONS\n\n```text\n  code\n</skill>\n\n  still code\n```",
	},
	{ name: "second", path: "/second/SKILL.md", content: "SECOND INSTRUCTIONS" },
];
const request = "用 $first 和 $second 检查中文需求\n\n保留正文。";

function renderer() {
	let render: MessageRenderer | undefined;
	registerSkillMessages({
		registerMessageRenderer(_name, callback) {
			render = callback as MessageRenderer;
		},
	} as ExtensionAPI);
	if (!render) throw new Error("renderer was not registered");
	return render;
}

function fixture() {
	const message = {
		...createSkillMessage(request, skills),
		role: "custom" as const,
		timestamp: 1,
	};
	const render = renderer();
	const component = new CustomMessageComponent(message, render);
	const root = render(
		message,
		{ expanded: false, outputPad: 1 },
		hostTheme.theme,
	);
	if (!(root instanceof Container)) throw new Error("missing message view");
	const cards = root.children.filter(
		(child): child is SkillInvocationMessageComponent =>
			child instanceof SkillInvocationMessageComponent,
	);
	const user = root.children.find(
		(child): child is UserMessageComponent =>
			child instanceof UserMessageComponent,
	);
	if (!user) throw new Error("missing separate user body");
	return { message, render, component, cards, user };
}

const plain = (component: { render(width: number): string[] }, width = 80) =>
	stripTerminalSequences(component.render(width).join("\n"));

const isExpanded = (card: SkillInvocationMessageComponent) =>
	plain(card).includes("INSTRUCTIONS");

const click = {
	type: "click" as const,
	button: "left" as const,
	x: 3,
	y: 1,
	screenX: 3,
	screenY: 1,
	width: 80,
	height: 3,
	shift: false,
	ctrl: false,
	alt: false,
};

test("multi-skill view uses separate native cards and a clean native User body", () => {
	const f = fixture();
	expect(f.cards).toHaveLength(2);
	expect(f.message.content[2]).toEqual({ type: "text", text: request });
	const collapsed = plain(f.component);
	expect(collapsed.match(/\[skill\]/g)).toHaveLength(2);
	expect(collapsed).toContain("first");
	expect(collapsed).toContain("second");
	expect(collapsed).toContain("保留正文");
	expect(collapsed).not.toContain("INSTRUCTIONS");
	expect(collapsed).not.toContain("<skill");

	// Route through the real host wrapper and containers, not a direct card call.
	const rows = f.component.render(80);
	const secondY = rows.findIndex((row) =>
		stripTerminalSequences(row).includes("second"),
	);
	expect(
		f.component.handleMouse({ ...click, y: secondY, height: rows.length })
			?.handled,
	).toBe(true);
	expect(isExpanded(f.cards[0])).toBe(false);
	expect(isExpanded(f.cards[1])).toBe(true);
	expect(plain(f.component)).toContain("SECOND INSTRUCTIONS");
	expect(plain(f.component)).not.toContain("FIRST INSTRUCTIONS");
	f.component.invalidate();
	expect(isExpanded(f.cards[1])).toBe(true);
	expect(plain(f.component)).toContain("SECOND INSTRUCTIONS");

	// Native Ctrl+O handling calls setExpanded on CustomMessageComponent.
	f.component.setExpanded(true);
	expect(f.cards.every((card) => isExpanded(card))).toBe(true);
	expect(plain(f.component)).toContain("FIRST INSTRUCTIONS");
	expect(plain(f.component)).toContain("still code");
	f.component.setExpanded(false);
	expect(f.cards.every((card) => !isExpanded(card))).toBe(true);
	expect(plain(f.user)).not.toContain("INSTRUCTIONS");
});

test("snapshots survive serialization and fresh renderer registration without skill rereads", () => {
	const f = fixture();
	const replay = JSON.parse(JSON.stringify(f.message));
	const component = new CustomMessageComponent(replay, renderer());
	component.setExpanded(true);
	expect(plain(component)).toContain("FIRST INSTRUCTIONS");
	expect(plain(component)).toContain("SECOND INSTRUCTIONS");
	expect(plain(component)).toContain("still code");
	expect(plain(component)).toContain("保留正文");
	const fallback = new CustomMessageComponent(
		{ ...replay, details: undefined },
		renderer(),
	);
	expect(plain(fallback)).toContain("FIRST INSTRUCTIONS");
});

for (const mode of ["regular", "fullscreen"] as const) {
	test(`${mode}: Open TUI adapts all native cards and User body; mode changes and cleanup remain reversible`, () => {
		const f = fixture();
		const terminal: Terminal = {
			columns: 80,
			rows: 24,
			kittyProtocolActive: false,
			start() {},
			stop() {},
			async drainInput() {},
			write() {},
			moveBy() {},
			showCursor() {},
			hideCursor() {},
			clearLine() {},
			clearFromCursor() {},
			clearScreen() {},
			setTitle() {},
			setProgress() {},
			setProgramStatus() {},
		};
		const tui =
			mode === "regular"
				? new TuiMainScreen(terminal)
				: new TuiAltScreen(terminal);
		if (tui instanceof TuiAltScreen) {
			tui.setLayoutRoot(
				new VStack([new ScrollView(f.component, { primary: true })]),
			);
		} else tui.addChild(f.component);
		const config = structuredClone(DEFAULT_CONFIG);
		config.userMessageLayout = "compact";
		const borderConfig = structuredClone(DEFAULT_USER_BORDER);
		config.userBoxBorder = borderConfig;
		const warnings: string[] = [];
		const native = [...f.cards.map((card) => card.render), f.user.render];
		const adapter = installUserMessageLayout(
			tui as never,
			() => config,
			() => hostTheme.theme,
			() => warnings.push("fallback"),
		);
		try {
			for (const [index, card] of f.cards.entries()) {
				expect(card.render).not.toBe(native[index]);
				expect(plain(card)).toContain("┃");
			}
			expect(f.user.render).not.toBe(native[2]);
			expect(plain(f.user)).toContain("┃");
			expect(plain(f.user)).not.toContain("INSTRUCTIONS");
			f.cards[1].render(80);
			expect(
				f.cards[1].handleMouse({ ...click, y: 0, height: 1 })?.handled,
			).toBe(true);
			expect(isExpanded(f.cards[1])).toBe(true);
			expect(isExpanded(f.cards[0])).toBe(false);

			for (const theme of ["light", "dark"] as const) {
				initTheme(theme);
				f.component.invalidate();
				for (const border of [false, true]) {
					borderConfig.enabled = border;
					adapter.refresh();
					for (const pad of [0, 1] as const) {
						f.component.setOutputPad(pad);
						for (const width of [12, 30, 80]) {
							const lines = f.component.render(width);
							expect(lines.every((line) => visibleWidth(line) <= width)).toBe(
								true,
							);
						}
					}
				}
			}
			f.component.setExpanded(true);
			expect(plain(f.component)).toContain("FIRST INSTRUCTIONS");
			expect(plain(f.component)).toContain("SECOND INSTRUCTIONS");
			config.enabled = false;
			adapter.refresh();
			for (const [index, card] of f.cards.entries())
				expect(card.render).toBe(native[index]);
			expect(f.user.render).toBe(native[2]);
			config.enabled = true;
			adapter.refresh();
			expect(f.cards[0].render).not.toBe(native[0]);
			adapter.cleanup();
			for (const [index, card] of f.cards.entries())
				expect(card.render).toBe(native[index]);
			expect(f.user.render).toBe(native[2]);
			expect(warnings).toEqual([]);
		} finally {
			adapter.cleanup();
			tui.stop();
			initTheme("dark");
		}
	});
}
