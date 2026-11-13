import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getDelegateClient } from "../../../pi-delegate/src/api.ts";
import { registerProbe } from "./host-api.ts";
export default function sourceConsumer(pi: ExtensionAPI): void {
	registerProbe(pi, getDelegateClient);
}
