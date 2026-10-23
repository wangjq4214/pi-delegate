import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { skillAutocomplete } from "./autocomplete.ts";
import { availableSkills, injectSkills } from "./skills.ts";

export default function dollarSkills(pi: ExtensionAPI): void {
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
			const text = await injectSkills(event.text, skills());
			return text === event.text
				? { action: "continue" }
				: { action: "transform", text, images: event.images };
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
