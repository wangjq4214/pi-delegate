import { Type } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const thinkingLevels = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];
export interface ModelIdentity {
	provider: string;
	id: string;
}
export interface TaskConfiguration {
	model: ModelIdentity;
	thinkingLevel: ThinkingLevel;
}
export interface ConfigurationDetails {
	requested: TaskConfiguration;
	effective?: TaskConfiguration;
}
export const modelParameter = Type.Object(
	{
		provider: Type.String({ minLength: 1 }),
		id: Type.String({ minLength: 1 }),
	},
	{
		additionalProperties: false,
		description:
			"Exact configured provider/model ID. Omitted inherits the current parent model; no fuzzy matching or fallback.",
	},
);
export const thinkingParameter = Type.Union(
	thinkingLevels.map((level) => Type.Literal(level)),
	{
		description:
			"Requested Pi thinking level. Omitted independently inherits the parent level; Pi adjusts it to the target model and results disclose the effective level.",
	},
);

function identity(value: unknown): value is ModelIdentity {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).every((key) => key === "provider" || key === "id") &&
		typeof (value as ModelIdentity).provider === "string" &&
		!!(value as ModelIdentity).provider.trim() &&
		typeof (value as ModelIdentity).id === "string" &&
		!!(value as ModelIdentity).id.trim()
	);
}
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return thinkingLevels.some((level) => level === value);
}
export function validateSelection(
	model: unknown,
	thinkingLevel: unknown,
): void {
	if (model !== undefined && !identity(model))
		throw new Error("model must contain exact provider and id strings only");
	if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel))
		throw new Error("thinkingLevel must be a Pi thinking level");
}
export function captureConfiguration(
	ctx: Pick<ExtensionContext, "model" | "thinkingLevel" | "modelRegistry">,
	model?: ModelIdentity,
	thinkingLevel?: ThinkingLevel,
): TaskConfiguration {
	validateSelection(model, thinkingLevel);
	const selected = model ?? ctx.model;
	if (!selected) throw new Error("Delegation requires a selected model");
	if (!ctx.modelRegistry.find(selected.provider, selected.id))
		throw new Error(`Unknown exact model: ${selected.provider}/${selected.id}`);
	const level = thinkingLevel ?? ctx.thinkingLevel;
	if (!isThinkingLevel(level))
		throw new Error("Unable to capture parent thinkingLevel");
	return {
		model: { provider: selected.provider, id: selected.id },
		thinkingLevel: level,
	};
}
