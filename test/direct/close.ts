/**
 * Direct test: close
 * Opens the serial port given on the command line at 1200 baud,
 * sends HOST CLOSE (0x00 0x03) without doing HOST OPEN first,
 * waits up to 5 seconds for any status byte response, reports it
 * to the console, then closes the port.
 *
 * Usage:  npm run direct:close -- <port>
 *   e.g.  npm run direct:close -- COM3
 */

import { SerialPort } from "serialport";

const portPath = process.argv[2];
if (!portPath) {
	console.error("Usage: npm run direct:close -- <port>");
	process.exit(1);
}

const WAIT_MS = 5000;

console.log(`Opening ${portPath} at 1200 baud...`);

const port = new SerialPort({ path: portPath, baudRate: 1200 });

port.on("error", (err) => {
	console.error("Port error:", err.message);
	process.exit(1);
});

port.on("open", () => {
	console.log("Port opened.");
	console.log("Sending HOST CLOSE (0x00 0x03)...");

	port.write(new Uint8Array([0x00, 0x03]), (err) => {
		if (err) {
			console.error("Write error:", err.message);
			port.close(() => undefined);
			return;
		}
		console.log("HOST CLOSE sent. Waiting up to 5 s for a response...");
	});

	const receivedBytes: number[] = [];

	const timer = setTimeout(() => {
		port.off("data", onData);
		if (receivedBytes.length === 0) {
			console.log("No response received within 5 s.");
		} else {
			console.log(
				`Received ${receivedBytes.length} byte(s):`,
				receivedBytes.map((b) => `0x${b.toString(16).toUpperCase().padStart(2, "0")}`).join(" ")
			);
		}
		port.close((err) => {
			if (err) console.error("Error closing port:", err.message);
			else console.log("Port closed.");
		});
	}, WAIT_MS);

	const onData = (data: Buffer) => {
		for (const b of data) {
			receivedBytes.push(b);
			console.log(`  Response byte: 0x${b.toString(16).toUpperCase().padStart(2, "0")}`);
		}
	};

	port.on("data", onData);

	// Prevent the timer from keeping the process alive if the port closes early.
	timer.unref?.();
});
