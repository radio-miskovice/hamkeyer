/**
 * Direct test: defaults
 * Opens the serial port given on the command line at 1200 baud (or the baud
 * rate given as the second argument), sends admin command GET_DEFAULTS
 * (0x00 0x07) without calling HOST OPEN first, then waits for 15 bytes to
 * arrive and prints each one as hex + binary.
 * If 15 bytes have not arrived within 5 seconds the port is closed and the
 * test exits.
 *
 * Usage:  npm run direct:defaults -- <port> [baudRate]
 *   e.g.  npm run direct:defaults -- COM10
 *         npm run direct:defaults -- COM10 9600
 */

import { SerialPort } from "serialport";

const portPath = process.argv[2];
if (!portPath) {
	console.error("Usage: npm run direct:defaults -- <port> [baudRate]");
	process.exit(1);
}

const baudArg = process.argv[3];
const baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 1200;

console.log(`Opening ${portPath} at ${baudRate} baud...`);

const TOTAL_BYTES = 15;
const TIMEOUT_MS = 5000;

const port = new SerialPort({ path: portPath, baudRate });

port.on("error", (err) => {
	console.error("Port error:", err.message);
	process.exit(1);
});

port.on("open", () => {
	console.log("Port opened. Sending GET_DEFAULTS (0x00 0x07)...");

	const received: number[] = [];

	const onData = (data: Buffer) => {
		for (const b of data) {
			received.push(b);
			const hex = `0x${b.toString(16).toUpperCase().padStart(2, "0")}`;
			const bin = b.toString(2).padStart(8, "0");
			console.log(`  [${received.length.toString().padStart(2, " ")}]  ${hex}  ${bin}`);
			if (received.length >= TOTAL_BYTES) {
				clearTimeout(timer);
				port.off("data", onData);
				console.log("All 15 bytes received. Closing port.");
				closePort();
			}
		}
	};

	port.on("data", onData);

	// Send GET_DEFAULTS admin command: ADMIN (0x00) + sub-command 0x07
	port.write(Buffer.from([0x00, 0x07]), (err) => {
		if (err) {
			console.error("Write error:", err.message);
			clearTimeout(timer);
			closePort();
		}
	});

	const timer = setTimeout(() => {
		port.off("data", onData);
		console.log(
			`Timeout after ${TIMEOUT_MS / 1000} s. Received ${received.length} of ${TOTAL_BYTES} bytes. Closing port.`
		);
		closePort();
	}, TIMEOUT_MS);

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
