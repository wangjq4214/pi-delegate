import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export interface Skill {
	name: string;
	description?: string;
	path: string;
}

export function availableSkills(commands: SlashCommandInfo[]): Skill[] {
	return commands
		.filter(
			(command) =>
				command.source === "skill" && command.name.startsWith("skill:"),
		)
		.map((command) => ({
			name: command.name.slice(6),
			description: command.description,
			path: command.sourceInfo.path,
		}));
}

/** Mask code without changing offsets, including unfinished code while editing. */
function prose(text: string): string {
	let fence: string | undefined;
	let inline = 0;
	return text
		.split(/(?<=\n)/)
		.map((line) => {
			const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/);
			if (fence) {
				if (
					marker &&
					marker[1][0] === fence[0] &&
					marker[1].length >= fence.length &&
					!marker[2].trim()
				)
					fence = undefined;
				return line.replace(/[^\r\n]/g, " ");
			}
			if (!inline && marker) {
				fence = marker[1];
				return line.replace(/[^\r\n]/g, " ");
			}
			let result = "";
			for (let i = 0; i < line.length; ) {
				if (line[i] === "\\" && !inline && i + 1 < line.length) {
					result += "  ";
					i += 2;
				} else if (line[i] === "`") {
					let end = i + 1;
					while (line[end] === "`") end++;
					const length = end - i;
					if (!inline) inline = length;
					else if (inline === length) inline = 0;
					result += " ".repeat(length);
					i = end;
				} else {
					result += inline && !/[\r\n]/.test(line[i]) ? " " : line[i];
					i++;
				}
			}
			return result;
		})
		.join("");
}

export interface SkillToken {
	name: string;
	start: number;
	end: number;
}

/** Only whitespace-delimited dollar names in prose; not shell/path interpolation. */
export function skillTokens(text: string): SkillToken[] {
	const visible = prose(text);
	return [
		...text.matchAll(/(?<!\S)\$([a-z0-9-]*)(?=$|[\s,.;:!?，。；：！？)\]}])/g),
	]
		.filter(
			(match) =>
				visible.slice(match.index, match.index + match[0].length) === match[0],
		)
		.map((match) => ({
			name: match[1],
			start: match.index,
			end: match.index + match[0].length,
		}));
}

export function completionToken(
	lines: string[],
	line: number,
	col: number,
): SkillToken | undefined {
	const before = [
		...lines.slice(0, line),
		(lines[line] ?? "").slice(0, col),
	].join("\n");
	const token = skillTokens(before).at(-1);
	return token?.end === before.length ? token : undefined;
}

function attribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

export interface LoadedSkill extends Skill {
	content: string;
}

/** Read every selected skill before committing any input or UI change. */
export async function loadSkills(
	text: string,
	skills: Skill[],
): Promise<LoadedSkill[]> {
	const catalog = new Map(skills.map((skill) => [skill.name, skill]));
	const selected = [...new Set(skillTokens(text).map((token) => token.name))]
		.map((name) => catalog.get(name))
		.filter((skill): skill is Skill => skill !== undefined);
	return Promise.all(
		selected.map(async (skill) => {
			try {
				return { ...skill, content: await readFile(skill.path, "utf8") };
			} catch (cause) {
				throw new Error(`Cannot load $${skill.name} from ${skill.path}`, {
					cause,
				});
			}
		}),
	);
}

export function skillBlock(skill: LoadedSkill): string {
	return `<skill name="${attribute(skill.name)}" location="${attribute(skill.path)}">\nReferences are relative to ${dirname(skill.path)}.\n\n${skill.content}\n</skill>`;
}

export function skillPrompt(text: string, skills: LoadedSkill[]): string {
	return skills.length
		? `${skills.map(skillBlock).join("\n\n")}\n\n${text}`
		: text;
}

export async function injectSkills(
	text: string,
	skills: Skill[],
): Promise<string> {
	return skillPrompt(text, await loadSkills(text, skills));
}
