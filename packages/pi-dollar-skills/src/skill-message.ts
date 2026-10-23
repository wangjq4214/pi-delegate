import type { ImageContent } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	getMarkdownTheme,
	SkillInvocationMessageComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer } from "@earendil-works/pi-tui";
import { type LoadedSkill, skillBlock } from "./skills.ts";

export const SKILL_MESSAGE = "dollar-skills";

interface SkillMessageDetails {
	version: 1;
	skills: { name: string; path: string }[];
}

/** One queued message keeps the skill snapshots, request and images atomic. */
export function createSkillMessage(
	request: string,
	skills: LoadedSkill[],
	images: ImageContent[] = [],
) {
	return {
		customType: SKILL_MESSAGE,
		content: [
			...skills.map((skill) => ({
				type: "text" as const,
				text: `${skillBlock(skill)}\n\n`,
			})),
			{ type: "text" as const, text: request },
			...images,
		],
		display: true,
		details: {
			version: 1,
			skills: skills.map(({ name, path }) => ({ name, path })),
		} satisfies SkillMessageDetails,
	};
}

export function registerSkillMessages(pi: ExtensionAPI): void {
	// Keep native per-card mouse expansion through host invalidation/rebuilds.
	// Weak keys leave disposal, branch replacement and reload to the host.
	const views = new WeakMap<
		object,
		{
			root: Container;
			cards: SkillInvocationMessageComponent[];
			user: UserMessageComponent;
			expanded: boolean;
			outputPad: number;
		}
	>();
	pi.registerMessageRenderer<SkillMessageDetails>(
		SKILL_MESSAGE,
		(message, options) => {
			let view = views.get(message);
			if (!view) {
				const details = message.details;
				const parts = message.content;
				if (
					details?.version !== 1 ||
					!Array.isArray(details.skills) ||
					!details.skills.length ||
					!Array.isArray(parts)
				)
					return undefined;
				const request = parts[details.skills.length];
				if (request?.type !== "text") return undefined;
				const root = new Container();
				const cards: SkillInvocationMessageComponent[] = [];
				for (const [index, skill] of details.skills.entries()) {
					const part = parts[index];
					if (
						typeof skill?.name !== "string" ||
						typeof skill.path !== "string" ||
						part?.type !== "text" ||
						!part.text.startsWith('<skill name="') ||
						!part.text.endsWith("\n</skill>\n\n")
					)
						return undefined;
					// Slice only our outer envelope, not tags/code inside skill files.
					const content = part.text.slice(
						part.text.indexOf("\n") + 1,
						-"\n</skill>\n\n".length,
					);
					const card = new SkillInvocationMessageComponent(
						{
							name: skill.name,
							location: skill.path,
							content,
							userMessage: undefined,
						},
						getMarkdownTheme(),
						options.outputPad,
					);
					card.setExpanded(options.expanded);
					if (cards.length) root.addChild(new Spacer(1));
					root.addChild(card);
					cards.push(card);
				}
				const user = new UserMessageComponent(
					request.text,
					getMarkdownTheme(),
					options.outputPad,
				);
				root.addChild(new Spacer(1));
				root.addChild(user);
				view = { root, cards, user, ...options };
				views.set(message, view);
			}
			if (view.expanded !== options.expanded) {
				for (const card of view.cards) card.setExpanded(options.expanded);
				view.expanded = options.expanded;
			}
			if (view.outputPad !== options.outputPad) {
				for (const card of view.cards) card.setOutputPad(options.outputPad);
				view.user.setOutputPad(options.outputPad);
				view.outputPad = options.outputPad;
			}
			return view.root;
		},
	);
}
