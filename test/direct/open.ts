/**
 * Direct test: open
 * Opens the serial port, initialises Winkeyer (HOST OPEN), reports
 * version and status, then closes the port.
 *
 * Usage:  npm run direct:open -- <port> [baudRate]
 *   e.g.  npm run direct:open -- COM3
 *         npm run direct:open -- COM3 9600
 */

import { KeyingMode } from "../../src/core";
import { NodeCWKeyer } from "../../src/core-node";
import type { KeyerStatus } from "../../src/core";

const portPath = process.argv[2];
const baudArg  = process.argv[3];
if (!portPath) {
	console.error("Usage: npm run direct:open -- <port> [baudRate]");
	process.exit(1);
}
let baudRate = baudArg && /^\d+$/.test(baudArg) ? parseInt(baudArg, 10) : 0;

const keyer = NodeCWKeyer.create("winkeyer") ;
if(baudRate === 0) {
    baudRate = keyer.suggestDefaultBaudrate();
} 

const onStatus = (s: KeyerStatus) => {
	console.log("Status update:", s);
};

keyer.on("status", onStatus);

try {
    await keyer.connectWithSerialPort(portPath, baudRate);
    await keyer.init();
    console.log("Version :", keyer.getVersion() ?? "(unknown)");
    console.log("Status  :", keyer.getStatus());
	await keyer.setKeyerMode({ keyingMode: KeyingMode.IAMBIC_B, paddleEcho: true, bufferEcho: true });
	await new Promise((resolve) => setTimeout(resolve, 3000));
	await keyer.close();    
}
catch (err) {
    console.error("Error during test:", err instanceof Error ? err.message : err);
}
finally {
    keyer.off("status", onStatus);
}
