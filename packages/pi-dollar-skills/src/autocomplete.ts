import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { completionToken, type Skill } from "./skills.ts";

export function skillAutocomplete(
	current: AutocompleteProvider,
	getSkills: () => Skill[],
): AutocompleteProvider {
	return {
		triggerCharacters: [
			...new Set([...(current.triggerCharacters ?? []), "$"]),
		],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			if (options.signal.aborted) return null;
			const token = /^\s*[!/]/.test(lines.join("\n"))
				? undefined
				: completionToken(lines, cursorLine, cursorCol);
			if (token) {
				const items = getSkills()
					.filter((skill) => skill.name.includes(token.name))
					.map((skill) => ({
						value: `$${skill.name}`,
						label: `$${skill.name}`,
						description: skill.description,
					}));
				return items.length ? { items, prefix: `$${token.name}` } : null;
			}
			const result = await current.getSuggestions(
				lines,
				cursorLine,
				cursorCol,
				options,
			);
			if (options.signal.aborted || !result) return null;
			// Filter only the command token, not command arguments or file completion.
			if (
				options.force ||
				!/^\/[^\s/]*$/.test(
					(lines[cursorLine]?.slice(0, cursorCol) ?? "").trimStart(),
				)
			)
				return result;
			const skillCommands = new Set(
				getSkills().map((skill) => `skill:${skill.name}`),
			);
			const items = result.items.filter(
				(item) => !skillCommands.has(item.value.replace(/^\//, "")),
			);
			return items.length ? { ...result, items } : null;
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith("$"))
				return current.applyCompletion(
					lines,
					cursorLine,
					cursorCol,
					item,
					prefix,
				);
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			// Replace the whole name even when accepting completion in the middle of a token.
			const after = line.slice(cursorCol).replace(/^[a-z0-9-]*/, "");
			const value = item.value + (after.startsWith(" ") ? "" : " ");
			const next = [...lines];
			next[cursorLine] = before + value + after;
			return {
				lines: next,
				cursorLine,
				cursorCol: before.length + value.length,
			};
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			// Tab is also used to request dollar completion by the native editor.
			return (
				completionToken(lines, cursorLine, cursorCol) !== undefined ||
				(current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
					true)
			);
		},
	};
}
