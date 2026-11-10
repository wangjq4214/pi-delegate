import { visibleWidth } from "@earendil-works/pi-tui";
import type { InlineFooterLine } from "./editor.ts";

export interface StatusSegment {
	key: string;
	text: string;
	priority: number;
}

function lineWidth(line: InlineFooterLine): number {
	return visibleWidth(line.left) + visibleWidth(line.right) + (line.left && line.right ? 1 : 0);
}

/**
 * Built-ins get their existing fitter first. Statuses are indivisible, ordered
 * by descending presentation priority, then key. Only the overflow indicator
 * may reserve space from built-ins; status text never squeezes them out.
 */
export function fitStatusRow(
	items: readonly StatusSegment[],
	width: number,
	renderBuiltins: (width: number) => InlineFooterLine,
	separator: string,
	renderOverflow: (count: number) => string,
): { line: InlineFooterLine; foldedKeys: string[] } {
	const ordered = [...items].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
	let builtins = renderBuiltins(Math.max(0, width));
	const combine = (texts: string[]): InlineFooterLine => ({
		left: [builtins.left, ...texts].filter(Boolean).join(separator),
		right: builtins.right,
	});
	const full = combine(ordered.map((item) => item.text));
	if (lineWidth(full) <= width) return { line: full, foldedKeys: [] };

	const indicator = renderOverflow(ordered.length);
	const indicatorWidth = visibleWidth(indicator);
	// No clipped '+', misleading count or extra row at exceptionally tiny widths.
	if (indicatorWidth > width) return { line: builtins, foldedKeys: ordered.map((item) => item.key) };
	if (lineWidth(combine([indicator])) > width) {
		builtins = renderBuiltins(Math.max(0, width - indicatorWidth - visibleWidth(separator)));
	}

	const shown: StatusSegment[] = [];
	const foldedKeys: string[] = [];
	for (const item of ordered) {
		const remaining = ordered.length - shown.length - 1;
		const candidate = [...shown.map((segment) => segment.text), item.text];
		if (remaining > 0) candidate.push(renderOverflow(remaining));
		if (lineWidth(combine(candidate)) <= width) shown.push(item);
		else foldedKeys.push(item.key);
	}
	const texts = shown.map((item) => item.text);
	if (foldedKeys.length) texts.push(renderOverflow(foldedKeys.length));
	return { line: combine(texts), foldedKeys };
}
