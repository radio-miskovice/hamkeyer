/**
 * Direct test: connect
 * Opens the serial port given on the command line at 1200 baud (or the
 * baud rate given as the second argument), waits up to 5 seconds for any
 * incoming data and reports each byte in hex, then closes the port and exits.
 *
 * Usage:  npm run direct:connect -- <port> [baudRate]
 *   e.g.  npm run direct:connect -- COM3
 *         npm run direct:connect -- COM3 9600
 *         npm run direct:connect -- /dev/ttyUSB0 4800
 */

import { SerialPort } from "serialport";

const portPath = process.argv[2];
if (!portPath) {
	console.error("Usage: npm run direct:connect -- <port> [baudRate]");
	process.exit(1);
}

const baudArg = process.argv[3];
const baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 1200;

console.log(`Opening ${portPath} at ${baudRate} baud...`);

const port = new SerialPort({ path: portPath, baudRate });

port.on("error", (err) => {
	console.error("Port error:", err.message);
	process.exit(1);
});

port.on("open", () => {
	console.log("Port opened. Waiting up to 5 s for incoming data...");

	const onData = (data: Buffer) => {
		for (const b of data) {
			console.log(`  Received: 0x${b.toString(16).toUpperCase().padStart(2, "0")}`);
		}
	};

	port.on("data", onData);

	setTimeout(() => {
		port.off("data", onData);
		console.log("5 s elapsed. Closing port.");
		port.close((err) => {
			if (err) {
				console.error("Error closing port:", err.message);
				process.exit(1);
			}
			console.log("Port closed.");
		});
	}, 5000);
});
