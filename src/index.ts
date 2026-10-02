import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function extension(pi: ExtensionAPI): void {
	pi.registerCommand("hello", {
		description: "Show a greeting to verify the extension is loaded",
		handler: async (name, ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.notify(`Hello, ${name.trim() || "world"}!`, "info");
		},
	});
}
