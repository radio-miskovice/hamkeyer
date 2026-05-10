/**
 * Direct test: admin
 * Opens the serial port given on the command line, sends an admin command
 * (0x00 <cmd>) without calling HOST OPEN first, then prints every incoming
 * byte (hex + binary) one per line.
 * Exits automatically after 5 seconds of silence (no new bytes).
 *
 * Usage:  npm run direct:admin -- <port> <command> [baudRate]
 *   command may be decimal (7) or hex (0x07)
 *   e.g.  npm run direct:admin -- COM10 0x07
 *         npm run direct:admin -- COM10 9
 *         npm run direct:admin -- COM10 0x09 9600
 */

import { SerialPort } from "serialport";

const portPath = process.argv[2];
const cmdArg   = process.argv[3];
const baudArg  = process.argv[4];

if (!portPath || !cmdArg) {
	console.error("Usage: npm run direct:admin -- <port> <command> [baudRate]");
	console.error("  command may be decimal (7) or hex (0x07)");
	process.exit(1);
}

const cmdByte = Number(cmdArg);
if (!Number.isInteger(cmdByte) || cmdByte < 0 || cmdByte > 255) {
	console.error(`Invalid command value: "${cmdArg}". Must be an integer 0–255.`);
	process.exit(1);
}

const baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 1200;
const SILENCE_TIMEOUT_MS = 5000;

console.log(`Opening ${portPath} at ${baudRate} baud...`);
console.log(`Sending ADMIN command: 0x00 0x${cmdByte.toString(16).toUpperCase().padStart(2, "0")}`);

const port = new SerialPort({ path: portPath, baudRate });

port.on("error", (err) => {
	console.error("Port error:", err.message);
	process.exit(1);
});

port.on("open", () => {
	console.log("Port opened.");

	let count = 0;
	let silenceTimer: ReturnType<typeof setTimeout>;

	function resetSilenceTimer() {
		clearTimeout(silenceTimer);
		silenceTimer = setTimeout(() => {
			port.off("data", onData);
			console.log(`\n5 s of silence. ${count} byte(s) received total. Closing port.`);
			closePort();
		}, SILENCE_TIMEOUT_MS);
	}

	const onData = (data: Buffer) => {
		resetSilenceTimer();
		for (const b of data) {
			count++;
			const hex = `0x${b.toString(16).toUpperCase().padStart(2, "0")}`;
			const bin = b.toString(2).padStart(8, "0");
			console.log(`  [${count.toString().padStart(3, " ")}]  ${hex}  ${bin}`);
		}
	};

	port.on("data", onData);

	// Start the initial silence timer before writing
	resetSilenceTimer();

	port.write(Buffer.from([0x00, cmdByte]), (err) => {
		if (err) {
			console.error("Write error:", err.message);
			clearTimeout(silenceTimer);
			closePort();
		}
	});

	function closePort() {
		port.close((err) => {
			if (err) {
				console.error("Error closing port:", err.message);
				process.exit(1);
			}
			console.log("Port closed.");
		});
	}
});
