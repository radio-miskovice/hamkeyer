/* Copyright 2026 Jindřich Vavruška jindrich@vavruska.cz 

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee 
is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE 
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE 
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS 
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, 
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

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
