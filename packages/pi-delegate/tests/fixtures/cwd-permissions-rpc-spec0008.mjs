import { readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	const command = JSON.parse(line);
	const reply = (data) =>
		send({ type: "response", id: command.id, success: true, data });
	if (command.type === "get_entries") {
		reply({
			entries: [
				{
					type: "custom",
					customType: "pi-delegate:init",
					data: { ok: true },
				},
			],
		});
	} else if (command.type === "prompt") {
		if (command.message.startsWith("/")) {
			reply({ disposition: "handled" });
			return;
		}
		// The original task really tries a relative directory operation. Record
		// its actual cwd outside the denied directory, not an intended selection.
		try {
			readdirSync(".");
			writeFileSync(
				process.env.CWD_PERMISSIONS_WITNESS,
				JSON.stringify({ cwd: process.cwd(), access: "allowed" }),
			);
			process.exit(24);
		} catch (error) {
			writeFileSync(
				process.env.CWD_PERMISSIONS_WITNESS,
				JSON.stringify({ cwd: process.cwd(), access: error.code }),
			);
			process.stderr.write(`${error.message}\n`);
			process.exit(23);
		}
	}
});
input.on("close", () => process.exit(0));
