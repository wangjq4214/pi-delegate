import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillAutocomplete } from "./autocomplete.ts";
import { createSkillMessage, registerSkillMessages } from "./skill-message.ts";
import { availableSkills, loadSkills, skillPrompt } from "./skills.ts";

export default function dollarSkills(pi: ExtensionAPI): void {
	registerSkillMessages(pi);
	const skills = () => availableSkills(pi.getCommands());
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (typeof ctx.ui.addAutocompleteProvider !== "function") {
			ctx.ui.notify(
				"pi-dollar-skills requires Pi 1.4.0+ for dollar autocomplete. Update Pi; the editor was left unchanged.",
				"warning",
			);
			return;
		}
		ctx.ui.addAutocompleteProvider((current) =>
			skillAutocomplete(current, skills),
		);
	});
	pi.on("input", async (event, ctx) => {
		// Commands and shell requests retain their host-owned semantics.
		if (/^\s*[!/]/.test(event.text)) return { action: "continue" };
		try {
			const loaded = await loadSkills(event.text, skills());
			if (!loaded.length) return { action: "continue" };
			if (ctx.mode === "tui" && loaded.length > 1) {
				// The host parses only one skill per ordinary User message. A
				// public custom renderer composes native cards without UI patches.
				pi.sendMessage(createSkillMessage(event.text, loaded, event.images), {
					triggerTurn: true,
					deliverAs: event.streamingBehavior,
				});
				return { action: "handled" };
			}
			return {
				action: "transform",
				text: skillPrompt(event.text, loaded),
				images: event.images,
			};
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
			// Never send partially loaded skill context or overwrite a newer draft.
			if (
				event.source === "interactive" &&
				ctx.mode === "tui" &&
				!ctx.ui.getEditorText()
			)
				ctx.ui.setEditorText(event.text);
			return { action: "handled" };
		}
	});
}
