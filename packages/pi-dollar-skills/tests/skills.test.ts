import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { skillAutocomplete } from "../src/autocomplete.ts";
import {
	completionToken,
	injectSkills,
	type Skill,
	skillTokens,
} from "../src/skills.ts";

const skills: Skill[] = [
	{
		name: "grimoire-review",
		description: "Review changes",
		path: "/review/SKILL.md",
	},
	{
		name: "grimoire-test",
		description: "Test changes",
		path: "/test/SKILL.md",
	},
];
const options = () => ({ signal: new AbortController().signal });

test("references are exact prose tokens with stable UTF-16 offsets", () => {
	const text = "用 $grimoire-review 和 $grimoire-test。\n$grimoire-review";
	expect(
		skillTokens(text).map(({ name, start, end }) => [
			name,
			text.slice(start, end),
		]),
	).toEqual([
		["grimoire-review", "$grimoire-review"],
		["grimoire-test", "$grimoire-test"],
		["grimoire-review", "$grimoire-review"],
	]);
});

test("code, escaped text, variables and paths do not become skill references", () => {
	for (const text of [
		"`$grimoire-review`",
		"`` a ` $grimoire-review ``",
		"` unfinished $grimoire-review",
		"\\$grimoire-review",
		"```sh\n$grimoire-review\n```",
		"~~~\n$grimoire-review\n~~~",
		"```\n$grimoire-review",
		"prefix$grimoire-review",
		"$HOME",
		`\${grimoire-review}`,
		"$grimoire-review/path",
		"`code`$grimoire-review",
	]) {
		const known = skillTokens(text).filter((token) =>
			skills.some((skill) => skill.name === token.name),
		);
		expect(known, text).toEqual([]);
	}
	expect(skillTokens("```\n$ignored\n```\n$grimoire-review").at(-1)?.name).toBe(
		"grimoire-review",
	);
});

test("completion uses the current multiline cursor and ignores code/escaped tokens", () => {
	expect(completionToken(["用", "$grimoire-r tail"], 1, 11)?.name).toBe(
		"grimoire-r",
	);
	expect(completionToken(["$"], 0, 1)?.name).toBe("");
	expect(completionToken(["```", "$"], 1, 1)).toBeUndefined();
	expect(completionToken(["\\$"], 0, 2)).toBeUndefined();
});

test("full fresh content and location are injected once in first-reference order", async () => {
	const dir = await mkdtemp(join(tmpdir(), "dollar-skills-unit-"));
	try {
		const first = { ...skills[0], path: join(dir, "review.md") };
		const second = { ...skills[1], path: join(dir, "test.md") };
		await writeFile(
			first.path,
			"---\nname: grimoire-review\n---\nFULL REVIEW INSTRUCTIONS",
		);
		await writeFile(second.path, "FULL TEST INSTRUCTIONS");
		const request =
			"用 $grimoire-review 和 $grimoire-test，然后 $grimoire-review。";
		const result = await injectSkills(request, [first, second]);
		expect(result).toContain("FULL REVIEW INSTRUCTIONS");
		expect(result).toContain("FULL TEST INSTRUCTIONS");
		expect(result.indexOf("FULL REVIEW")).toBeLessThan(
			result.indexOf("FULL TEST"),
		);
		expect(result.split('<skill name="grimoire-review"')).toHaveLength(2);
		expect(result).toContain(`location="${first.path}"`);
		expect(result).toContain(`References are relative to ${dir}.`);
		expect(result.endsWith(request)).toBe(true);
		await writeFile(first.path, "UPDATED");
		expect(await injectSkills("$grimoire-review", [first])).toContain(
			"UPDATED",
		);
		expect(await injectSkills("$unknown $HOME", [first])).toBe(
			"$unknown $HOME",
		);
		await rm(first.path);
		await expect(injectSkills(request, [first, second])).rejects.toThrow(
			"Cannot load $grimoire-review",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

function baseProvider(): AutocompleteProvider {
	return {
		triggerCharacters: ["#"],
		async getSuggestions() {
			return {
				prefix: "/",
				items: [
					{ value: "/help", label: "help" },
					{ value: "/skill:grimoire-review", label: "review" },
					{ value: "skill:grimoire-test", label: "test" },
				],
			};
		},
		applyCompletion(lines, cursorLine, cursorCol) {
			return { lines, cursorLine, cursorCol };
		},
		shouldTriggerFileCompletion() {
			return false;
		},
	};
}

test("autocomplete hides skill commands only and retains other provider behavior", async () => {
	const current = baseProvider();
	const provider = skillAutocomplete(current, () => skills);
	expect(provider.triggerCharacters).toEqual(["#", "$"]);
	expect(
		(await provider.getSuggestions(["/"], 0, 1, options()))?.items.map(
			(item) => item.value,
		),
	).toEqual(["/help"]);
	expect(
		(await provider.getSuggestions(["/skill:g"], 0, 8, options()))?.items.map(
			(item) => item.value,
		),
	).toEqual(["/help"]);
	expect(
		await provider.getSuggestions(["/help argument"], 0, 14, options()),
	).toEqual(await current.getSuggestions([], 0, 0, options()));
	expect(
		(await provider.getSuggestions(["  /"], 0, 3, options()))?.items.map(
			(item) => item.value,
		),
	).toEqual(["/help"]);
	expect(
		(await provider.getSuggestions(["prose", "/"], 1, 1, options()))?.items.map(
			(item) => item.value,
		),
	).toEqual(["/help"]);
	expect(provider.shouldTriggerFileCompletion?.(["@"], 0, 1)).toBe(false);
	expect(
		provider.applyCompletion(
			["@"],
			0,
			1,
			{ value: "@file", label: "file" },
			"@",
		),
	).toEqual({ lines: ["@"], cursorLine: 0, cursorCol: 1 });
});

test("dollar candidates filter by name and insert without losing suffix or another line", async () => {
	const provider = skillAutocomplete(baseProvider(), () => skills);
	expect(
		(await provider.getSuggestions(["用 $"], 0, 3, options()))?.items,
	).toHaveLength(2);
	const result = await provider.getSuggestions(["用 $review"], 0, 9, options());
	expect(result?.items).toEqual([
		{
			value: "$grimoire-review",
			label: "$grimoire-review",
			description: "Review changes",
		},
	]);
	if (!result) throw new Error("missing skill suggestions");
	const lines = ["first", "用 $grimoire-rview 后续需求"];
	const completed = provider.applyCompletion(
		lines,
		1,
		13,
		result.items[0],
		"$grimoire-r",
	);
	expect(completed.lines).toEqual(["first", "用 $grimoire-review 后续需求"]);
	expect(lines[1]).toBe("用 $grimoire-rview 后续需求");
	expect(
		await provider.getSuggestions(["$missing"], 0, 8, options()),
	).toBeNull();
	expect(provider.shouldTriggerFileCompletion?.(["$"], 0, 1)).toBe(true);
});

test("aborted requests and a changed catalog never expose stale candidates", async () => {
	let catalog = skills;
	const provider = skillAutocomplete(baseProvider(), () => catalog);
	const controller = new AbortController();
	controller.abort();
	expect(
		await provider.getSuggestions(["$"], 0, 1, { signal: controller.signal }),
	).toBeNull();
	catalog = [];
	expect(await provider.getSuggestions(["$"], 0, 1, options())).toBeNull();
});
