import type { ExtensionToolContext } from "@earendil-works/pi-coding-agent";

// Controlled parent registry for tool-registration tests; no provider or auth state.
export const configurationContext = {
	model: { provider: "fixture", id: "fixture-model" },
	thinkingLevel: "off",
	modelRegistry: {
		find: (provider: string, id: string) =>
			provider === "fixture" && id === "fixture-model"
				? { provider, id }
				: undefined,
	},
} as unknown as Pick<
	ExtensionToolContext,
	"model" | "thinkingLevel" | "modelRegistry"
>;
