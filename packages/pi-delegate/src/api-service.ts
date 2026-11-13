import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type DelegateClient,
	getDelegateClient,
	isDelegatedChild,
} from "./api.ts";

const discovery = "@wangjq4214/pi-delegate:discover";

/** Registration uses the same wire handshake as consumers, even across bundles. */
export function hasDelegateService(pi: ExtensionAPI): boolean {
	if (isDelegatedChild()) return true;
	// Older direct registration fixtures have no event bus; tools still work there,
	// but the consumer API explicitly requires the real host's shared bus.
	if (!pi.events) return false;
	let present = false;
	pi.events.emit(discovery, {
		version: 1,
		reply: () => {
			present = true;
		},
	});
	if (present) getDelegateClient(pi); // Reject incompatible owners rather than duplicating them.
	return present;
}

export function publishDelegateService(
	pi: ExtensionAPI,
	client: DelegateClient,
): () => void {
	if (!pi.events) return () => {};
	return pi.events.on(discovery, (value) => {
		const request = value as { reply?: unknown } | null;
		// Always disclose our version; consumers reject incompatible runtimes.
		if (typeof request?.reply === "function") request.reply(client);
	});
}
