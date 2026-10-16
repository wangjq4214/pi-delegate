import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SettingsLanguage } from "./config.ts";
import type { IconGlyphs } from "./icons.ts";
import { formatDuration, sanitizeStatus, stripAnsi } from "./utils.ts";
import { fallbackSpinner, workingSpinner } from "./spinner.ts";

export const MAX_THINKING_TITLES = 4;

export type PeekPhase = "idle" | "thinking" | "done";
export type ThinkingOutcome = "completed" | "interrupted" | "failed" | "ended";
export interface PeekState {
	phase: PeekPhase;
	titles: string[];
	elapsedMs?: number;
	outcome?: ThinkingOutcome;
}
export interface PeekMessageParts { thinking: string; text: string }

function cleanTitle(text: string): string {
	return sanitizeStatus(text.replace(/`/g, "").replace(/\*\*(.*?)\*\*/g, "$1"));
}

/** Parse cumulative source, not deltas: a partial heading replaces itself instead of adding token nodes. */
export function extractThinkingTitles(thinking: string): string[] {
	const titles: string[] = [];
	let fence: { char: string; length: number } | undefined;
	for (const line of stripAnsi(thinking).split("\n")) {
		const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
		if (fence) {
			if (marker && marker[1]![0] === fence.char && marker[1]!.length >= fence.length && !marker[2]!.trim()) fence = undefined;
			continue;
		}
		if (marker) {
			fence = { char: marker[1]![0]!, length: marker[1]!.length };
			continue;
		}
		// Indented/quoted examples are not reasoning headings.
		if (/^(?: {4}|\t|\s*>)/.test(line)) continue;
		const raw = line.trim();
		const heading = /^#{1,6}[ \t]+(.+)$/.exec(raw);
		const step = /^(?:Step|Phase|步骤|阶段)\s*[\d一二三四五六七八九十]+(?:\s*[:：.、)\]]\s*.+|\s+.+)?$/i.test(raw);
		const bold = /^\*\*([^\s*](?:.*[^\s*])?)\*\*$/.exec(raw);
		const boldTitle = bold && !bold[1]!.includes("**") ? cleanTitle(bold[1]!) : "";
		const title = heading ? cleanTitle(heading[1]!.replace(/\s+#+\s*$/, "")) : step ? cleanTitle(raw) : boldTitle;
		if (!title || titles.at(-1) === title) continue;
		titles.push(title);
		if (titles.length > MAX_THINKING_TITLES) titles.shift();
	}
	return titles;
}

export function createPeekState(): PeekState {
	return { phase: "idle", titles: [] };
}

export function collectPeekParts(content: unknown): PeekMessageParts {
	let thinking = "";
	let text = "";
	if (!Array.isArray(content)) return { thinking, text };
	for (const rawPart of content) {
		if (!rawPart || typeof rawPart !== "object") continue;
		const part = rawPart as { type?: unknown; thinking?: unknown; text?: unknown };
		if (part.type === "thinking") {
			thinking += typeof part.thinking === "string" ? part.thinking : typeof part.text === "string" ? part.text : "";
		} else if (part.type === "text" && typeof part.text === "string") text += part.text;
	}
	return { thinking, text };
}

export function reducePeek(prev: PeekState, parts: PeekMessageParts, elapsedMs?: number): PeekState {
	if (prev.phase === "done") return prev;
	let phase: PeekPhase = prev.phase;
	if (parts.thinking && phase === "idle") phase = "thinking";
	if (parts.text && phase === "thinking") phase = "done";
	return {
		phase,
		titles: parts.thinking ? extractThinkingTitles(parts.thinking) : prev.titles,
		elapsedMs: elapsedMs ?? prev.elapsedMs,
		outcome: phase === "done" ? "completed" : undefined,
	};
}

/** Fixed metadata wins over titles. Even a CJK title cannot push the timer off-screen. */
function statusLine(prefix: string, title: string, time: string, width: number): string {
	const suffix = time ? ` · ${time}` : "";
	const budget = width - visibleWidth(prefix + suffix) - 1;
	const clipped = budget > 0 ? truncateToWidth(sanitizeStatus(title), budget, "…") : "";
	return truncateToWidth(`${prefix}${clipped ? ` ${clipped}` : ""}${suffix}`, width, "…");
}

export function buildPeekLabel(
	state: PeekState,
	frame: number,
	glyphs: IconGlyphs,
	width: number,
	language: SettingsLanguage = "en",
	nativeSpinner?: string,
): string {
	const w = Math.max(1, Math.floor(width));
	const ascii = glyphs.thinking === "~";
	const spin = nativeSpinner === undefined ? fallbackSpinner(frame, ascii) : workingSpinner(nativeSpinner, ascii);
	const time = state.elapsedMs !== undefined ? formatDuration(state.elapsedMs, "precise") : "";
	const titles = state.titles.map(cleanTitle).filter(Boolean).slice(-MAX_THINKING_TITLES);
	if (state.phase === "done") {
		const mark = { completed: glyphs.done, interrupted: glyphs.interrupted, failed: glyphs.failed, ended: glyphs.ended }[state.outcome ?? "ended"];
		return statusLine(`${glyphs.thinking} ${mark}`, titles.at(-1) ?? "", time, w);
	}
	const label = language === "zh" ? "思考" : "Thinking";
	const root = statusLine(`${glyphs.thinking}${titles.length || !spin ? "" : ` ${spin}`}`, label, time, w);
	if (state.phase !== "thinking") return root;
	return [root, ...titles.map((title, index) => {
		const latest = index === titles.length - 1;
		const branch = ascii ? latest ? "`-" : "+-" : latest ? "└─" : "├─";
		return truncateToWidth(`${branch} ${latest && spin ? `${spin} ` : ""}${title}`, w, "…");
	})].join("\n");
}
