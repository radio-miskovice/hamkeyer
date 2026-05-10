/**
 * Direct test: long
 * Full multi-step CW transmission test:
 *   1. Connect and initialise Winkeyer (defaults are read inside init())
 *   2. Send "TEST", wait for emit = false
 *   3. Set 33 WPM, send "599", wait for emit = false
 *   4. Set 20 WPM, send "+"
 *   5. Close and disconnect
 *
 * If paddle break-in is detected at any point the test reports it and exits.
 *
 * Usage:  npm run direct:long -- <port> [baudRate]
 *   e.g.  npm run direct:long -- COM10
 *         npm run direct:long -- COM10 9600
 */

import { stat } from "node:fs";
import { KeyingMode } from "../../src/core";
import type { KeyerStatus } from "../../src/core";
import { NodeCWKeyer } from "../../src/core-node";

const portPath = process.argv[2];
const baudArg  = process.argv[3];
if (!portPath) {
	console.error("Usage: npm run direct:long -- <port> [baudRate]");
	process.exit(1);
}
const baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 1200;

const EMIT_TIMEOUT_MS = 60_000;

const keyer = NodeCWKeyer.create("winkeyer");

keyer.on("status", (s: KeyerStatus) => {
	console.log("Status:", s);
});

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

const waitStatus = (s: KeyerStatus): Promise<void> => {
    return new Promise((resolve, reject) => {
        keyer.on("status", (status: KeyerStatus) => {
            for (const [k, v] of Object.entries(s)) {
                if (status[k as keyof KeyerStatus] !== v) {
                    return;
                }
            }
            resolve();
        });
     });
    }
   
// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sends CW text and waits for the keyer to finish emitting.
 * The status listener is armed before sendCw() so we never miss the
 * emit=true transition even if the keyer responds very quickly.
 * Rejects on break-in or timeout.
 */
function sendCwAndWait(text: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let emitStarted = false;

		const timer = setTimeout(() => {
			keyer.off("status", onStatus);
			reject(new Error(`Timed out after ${EMIT_TIMEOUT_MS / 1000} s waiting for emit=false`));
		}, EMIT_TIMEOUT_MS);

		const onStatus = (s: KeyerStatus) => {
			if (s.break) {
				clearTimeout(timer);
				keyer.off("status", onStatus);
				reject(new Error("Paddle break-in detected"));
				return;
			}
			if (!emitStarted && s.emit === true) {
				emitStarted = true;
				return;
			}
			if (emitStarted && s.emit === false) {
				clearTimeout(timer);
				keyer.off("status", onStatus);
				resolve();
			}
		};

		// Arm listener BEFORE sending so emit=true is never missed.
		keyer.on("status", onStatus);

		keyer.sendCw(text).catch((err) => {
			clearTimeout(timer);
			keyer.off("status", onStatus);
			reject(err);
		});
	});
}

// ─── Main ─────────────────────────────────────────────────────────────────────

let port: import("serialport").SerialPort | null = null;

async function closeAndExit(code = 0): Promise<void> {
	try {
		await keyer.close();
	} catch {
		// ignore close errors during teardown
	}
	if (port) {
		await new Promise<void>((res) => port!.close(() => res()));
		console.log("Port closed.");
	}
	process.exit(code);
}

try {
	// 1. Connect and initialise (getDefaults is called inside init())
	await keyer.connectWithSerialPort(portPath, baudRate);
    await keyer.init();
	await keyer.setKeyerMode({ keyingMode: KeyingMode.IAMBIC_B, paddleEcho: true, bufferEcho: true });
	console.log("Version:", keyer.getVersion() ?? "(unknown)");
	console.log("Status :", keyer.getStatus());

	// 2. Send "TEST", wait for emit = false
	console.log('\nSending "TEST"...');
	await sendCwAndWait("TEST");
	console.log("Emit done.");

	// 3. Set 33 WPM, send "599", wait for emit = false
	console.log("\nSetting 33 WPM...");
	await keyer.setWpm(33);
    await delay(500); // small delay to ensure WPM change is processed before sending next CW
	console.log('Sending "599"...');
	await sendCwAndWait("599");
	console.log("Emit done.");

	// 4. Set 20 WPM, send "+"
	console.log("\nSetting 20 WPM...");
	await keyer.setWpm(20);
	console.log('Sending "+"...');
	await keyer.sendCw("+");
    await waitStatus({ emit: false }); // wait for emit=false but ignore emit=true since some keyers (like K1EL) don't do it for very short messages
    console.log("Send done.");
    
    await delay(500); 
	// 5. Close and disconnect
	console.log("\nAll done. Closing...");
	await closeAndExit(0);
} catch (err) {
	if (err instanceof Error && err.message.includes("break-in")) {
		console.warn("Paddle break-in detected — aborting test.");
	} else {
		console.error("Error:", err);
	}
	await closeAndExit(1);
}
