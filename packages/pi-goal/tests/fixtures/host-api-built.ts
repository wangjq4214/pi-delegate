import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDelegateClient } from "@wangjq4214/pi-delegate/api";
import { registerProbe } from "./host-api.ts";
export default function builtConsumer(pi: ExtensionAPI): void {
	registerProbe(pi, getDelegateClient);
}
