import type { Usage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Invocation settings shared with the ordinary delegate tool. */
export interface DelegateInput {
	task: string;
	title?: string;
	context?: string;
	cwd?: string;
	/** v1 execute waits for a terminal result; true is explicitly rejected. */
	background?: boolean;
	budget?: { maxSeconds?: number; maxTurns?: number };
	model?: { provider: string; id: string };
	thinkingLevel?:
		| "off"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| "max";
	resultFormat?: "handoff";
	pressure?: {
		warning?: { afterSeconds?: number; afterTurns?: number };
		urgent?: { afterSeconds?: number; afterTurns?: number };
	};
}

export interface DelegateResult {
	content: { type: "text"; text: string }[];
	details: {
		status: "completed" | "incomplete" | "failed" | "cancelled";
		/** Absent when validation/cancellation prevented task acceptance. */
		taskId?: string;
		partialOutput?: boolean;
		error?: string;
		fullOutputPath?: string;
		usagePartial?: boolean;
		stopReason?: string;
	};
	usage: Usage;
	isError: boolean;
}

/** Query-only tool-shaped response; observing does not charge usage again. */
export interface DelegateObservation {
	content: { type: "text"; text: string }[];
	details: unknown;
	isError?: boolean;
}

export interface DelegateListInput {
	group?: "all" | "active" | "finished";
	offset?: number;
	limit?: number;
}

export interface DelegateWaitInput {
	taskIds: string[];
	condition?: "any" | "all";
	timeoutSeconds?: number;
}

export interface DelegateClient {
	readonly version: 1;
	/** Uses the same execution owner as the tool; resolves after child cleanup. */
	execute(
		input: DelegateInput,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<DelegateResult>;
	status(taskId: string): DelegateObservation;
	list(input?: DelegateListInput): DelegateObservation;
	/** Status only, not report retrieval. Cancelling a wait does not cancel work. */
	wait(
		input: DelegateWaitInput,
		signal?: AbortSignal,
	): Promise<DelegateObservation>;
	/** Background tasks only; synchronous calls are cancelled via their own signal. */
	cancel(taskId: string): Promise<DelegateObservation>;
}

/**
 * Discover an already registered parent runtime, synchronously. Never registers
 * tools or starts a runner. Call at session_start or later (after extension load).
 * The shared event bus, not module identity, is the compatibility boundary.
 */
export function getDelegateClient(pi: ExtensionAPI): DelegateClient {
	if (process.env.PI_DELEGATE_CHILD === "1")
		throw new Error(
			"pi-delegate consumer API is unavailable in a delegated child",
		);
	if (!pi.events || typeof pi.events.emit !== "function")
		throw new Error(
			"Incompatible pi-delegate host: shared pi.events is required",
		);
	const replies: unknown[] = [];
	pi.events.emit("@wangjq4214/pi-delegate:discover", {
		version: 1,
		reply: (client: unknown) => replies.push(client),
	});
	if (!replies.length)
		throw new Error(
			"Missing pi-delegate runtime: load pi-delegate in this parent session",
		);
	const client = replies[0] as Partial<DelegateClient> | null;
	if (
		replies.length !== 1 ||
		client?.version !== 1 ||
		["execute", "status", "list", "wait", "cancel"].some(
			(name) => typeof client[name as keyof DelegateClient] !== "function",
		)
	)
		throw new Error(
			"Incompatible pi-delegate runtime: expected one version 1 service",
		);
	return client as DelegateClient;
}

/** Public child marker; orchestration extensions must return before registering. */
export function isDelegatedChild(): boolean {
	return process.env.PI_DELEGATE_CHILD === "1";
}

/**
 * Declare tools that must never be inherited by a worker. May be called before
 * delegate loads. Return before registering those tools in a delegated child.
 * Returns an unsubscribe function; runtime shutdown withdraws the declaration.
 */
export function registerParentOnlyTools(
	pi: ExtensionAPI,
	names: readonly string[],
): () => void {
	if (isDelegatedChild())
		throw new Error(
			"Parent-only tools cannot be declared in a delegated child",
		);
	if (!pi.events || typeof pi.events.on !== "function")
		throw new Error(
			"Incompatible pi-delegate host: shared pi.events is required",
		);
	if (
		names.some(
			(name) => typeof name !== "string" || !name.trim() || name.includes(","),
		)
	)
		throw new Error(
			"Parent-only tool names must be non-empty exact tool names",
		);
	const captured = [...new Set(names)];
	const off = pi.events.on(
		"@wangjq4214/pi-delegate:parent-only-tools",
		(request) => {
			const query = request as { version?: unknown; add?: unknown } | null;
			if (query?.version === 1 && typeof query.add === "function")
				query.add(captured);
		},
	);
	pi.on("session_shutdown", off);
	return off;
}
