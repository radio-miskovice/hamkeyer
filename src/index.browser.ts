/**
 * Browser entry point — Web Serial API only.
 *
 * This entry point intentionally does NOT import or export createNodeSerialSession
 * so the `serialport` package and its native bindings are never pulled into the
 * browser bundle.
 *
 * Use this as the esbuild entry for `npm run build:browser`.
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

// Register on window.
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
