import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { IconMode } from "./icons.ts";

export type SettingsLanguage = "en" | "zh";
export type CursorStyle = "block" | "bar" | "underline";
export type EditorBorderStyle = "surround" | "minimal";
export type MessageLayout = "normal" | "compact";
export type ThinkingPeekLines = 0 | 1 | 2;
export type ToolBoxBorderStyle = "single" | "bold" | "double" | "dashed" | "custom";
export type ToolBoxBorderColorMode = "status" | "static";

export interface ToolBoxBorderEdgeConfig {
	enabled: boolean;
	char?: string;
}

export interface ToolBoxBorderConfig {
	enabled: boolean;
	style: ToolBoxBorderStyle;
	colorMode: ToolBoxBorderColorMode;
	color?: string;
	top: ToolBoxBorderEdgeConfig;
	bottom: ToolBoxBorderEdgeConfig;
	left: ToolBoxBorderEdgeConfig;
	right?: ToolBoxBorderEdgeConfig;
}
export interface UserBoxBorderConfig extends Omit<ToolBoxBorderConfig, "colorMode"> {
	colorMode: "theme" | "static";
}

export const DEFAULT_USER_BORDER: UserBoxBorderConfig = {
	enabled: false, style: "bold", colorMode: "theme",
	top: { enabled: false }, bottom: { enabled: false },
	left: { enabled: true }, right: { enabled: false },
};

export type { IconMode } from "./icons.ts";

export interface FooterSegments {
	cwd: boolean;
	hostname: boolean;
	sessionName: boolean;
	gitBranch: boolean;
	gitStatus: boolean;
	gitCommit: boolean;
	runtime: boolean;
	context: boolean;
	tokens: boolean;
	cost: boolean;
	extensionStatuses: boolean;
	capitalizeProviderName: boolean;
}

export interface TelemetryConfig {
	enabled: boolean;
	tps: boolean;
	ttft: boolean;
	duration: boolean;
	tokens: boolean;
	stalls: boolean;
	cost: boolean;
}

export interface ThinkingPeekConfig {
	/** Legacy storage: 0 is Off, 1/2 are On. This is no longer a body-row budget. */
	lines: ThinkingPeekLines;
}

export interface WorklineConfig {
	marquee: boolean;
	attachToBorder: boolean;
}

export interface OpenTuiConfig {
	enabled: boolean;
	inlineFooter: boolean;
	toolPresentation: boolean;
	settingsLanguage: SettingsLanguage;
	cursorStyle: CursorStyle;
	editorBorderStyle: EditorBorderStyle;
	messageLayout: MessageLayout;
	/** Independent selections; omitted legacy fields inherit messageLayout in memory only. */
	userMessageLayout?: MessageLayout;
	toolMessageLayout?: MessageLayout;
	userBoxBorder?: UserBoxBorderConfig;
	icons: {
		mode: IconMode;
	};
	footerSegments: FooterSegments;
	telemetry: TelemetryConfig;
	thinkingPeek: ThinkingPeekConfig;
	workline: WorklineConfig;
	toolBoxBorder: ToolBoxBorderConfig;
}

export const LEGACY_DEFAULT_CONFIG: OpenTuiConfig = {
	enabled: true,
	inlineFooter: false,
	toolPresentation: true,
	settingsLanguage: "en",
	cursorStyle: "block",
	editorBorderStyle: "surround",
	messageLayout: "normal",
	icons: {
		mode: "auto",
	},
	footerSegments: {
		cwd: true,
		hostname: false,
		sessionName: false,
		gitBranch: true,
		gitStatus: true,
		gitCommit: false,
		runtime: true,
		context: true,
		tokens: true,
		cost: true,
		extensionStatuses: true,
		capitalizeProviderName: true,
	},
	telemetry: {
		enabled: true,
		tps: true,
		ttft: true,
		duration: true,
		tokens: true,
		stalls: true,
		cost: true,
	},
	workline: {
		marquee: true,
		attachToBorder: true,
	},
	thinkingPeek: {
		lines: 1,
	},
	toolBoxBorder: {
		enabled: false,
		style: "single",
		colorMode: "status",
		top: {
			enabled: true,
		},
		bottom: {
			enabled: true,
		},
		left: {
			enabled: true,
		},
	},
};

/** New installs only. Existing files normalize against the historical defaults above. */
export const DEFAULT_CONFIG: OpenTuiConfig = {
	...structuredClone(LEGACY_DEFAULT_CONFIG),
	cursorStyle: "bar", editorBorderStyle: "minimal", messageLayout: "compact",
	userMessageLayout: "compact", toolMessageLayout: "compact",
	userBoxBorder: structuredClone(DEFAULT_USER_BORDER),
	workline: { marquee: true, attachToBorder: false },
	toolBoxBorder: {
		enabled: false, style: "double", colorMode: "status",
		top: { enabled: true }, bottom: { enabled: false },
		left: { enabled: true }, right: { enabled: false },
	},
};

export function getUserMessageLayout(config: OpenTuiConfig): MessageLayout {
	return config.userMessageLayout ?? config.messageLayout;
}
export function getToolMessageLayout(config: OpenTuiConfig): MessageLayout {
	return config.toolMessageLayout ?? config.messageLayout;
}
export function getUserBoxBorder(config: OpenTuiConfig): UserBoxBorderConfig {
	return config.userBoxBorder ?? DEFAULT_USER_BORDER;
}

export function getConfigPath(): string {
	const agentDir = getAgentDir();
	return join(agentDir, "open-tui.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate known fields against their defaults; retain unknown fields for legacy settings. */
function normalizeFields<T extends object>(defaults: T, value: unknown): T {
	const input = isRecord(value) ? value : {};
	const result: Record<string, unknown> = { ...input };
	for (const [key, fallback] of Object.entries(defaults)) {
		const candidate = input[key];
		result[key] = isRecord(fallback)
			? normalizeFields(fallback, candidate)
			: typeof candidate === typeof fallback ? candidate : fallback;
	}
	return result as T;
}

function enumValue<T>(value: unknown, choices: readonly T[], fallback: T): T {
	return choices.includes(value as T) ? value as T : fallback;
}

function normalizeConfig(value: unknown): OpenTuiConfig {
	const config = normalizeFields(LEGACY_DEFAULT_CONFIG, value);
	config.settingsLanguage = enumValue(config.settingsLanguage, ["en", "zh"], LEGACY_DEFAULT_CONFIG.settingsLanguage);
	config.cursorStyle = enumValue(config.cursorStyle, ["block", "bar", "underline"], LEGACY_DEFAULT_CONFIG.cursorStyle);
	config.editorBorderStyle = enumValue(config.editorBorderStyle, ["surround", "minimal"], LEGACY_DEFAULT_CONFIG.editorBorderStyle);
	config.messageLayout = enumValue(config.messageLayout, ["normal", "compact"], LEGACY_DEFAULT_CONFIG.messageLayout);
	config.icons.mode = enumValue(config.icons.mode, ["auto", "nerd", "unicode", "ascii"], LEGACY_DEFAULT_CONFIG.icons.mode);
	config.thinkingPeek.lines = enumValue(config.thinkingPeek.lines, [0, 1, 2], LEGACY_DEFAULT_CONFIG.thinkingPeek.lines);
	if (config.toolBoxBorder) {
		config.toolBoxBorder.style = enumValue(config.toolBoxBorder.style, ["single", "bold", "double", "dashed", "custom"], LEGACY_DEFAULT_CONFIG.toolBoxBorder.style);
		config.toolBoxBorder.colorMode = enumValue(config.toolBoxBorder.colorMode, ["status", "static"], LEGACY_DEFAULT_CONFIG.toolBoxBorder.colorMode);
		if (config.toolBoxBorder.color !== undefined && typeof config.toolBoxBorder.color !== "string") delete config.toolBoxBorder.color;
		if (config.toolBoxBorder.top?.char !== undefined && typeof config.toolBoxBorder.top.char !== "string") delete config.toolBoxBorder.top.char;
		if (config.toolBoxBorder.bottom?.char !== undefined && typeof config.toolBoxBorder.bottom.char !== "string") delete config.toolBoxBorder.bottom.char;
		if (config.toolBoxBorder.left?.char !== undefined && typeof config.toolBoxBorder.left.char !== "string") delete config.toolBoxBorder.left.char;
	}
	for (const field of ["userMessageLayout", "toolMessageLayout"] as const) {
		if (Object.hasOwn(config, field)) config[field] = enumValue(config[field], ["normal", "compact"], config.messageLayout);
	}
	if (Object.hasOwn(config, "userBoxBorder")) {
		config.userBoxBorder = normalizeFields(DEFAULT_USER_BORDER, config.userBoxBorder);
		config.userBoxBorder.style = enumValue(config.userBoxBorder.style, ["single", "bold", "double", "dashed", "custom"], DEFAULT_USER_BORDER.style);
		config.userBoxBorder.colorMode = enumValue(config.userBoxBorder.colorMode, ["theme", "static"], "theme");
	}
	for (const border of [config.toolBoxBorder, config.userBoxBorder]) {
		if (!border) continue;
		if (border.color !== undefined && typeof border.color !== "string") delete border.color;
		if (border.right !== undefined) border.right = normalizeFields({ enabled: false }, border.right);
		for (const edge of [border.top, border.bottom, border.left, border.right]) {
			if (edge?.char !== undefined && typeof edge.char !== "string") delete edge.char;
		}
	}
	return config;
}

export function ensureConfigExists(): void {
	const path = getConfigPath();
	if (existsSync(path)) return;
	mkdirSync(getAgentDir(), { recursive: true });
	try {
		writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
	} catch (error) {
		// A concurrent instance may have created the config; never overwrite it.
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export function loadConfig(notify?: (msg: string, level: "warning" | "info") => void): OpenTuiConfig {
	const fallback = existsSync(getConfigPath()) ? LEGACY_DEFAULT_CONFIG : DEFAULT_CONFIG;
	try {
		ensureConfigExists();
		return normalizeConfig(JSON.parse(readFileSync(getConfigPath(), "utf8")));
	} catch (error) {
		notify?.(`open-tui config error: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return structuredClone(fallback);
	}
}

/** Same-filesystem replacement: a failed save leaves the previous configuration intact. */
export function saveConfig(config: OpenTuiConfig): void {
	const data = JSON.stringify(config, null, 2) + "\n";
	const path = getConfigPath();
	const agentDir = getAgentDir();
	mkdirSync(agentDir, { recursive: true });
	const mode = existsSync(path) ? statSync(path).mode & 0o777 : 0o600;
	const tempDir = mkdtempSync(join(agentDir, ".open-tui-"));
	try {
		const tempPath = join(tempDir, "config.json");
		writeFileSync(tempPath, data, { encoding: "utf8", flag: "wx", mode });
		renameSync(tempPath, path);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
