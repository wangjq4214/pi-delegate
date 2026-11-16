import type {
	DelegateExecutionOptions,
	DelegateExecutionProgress,
} from "./api.ts";
import type { TaskRecord, TaskRecords } from "./tasks.ts";

/** Observe existing records only; detaching never owns execution or cancellation. */
export function observeInvocation(
	records: TaskRecords,
	record: TaskRecord,
	signal: AbortSignal,
	onProgress: DelegateExecutionOptions["onProgress"],
): () => void {
	if (!onProgress) return () => {};
	let previous: DelegateExecutionProgress | undefined;
	let detached = false;
	const detach = () => {
		if (detached) return;
		detached = true;
		unsubscribe();
		signal.removeEventListener("abort", cancelling);
	};
	const publish = () => {
		if (detached) return;
		if (!record.valid()) {
			detach();
			return;
		}
		const progress = record.progress;
		const snapshot: DelegateExecutionProgress = {
			taskId: record.taskId,
			phase:
				progress.status ??
				(progress.stoppedAt !== undefined
					? "cleanup"
					: progress.executionPhase),
			cancelling: !progress.status && signal.aborted,
		};
		if (
			previous?.phase === snapshot.phase &&
			previous.cancelling === snapshot.cancelling
		)
			return;
		// Never trust a callback to leave its input unchanged, or await it.
		previous = { ...snapshot };
		if (progress.status) detach();
		try {
			// TypeScript permits async functions where a void callback is expected.
			// Catch their rejections as well as synchronous observer failures.
			void Promise.resolve(onProgress?.(snapshot)).catch(() => {});
		} catch {
			// Presentation must not affect child execution, results or accounting.
		}
	};
	const cancelling = () => record.cancelRequested();
	const unsubscribe = records.subscribe(publish);
	signal.addEventListener("abort", cancelling, { once: true });
	if (signal.aborted) cancelling();
	publish();
	return detach;
}
