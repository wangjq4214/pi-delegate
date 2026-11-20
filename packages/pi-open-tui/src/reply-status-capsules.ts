import type { MarkdownTransformContext } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import { Marked, type Token } from "marked";
import type { ReplyStatusIconMode } from "./config.ts";

const STYLES = {
	success: { bg: "27;73;56", fg: "181;245;204", text: "✓", nerd: "\uf00c" },
	failure: { bg: "99;44;57", fg: "255;199;205", text: "×", nerd: "\uf00d" },
	warning: { bg: "84;64;22", fg: "255;226;154", text: "!", nerd: "\uf071" },
	action: { bg: "35;69;121", fg: "192;219;255", text: "→", nerd: "\uf061" },
};
type Category = keyof typeof STYLES;
const markers = /\*\*\[(success|failure|warning|action): ([^\[\]\p{Cc}\p{Zl}\p{Zp}]+)\]\*\*/gu;
const lexer = new Marked();
const plain = (text: string) => text;
const measureTheme: MarkdownTheme = {
	heading: plain, link: plain, linkUrl: plain, code: plain, codeBlock: plain, codeBlockBorder: plain,
	quote: plain, quoteBorder: plain, hr: plain, listBullet: plain, bold: plain, italic: plain,
	strikethrough: plain, underline: plain,
};

export const REPLY_STATUS_GUIDANCE = [
	"Use status markers by default when reporting a confirmed result, a failure or blocker, an important caveat such as a skipped key check, or a decision the user needs to make. Start the relevant paragraph or list item with the marker instead of a plain status heading such as 'Tests' or 'Next steps', then add any details in normal prose.",
	"Use an action marker when waiting for approval, a choice, or missing information, even if the reply is only one sentence. For example: **[action: Confirm the commit]** Commit with this message?",
	"Use exactly this Markdown syntax: **[success: Tests passed 3/3]** for a verified success, **[failure: Build failed]** for something that failed, **[warning: End-to-end tests not run]** for an important caveat, or **[action: Confirm the release version]** for something the user needs to do.",
	"Keep the lowercase English category key and the space after the colon. Write a short, single-line plain-text label in the reply's language, without square brackets. Put the marker directly in the reply body, not in code, a quote, or a link.",
	"Use one marker per distinct status. Report only what happened: never mark unverified work as successful. Skip markers for ordinary explanations or when there is no meaningful status to report.",
].join("\n");

interface Marker { start: number; end: number; reference: string; pill: string; markdown: string; breakBefore: string; capped: boolean }

function renderPill(category: Category, label: string, mode: ReplyStatusIconMode): string {
	const style = STYLES[category];
	const icon = mode === "none" ? "" : style[mode] + "\u00a0";
	const [left, right] = mode === "nerd" ? ["\ue0b6", "\ue0b4"] : ["◖", "◗"];
	return `\x1b[38;2;${style.bg}m${left}\x1b[48;2;${style.bg};38;2;${style.fg}m\u00a0${icon}${label.replaceAll(" ", "\u00a0")}\u00a0\x1b[49;38;2;${style.bg}m${right}\x1b[39m`;
}

/** Follow body prose and lists, but never descend into quotes, code, links or HTML. */
function visitProse(tokens: Token[], accept: (raw: string) => void): void {
	for (const token of tokens) {
		switch (token.type) {
			case "list":
				for (const item of token.items) visitProse(item.tokens, accept);
				break;
			case "paragraph": case "text": case "heading":
				let raw = false;
				for (const inline of token.tokens ?? []) {
					if (inline.type === "html") raw = ("inRawBlock" in inline && inline.inRawBlock === true)
						|| ("inLink" in inline && inline.inLink === true);
					else if (!raw && inline.type === "strong") accept(inline.raw);
				}
				break;
		}
	}
}

export function renderReplyStatusCapsules(markdown: string, ctx: MarkdownTransformContext, mode: ReplyStatusIconMode): string {
	if (ctx.messageType !== "assistant" || !markdown.includes("**[")) return markdown;
	const candidates: Marker[] = [];
	let key = "OpenTuiCapsule";
	while (markdown.includes(key)) key += "X";
	// Number candidates only in the lexer input. Tokens can then map back to
	// original offsets even in dedented list items and repeated quoted examples.
	const tagged = markdown.replace(markers, (raw: string, category: Category, text: string, start: number) => {
		let escape = start;
		while (escape > 0 && markdown[escape - 1] === "\\") escape--;
		if ((start - escape) % 2) return raw;
		const label = text.trim();
		const inner = raw.slice(3, -3);
		// Do not consume an escaped closing bracket.
		const trailingSlashes = /\\+$/.exec(inner)?.[0].length ?? 0;
		if (!label || trailingSlashes % 2) return raw;
		const index = candidates.length;
		const pill = renderPill(category, label, mode);
		// The host parses Markdown again after the transform. Escape only the
		// label, so its punctuation renders literally inside the styled text.
		const escaped = label.replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, "\\$&");
		candidates.push({
			start, end: start + raw.length, reference: inner.replace(/\s+/g, " ").toLowerCase(),
			pill, markdown: escaped === label ? pill : renderPill(category, escaped, mode),
			breakBefore: "", capped: true,
		});
		return `**[${inner}${key}${index}]**`;
	});
	if (!candidates.length) return markdown;
	const tag = new RegExp(`^\\*\\*\\[[^\\[\\]]+${key}(\\d+)\\]\\*\\*$`);
	const matches: Marker[] = [];
	const tokens = lexer.lexer(tagged);
	visitProse(tokens, (raw) => {
		const match = tag.exec(raw);
		if (!match) return;
		const candidate = candidates[Number(match[1])]!;
		// A shortcut reference is a link, not a status marker.
		if (!Object.hasOwn(tokens.links, candidate.reference)) matches.push(candidate);
	});
	if (!matches.length) return markdown;
	matches.sort((a, b) => a.start - b.start);
	const compose = () => {
		let cursor = 0;
		let output = "";
		for (const m of matches) {
			if (!m.capped) continue;
			output += markdown.slice(cursor, m.start) + m.breakBefore + m.markdown;
			cursor = m.end;
		}
		return output + markdown.slice(cursor);
	};
	// Pi wraps CJK graphemes individually, even next to nonbreaking spaces.
	// Probe its public Markdown layout before inserting a hard break. If a
	// capsule cannot fit (e.g. very narrow nested lists), keep its readable marker.
	const splitPills = (source: string) => {
		const lines = new Markdown(source, 0, 0, measureTheme).render(ctx.availableWidth);
		const counts = new Map<string, number>();
		for (const m of matches) if (m.capped) counts.set(m.pill, (counts.get(m.pill) ?? 0) + 1);
		return new Set([...counts].filter(([pill, count]) => {
			let displayed = 0;
			for (const line of lines) for (let i = line.indexOf(pill); i !== -1; i = line.indexOf(pill, i + pill.length)) displayed++;
			return displayed !== count;
		}).map(([pill]) => pill));
	};
	let output = compose();
	let split = splitPills(output);
	if (!split.size) return output;
	for (const m of matches) {
		if (!split.has(m.pill)) continue;
		const lineStart = markdown.lastIndexOf("\n", m.start - 1) + 1;
		const prefix = markdown.slice(lineStart, m.start);
		const indent = /^(?: *(?:[-+*]|\d+[.)]) +| *)/.exec(prefix)?.[0] ?? "";
		if (prefix.slice(indent.length).trim() && /\s$/.test(prefix)) m.breakBefore = `\\\n${" ".repeat(indent.length)}`;
	}
	output = compose();
	// A fallback can itself change subsequent wrapping. Recheck until stable.
	while ((split = splitPills(output)).size) {
		for (const m of matches) if (split.has(m.pill)) m.capped = false;
		output = compose();
	}
	return output;
}
