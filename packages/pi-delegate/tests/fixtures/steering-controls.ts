import { appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Real host input preprocessing and request transformations, with explicit file gates. */
export default function steeringControls(pi: ExtensionAPI) {
	const directory = process.env.PRESSURE_FIXTURE_DIR;
	if (!directory) throw new Error("Missing steering fixture directory");
	const child = process.env.PI_DELEGATE_CHILD === "1";
	const trace = (type: string, text?: string) =>
		appendFileSync(
			join(directory, `${process.pid}.trace.jsonl`),
			`${JSON.stringify({ type, text, at: Date.now() })}\n`,
		);
	const gate = async (name: string) => {
		trace("gate-ready", name);
		while (!existsSync(join(directory, `${process.pid}.${name}-release`)))
			await new Promise((resolve) => setTimeout(resolve, 10));
		trace("gate-open", name);
	};
	pi.registerCommand("steering-sentinel", {
		description: "Must remain literal instruction text",
		async handler() {
			trace("command-executed");
		},
	});
	pi.on("before_agent_start", async () => {
		if (child && process.env.STEERING_HOLD_START === "1")
			await gate("original-start");
	});
	pi.on("agent_end", () => {
		if (child) trace("low-level-end");
	});
	let continued = false;
	pi.on("agent_before_settle", async () => {
		if (child && process.env.STEERING_HOLD_SETTLE === "1" && !continued) {
			continued = true;
			await gate("before-settle");
			return { continue: true };
		}
	});
	pi.on("input", async (event) => {
		if (!child) return;
		if (
			event.text.startsWith("Task:") &&
			process.env.STEERING_FAIL_START === "1"
		)
			return { action: "handled" };
		const manual = event.text.startsWith("[pi-delegate instruction]");
		const pressure = event.text.startsWith("[pi-delegate pressure:");
		if (!manual && !pressure) return;
		trace("input-enter", event.text);
		if (
			event.text.includes("HOLD") ||
			(pressure && process.env.STEERING_HOLD_PRESSURE === "1")
		)
			await gate(pressure ? "pressure-input" : "manual-input");
		trace("input-outcome", event.text);
		if (event.text.includes("REJECT"))
			return { action: "transform", text: null as unknown as string };
		if (
			event.text.includes("HANDLED") ||
			(pressure && process.env.STEERING_HANDLE_PRESSURE === "1")
		)
			return { action: "handled" };
		if (
			event.text.includes("TRANSFORM") ||
			(pressure && process.env.STEERING_TRANSFORM_PRESSURE === "1")
		)
			return {
				action: "transform",
				text: `${event.text}\nhandler-transformed`,
			};
	});
	pi.on("context", (event) => {
		if (!child) return;
		return {
			messages: event.messages.map((message) => {
				if (message.role !== "user") return message;
				const text =
					typeof message.content === "string"
						? message.content
						: message.content
								.filter((b) => b.type === "text")
								.map((b) => b.text)
								.join("\n");
				if (!text.startsWith("[pi-delegate")) return message;
				return { ...message, content: `${text}\nrequest-context-processed` };
			}),
		};
	});
	pi.registerTool(
		defineTool({
			name: "steering_reachability",
			label: "Child reachability probe",
			description:
				"Test direct declarations, discovery and actual nested/codemode exclusion",
			parameters: Type.Object({}),
			async execute(_id, _params, _signal, _update, ctx) {
				const nested = await ctx.executeTool("delegate_steer", {
					taskId: "not-a-child-handle",
					message: "forbidden",
				});
				trace(
					"reachability",
					JSON.stringify({
						nested,
						callable: ctx.tools.map((t) => t.name),
						all: pi.getAllTools().map((t) => t.name),
					}),
				);
				return {
					content: [{ type: "text", text: "probe done" }],
					details: undefined,
				};
			},
		}),
	);
}
