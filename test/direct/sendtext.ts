/**
 * Direct test: sendtext
 * Opens the serial port, initialises Winkeyer, reports version and
 * status, sends ASCII text "TEST" as CW, waits until the keyer finishes
 * emitting (status.emit goes false), reports final status, then closes.
 *
 * Usage:  npm run direct:sendtext -- <port> [baudRate]
 *   e.g.  npm run direct:sendtext -- COM3
 *         npm run direct:sendtext -- COM3 9600
 */

import { CWKeyer, KeyingMode } from "../../src/core";
import type { KeyerStatus } from "../../src/core";
import { openKeyer } from "./helpers";

const portPath = process.argv[2];
const baudArg  = process.argv[3];
if (!portPath) {
	console.error("Usage: npm run direct:sendtext -- <port> [baudRate]");
	process.exit(1);
}
const baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 1200;

const SEND_TEXT = "TEST";
const EMIT_TIMEOUT_MS = 30_000;

const keyer = CWKeyer.create("winkeyer");

const onStatus = (s: KeyerStatus) => {
	console.log("Status update:", s);
};
keyer.on("status", onStatus);

function waitForEmitDone(): Promise<void> {
	return new Promise((resolve, reject) => {
		if (keyer.getStatus().emit === false) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			keyer.off("status", onEmit);
			reject(new Error(`Timed out after ${EMIT_TIMEOUT_MS} ms waiting for emit=false`));
		}, EMIT_TIMEOUT_MS);
		const onEmit = (s: KeyerStatus) => {
			if (s.emit === false) {
				clearTimeout(timer);
				keyer.off("status", onEmit);
				resolve();
			}
		};
		keyer.on("status", onEmit);
	});
}

try {
	const port = await openKeyer(portPath, keyer, baudRate);
	await keyer.setKeyerMode({ keyingMode: KeyingMode.IAMBIC_B, paddleEcho: true, bufferEcho: true });
	console.log("Version :", keyer.getVersion() ?? "(unknown)");
	console.log("Status  :", keyer.getStatus());

	console.log("Waiting 1 s before sending...");
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log(`Sending CW text: "${SEND_TEXT}"`);
	await keyer.sendCw(SEND_TEXT);

	console.log("Waiting 1 s after send...");
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log("Waiting for keyer to finish emitting...");
	await waitForEmitDone();
	console.log("Emit done. Final status:", keyer.getStatus());

	port.close((err) => {
		if (err) console.error("Error closing port:", err.message);
		else console.log("Port closed.");
	});
} catch (err) {
	console.error("Error:", err);
	process.exit(1);
}
