/**
 * Universal entry point — works in both browser (Web Serial API) and Node.js
 * (via the `serialport` package).
 *
 * For browser-only builds use src/index.browser.ts instead, which excludes
 * the Node.js serialport dependency entirely so it is never bundled.
 */

export * from "./core";
export {
	isWebSerialSupported,
	requestSerialPort,
	openSerialPort,
	closeSerialPort,
	createWebSerialSession,
	connectSerialSession,
	autoConnectWebSerial
} from "./serial-session";
export { createNodeSerialSession } from "./node-session";

// Register on window when running in a browser context.
import { CWKeyer } from "./core";
import {
	isWebSerialSupported,
	requestSerialPort,
	openSerialPort,
	closeSerialPort,
	connectSerialSession
} from "./serial-session";

if (typeof window !== "undefined") {
	(window as typeof window & { Hamkeyer?: unknown }).Hamkeyer = {
		isWebSerialSupported,
		requestSerialPort,
		openSerialPort,
		closeSerialPort,
		connectSerialSession,
		CWKeyer
	};
}
