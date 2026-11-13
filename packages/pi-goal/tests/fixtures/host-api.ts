import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { getDelegateClient } from "../../../pi-delegate/src/api.ts";

// The caller supplies the real SOURCE or BUILT public API, never a fake API.
export function registerProbe(
	pi: ExtensionAPI,
	discover: typeof getDelegateClient,
): void {
	pi.registerTool({
		name: "host_api",
		label: "Public delegate API probe",
		description:
			"Observe the real public runtime or execute an ordinary fixture task",
		parameters: Type.Object({ execute: Type.Optional(Type.Boolean()) }),
		async execute(_id, args, signal, _update, ctx) {
			const client = discover(pi);
			if (args.execute)
				return client.execute(
					{ task: "ORDINARY source/built API consumer" },
					ctx,
					signal,
				);
			const value = client.list();
			return {
				content: [{ type: "text", text: JSON.stringify(value) }],
				details: value,
			};
		},
	});
}
