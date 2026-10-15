import type { Theme, ToolRenderers, CodemodeToolDetails } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { resolveGlyphs, type IconMode } from "./icons.ts";

export type Result = Parameters<NonNullable<ToolRenderers["renderResult"]>>[0];
type Child = CodemodeToolDetails["calls"][number];
export type Status = Child["status"] | "pending";
const CHILD_ROWS = 5;
const OUTPUT_LINES = 3;

// This policy consumes presentation evidence only: no renderer callbacks, components,
// shared host state, live clocks or capability probes. The composer owns those effects.
export function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function finite(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
export function clean(text: string): string {
	// Never allow untrusted arguments/output to inject terminal controls into a summary.
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
function duration(ms: number | undefined): string {
	return ms === undefined ? "" : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
export function textOutput(result: Result): string {
	return result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}
export function truncateSummary(text: string, width: number): string {
	// Reset summary text styles around the ellipsis without clearing the host background.
	// Only apply this to our own lines; composed third-party components stay untouched.
	return truncateToWidth(text, width).replace(/\x1b\[0m/g, "\x1b[22;23;24;25;27;28;29;39m");
}

/** Strictly validate the available host metadata; never infer child status from output. */
export function codemodeCalls(details: unknown): Child[] | undefined {
	if (!record(details) || !Array.isArray(details.calls)) return undefined;
	if (details.fullOutputPath !== undefined && typeof details.fullOutputPath !== "string") return undefined;
	if (!details.calls.every((call: unknown) => record(call)
		&& typeof call.id === "string" && typeof call.name === "string" && typeof call.args === "string"
		&& ["running", "ok", "error", "cancelled"].includes(String(call.status))
		&& (call.durationMs === undefined || finite(call.durationMs))
		&& (call.cost === undefined || finite(call.cost))
		&& (call.error === undefined || typeof call.error === "string"))) return undefined;
	return details.calls as Child[];
}
export function selectChildren(calls: readonly Child[], budget = CHILD_ROWS): { shown: Child[]; hidden: Child[] } {
	const priority = calls.filter((call) => call.status !== "ok");
	const selected = new Set([...priority, ...calls.filter((call) => call.status === "ok")].slice(0, budget));
	return { shown: calls.filter((call) => selected.has(call)), hidden: calls.filter((call) => !selected.has(call)) };
}
function counts(calls: readonly Child[]): string {
	return (["running", "ok", "error", "cancelled"] as const)
		.map((status) => ({ status, count: calls.filter((call) => call.status === status).length }))
		.filter(({ count }) => count > 0).map(({ status, count }) => `${count} ${status}`).join(", ");
}
function target(name: string, args: unknown): string | undefined {
	if (!record(args)) return undefined;
	if (name === "codemode") return typeof args.code === "string" ? "script" : undefined;
	if (name === "bash") return typeof args.command === "string" ? args.command : undefined;
	if (name === "grep" || name === "find") {
		return typeof args.pattern === "string" && (args.path === undefined || typeof args.path === "string")
			? `${args.pattern}${args.path ? ` in ${args.path}` : ""}` : undefined;
	}
	if (name === "ls") return args.path === undefined ? "." : typeof args.path === "string" ? args.path : undefined;
	if (typeof args.path !== "string") return undefined;
	if (name === "edit" && !(Array.isArray(args.edits) && args.edits.length > 0
		&& args.edits.every((edit) => record(edit) && typeof edit.oldText === "string" && typeof edit.newText === "string"))
		&& !(typeof args.oldText === "string" && typeof args.newText === "string")) return undefined;
	if (name === "write" && typeof args.content !== "string") return undefined;
	if (name === "read" && ((args.offset !== undefined && !finite(args.offset)) || (args.limit !== undefined && !finite(args.limit)))) return undefined;
	return args.path;
}

// Keep generic summaries bounded without interpreting keys as paths, commands or outcomes.
function argumentPreview(value: unknown, depth = 0): unknown {
	if (typeof value === "string") return clean(value).slice(0, 160) + (value.length > 160 ? "…" : "");
	if (value === null || typeof value !== "object") return value;
	if (depth >= 2) return Array.isArray(value) ? "[…]" : "{…}";
	if (Array.isArray(value)) return [...value.slice(0, 6).map((item) => argumentPreview(item, depth + 1)), ...(value.length > 6 ? ["…"] : [])];
	const entries = Object.entries(value);
	return Object.fromEntries([
		...entries.slice(0, 6).map(([key, item]) => [clean(key), argumentPreview(item, depth + 1)]),
		...(entries.length > 6 ? [["…", "…"]] : []),
	]);
}
export function argumentsText(args: unknown, expanded = false): string {
	try { return JSON.stringify(expanded ? args : argumentPreview(args), null, expanded ? 2 : undefined) ?? ""; }
	catch { return "[arguments unavailable]"; }
}

/** Recognition enables semantic previews, never eligibility for generic presentation. */
export function toolPolicy(name: string, args: unknown, recognized: boolean, result?: Result): { special: boolean; calls?: Child[] } {
	if (!recognized || target(name, args) === undefined) return { special: false };
	const calls = name === "codemode" && result ? codemodeCalls(result.details) : undefined;
	const special = !(name === "codemode" && result && !calls);
	return { special, calls: special && name === "codemode" ? calls : undefined };
}
export function statusColor(status: Status): "error" | "success" | "warning" {
	return status === "error" ? "error" : status === "ok" ? "success" : "warning";
}
function statusText(status: Status, theme: Theme, icons: IconMode): string {
	const glyphs = resolveGlyphs(icons);
	const icon = status === "ok" ? glyphs.done : status === "error" ? glyphs.failed
		: status === "cancelled" ? glyphs.interrupted : glyphs.working;
	return theme.fg(statusColor(status), `${icon} ${status}`);
}
export function renderCallSummary(input: {
	name: string; args: unknown; special: boolean; result?: Result; hideOutput?: boolean;
	isPartial: boolean; isError: boolean; status: Status; elapsedMs?: number; scriptHint: string;
}, theme: Theme, icons: IconMode, width: number): string[] {
	const { name, args, special, result, isPartial, isError, status, elapsedMs, scriptHint } = input;
	const value = special ? target(name, args)! : argumentsText(args);
	const summary = !input.hideOutput && !(special && name === "codemode") && result && !isPartial
		? clean(textOutput(result).split("\n").find((line) => line.trim()) ?? "") : "";
	const time = duration(elapsedMs);
	const title = `${statusText(status, theme, icons)} ${theme.fg("toolTitle", clean(name))}${value ? ` ${theme.bold(theme.fg("accent", clean(value)))}` : ""}`;
	const suffix = time && width >= 16 ? ` ${theme.fg("dim", time)}` : "";
	const line = truncateSummary(`${title}${summary ? ` · ${theme.fg(isError ? "error" : "muted", summary)}` : ""}`, Math.max(1, width - visibleWidth(suffix))) + suffix;
	return [line, ...(special && name === "codemode" && !result ? [truncateSummary(theme.fg("dim", scriptHint), width)] : [])];
}
export function renderChildActivity(calls: readonly Child[] | undefined, theme: Theme, icons: IconMode, width: number): string[] {
	if (!calls) return [];
	const lines = wrapTextWithAnsi(theme.fg("muted", `Observed ${calls.length} calls${calls.length ? `: ${counts(calls)}` : ""}`), Math.max(1, width));
	const { shown, hidden } = selectChildren(calls);
	for (const call of shown) {
		const time = duration(call.durationMs);
		const cost = call.cost === undefined ? "" : ` $${call.cost.toPrecision(3)}`;
		lines.push(`  ${statusText(call.status, theme, icons)} ${theme.fg("toolTitle", clean(call.name))} ${clean(call.args)}${time ? ` ${theme.fg("dim", time)}` : ""}${theme.fg("dim", cost)}`);
		if (call.error) lines.push(theme.fg("error", `    ${clean(call.error)}`));
	}
	if (hidden.length) lines.push(...wrapTextWithAnsi(theme.fg("warning", `Hidden ${hidden.length}: ${counts(hidden)} — expand for all records`), Math.max(1, width)));
	return lines;
}

type CompactContent = { kind: "diff"; diff: string } | { kind: "native-edit" } | { kind: "output"; lines: string[] };
/** Explicitly leave native edit fallback to the composer; pure previews never call it. */
export function compactContent(name: string, special: boolean, result: Result, isPartial: boolean, isError: boolean, calls: readonly Child[] | undefined): CompactContent {
	if (special && name === "edit") {
		const details = record(result.details) ? result.details : {};
		return !isError && typeof details.diff === "string" ? { kind: "diff", diff: details.diff } : { kind: "native-edit" };
	}
	const lines: string[] = [];
	if (!isPartial || isError) {
		let output = textOutput(result);
		if (calls) output = output.replace(/^Script (?:completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/, "");
		const preview = output.split("\n").filter((line) => line.trim()).slice(0, OUTPUT_LINES);
		lines.push(...preview.map(clean));
		if (isError && !calls) {
			const tail = output.split("\n").reverse().find((line) => line.trim());
			if (tail && !preview.includes(tail)) lines.push(clean(tail));
		}
		if (isError && calls) {
			const errorIndex = output.lastIndexOf("Script error:");
			if (errorIndex >= 0) lines.push(clean(output.slice(errorIndex)));
		}
	}
	return { kind: "output", lines };
}
/** Budget rendered diff rows, not source lines, so narrow-width wrapping stays native. */
export function compactDiffLines(diff: readonly string[], theme: Theme): string[] {
	return [...diff.slice(0, 6), ...(diff.length > 6 ? [theme.fg("dim", "More diff — expand for details")] : [])];
}
export function defaultOutputLines(result: Result, expanded: boolean): string[] {
	const output = textOutput(result).split("\n").map(clean);
	if (expanded) return output;
	const lines = output.slice(0, OUTPUT_LINES);
	if (output.length > OUTPUT_LINES) lines.push("More output — expand for details");
	return lines;
}
const LIMIT_NOTICE_KEYS = ["matchLimitReached", "resultLimitReached", "entryLimitReached", "linesTruncated"];
const TEXT_NOTICE = /^\[(?:Output truncated|Truncated:|First line exceeds|Showing |Full output|.*(?:truncated|full output (?:saved|written)))/i;

/** A presentation-only copy: native/custom previews must not reintroduce folded notices. */
export function withoutResultNotices(result: Result): Result {
	const details = record(result.details) ? { ...result.details } : result.details;
	if (record(details)) for (const key of ["truncation", "fullOutputPath", ...LIMIT_NOTICE_KEYS]) delete details[key];
	return {
		...result, details,
		content: result.content.map((part) => part.type === "text"
			? { ...part, text: part.text.split("\n").filter((line) => !TEXT_NOTICE.test(clean(line).trimStart())).join("\n") }
			: part),
	};
}

export function renderNotices(result: Result, theme: Theme, width: number): string[] {
	const details = record(result.details) ? result.details : {};
	const lines: string[] = [];
	if (record(details.truncation) && details.truncation.truncated === true) lines.push("Output truncated by host");
	for (const key of LIMIT_NOTICE_KEYS) {
		if (details[key]) lines.push(`Host truncation: ${key} = ${details[key]}`);
	}
	if (typeof details.fullOutputPath === "string") lines.push(`Full output: ${clean(details.fullOutputPath)}`);
	// Known native notices may be in a tail rather than structured details (read/grep/bash).
	for (const line of textOutput(result).split("\n")) {
		if (TEXT_NOTICE.test(line)) lines.push(clean(line));
	}
	// Paths/notices wrap rather than ellipsize: a hidden tail must not hide file access.
	return [...new Set(lines)].flatMap((line) => wrapTextWithAnsi(theme.fg("warning", line), Math.max(1, width)));
}
export function expansionHint(calls: readonly Child[] | undefined, keyHint: string): string {
	return `${keyHint} · ${calls ? "script, output & host child summaries (no raw child results)" : "arguments & result"}`;
}
export const CHILD_SUMMARY_NOTE = "Child records are host summaries (arguments/errors may be truncated); raw child results are not retained.";
