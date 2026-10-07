import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { IconMode } from "./icons.ts";

export type SettingsLanguage = "en" | "zh";
export type CursorStyle = "block" | "bar" | "underline";
export type EditorBorderStyle = "surround" | "minimal";
export type ThinkingPeekLines = 0 | 1 | 2;

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
	lines: ThinkingPeekLines;
}

export interface WorklineConfig {
	marquee: boolean;
	attachToBorder: boolean;
}

export interface OpenTuiConfig {
	enabled: boolean;
	inlineFooter: boolean;
	settingsLanguage: SettingsLanguage;
	cursorStyle: CursorStyle;
	editorBorderStyle: EditorBorderStyle;
	icons: {
		mode: IconMode;
	};
	footerSegments: FooterSegments;
	telemetry: TelemetryConfig;
	thinkingPeek: ThinkingPeekConfig;
	workline: WorklineConfig;
}

export const DEFAULT_CONFIG: OpenTuiConfig = {
	enabled: true,
	inlineFooter: false,
	settingsLanguage: "en",
	cursorStyle: "block",
	editorBorderStyle: "surround",
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
};

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
	const config = normalizeFields(DEFAULT_CONFIG, value);
	config.settingsLanguage = enumValue(config.settingsLanguage, ["en", "zh"], DEFAULT_CONFIG.settingsLanguage);
	config.cursorStyle = enumValue(config.cursorStyle, ["block", "bar", "underline"], DEFAULT_CONFIG.cursorStyle);
	config.editorBorderStyle = enumValue(config.editorBorderStyle, ["surround", "minimal"], DEFAULT_CONFIG.editorBorderStyle);
	config.icons.mode = enumValue(config.icons.mode, ["auto", "nerd", "unicode", "ascii"], DEFAULT_CONFIG.icons.mode);
	config.thinkingPeek.lines = enumValue(config.thinkingPeek.lines, [0, 1, 2], DEFAULT_CONFIG.thinkingPeek.lines);
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
	try {
		ensureConfigExists();
		return normalizeConfig(JSON.parse(readFileSync(getConfigPath(), "utf8")));
	} catch (error) {
		notify?.(`open-tui config error: ${error instanceof Error ? error.message : String(error)}`, "warning");
		return structuredClone(DEFAULT_CONFIG);
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
