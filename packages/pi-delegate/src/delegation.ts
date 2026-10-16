import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type {
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
} from "@earendil-works/pi-coding-agent";
import type { BudgetStop, ExecutionBudget } from "./budget.ts";
import type {
	ConfigurationDetails,
	TaskConfiguration,
} from "./configuration.ts";
import type { InheritanceSnapshot } from "./inheritance.ts";
import type { InitializationProgress } from "./initialization-progress.ts";
import type { formatDelegationOutput } from "./output.ts";
import type { PressureOverrides } from "./pressure.ts";
import type { StatusObserver } from "./progress.ts";
import type { ResultFormat } from "./result-format.ts";
import type { RpcDiagnostics, RpcRequestDiagnostics } from "./rpc.ts";
import { formatStartupDiagnostics } from "./startup-diagnostics.ts";
import type { SteeringControl } from "./steering.ts";
import type { TaskRecord } from "./tasks.ts";
import { sumUsage } from "./usage.ts";

export interface DelegationOptions {
	cwd: string;
	args: string[];
	snapshot: InheritanceSnapshot;
	requestedConfiguration?: TaskConfiguration;
	task: string;
	context?: string;
	resultFormat?: ResultFormat;
	pressure?: PressureOverrides;
	budget?: ExecutionBudget;
	status?: StatusObserver;
	taskRecord?: TaskRecord;
	onCwd?: (cwd: string) => void;
	onSteeringControl?: (control: SteeringControl) => void;
	onPhase?: (phase: "queued" | "initializing" | "running") => void;
	onUsage?: (usage: Usage) => void;
	signal?: AbortSignal;
	ui?: (
		request: RpcExtensionUIRequest,
	) => Promise<RpcExtensionUIResponse | undefined>;
	cliPath?: string;
	env?: NodeJS.ProcessEnv;
}

export type DelegationStatus =
	| "completed"
	| "incomplete"
	| "failed"
	| "cancelled";

export type StartupStage =
	| "prepare"
	| "spawn"
	| "initialize"
	| "configure"
	| "submit";

export interface StartupDiagnostics extends RpcDiagnostics {
	stage: StartupStage;
	/** Wall time observed before cleanup; excludes queue residence. */
	elapsedMs?: number;
	operation?: string;
	timings?: { operation: string; elapsedMs: number }[];
	timeout?: RpcRequestDiagnostics;
	initialization?: InitializationProgress;
}

export interface DelegationDetails
	extends Omit<Awaited<ReturnType<typeof formatDelegationOutput>>, "text"> {
	status: DelegationStatus;
	taskId?: string;
	stopReason?: AssistantMessage["stopReason"];
	sessionId?: string;
	error?: string;
	budget?: ExecutionBudget;
	budgetStop?: BudgetStop;
	partialOutput?: boolean;
	usagePartial?: boolean;
	startupDiagnostics?: StartupDiagnostics;
	configuration?: ConfigurationDetails;
	/** Absolute startup directory, present only after the child has spawned. */
	cwd?: string;
}

export interface DelegationResult {
	content: [{ type: "text"; text: string }];
	details: DelegationDetails;
	usage: Usage;
	isError: boolean;
}

export function failedResult(
	error: unknown,
	cancelled = false,
	details: Omit<DelegationDetails, "status" | "error"> = {},
	usage = sumUsage([]),
): DelegationResult {
	const status = cancelled ? "cancelled" : "failed";
	const message = cancelled
		? "Delegation cancelled"
		: error instanceof Error
			? error.message
			: String(error);
	const diagnostics = cancelled ? undefined : details.startupDiagnostics;
	const diagnosticText = diagnostics
		? `\n${formatStartupDiagnostics(diagnostics)}`
		: "";
	return {
		content: [
			{
				type: "text",
				text: `[Delegation ${status}: ${message}]${diagnosticText}${details.fullOutputPath ? `\nPartial output saved to: ${details.fullOutputPath}. Use read to retrieve it.` : ""}`,
			},
		],
		details: { ...details, status, error: message },
		usage,
		isError: true,
	};
}
