import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const log = process.env.FIXTURE_LOG_DIR;
if (log)
	writeFileSync(
		join(log, `${process.pid}.mcp`),
		JSON.stringify({
			pid: process.pid,
			child: process.env.PI_DELEGATE_CHILD === "1",
		}),
	);
const reply = (record, result) =>
	process.stdout.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: record.id, result })}\n`,
	);
function command(record) {
	if (record.id === undefined) return;
	switch (record.method) {
		case "initialize":
			reply(record, {
				protocolVersion: record.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "delegate-fixture", version: "1.0.0" },
			});
			break;
		case "tools/list":
			reply(record, {
				tools: [
					{
						name: "echo",
						description: "Echo in the MCP server process",
						inputSchema: {
							type: "object",
							properties: { value: { type: "string" } },
							required: ["value"],
						},
					},
				],
			});
			break;
		case "tools/call":
			reply(record, {
				content: [
					{
						type: "text",
						text: `mcp:${process.pid}:${record.params.arguments.value}`,
					},
				],
			});
			break;
		default:
			reply(record, {});
	}
}
let buffer = "";
const decoder = new StringDecoder("utf8");
process.stdin.on("data", (chunk) => {
	buffer += decoder.write(chunk);
	let newline = buffer.indexOf("\n");
	while (newline >= 0) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		if (line) command(JSON.parse(line));
		newline = buffer.indexOf("\n");
	}
});
process.stdin.on("end", () => {
	if (log) writeFileSync(join(log, `${process.pid}.mcp-closed`), "closed");
	process.exit(0);
});
