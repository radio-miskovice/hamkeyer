/**
 * Node.js serialport implementation of SerialSession.
 *
 * Wraps a Node.js `serialport` SerialPort instance into the transport-agnostic
 * SerialSession interface so that CWKeyer can be used in Node.js test and
 * standalone environments without any code changes.
 *
 * This module is intentionally NOT imported by the browser entry point
 * (src/index.browser.ts) so that the `serialport` package and its native
 * bindings are never bundled into the browser build.
 */

import { SerialPort as NodeSerialPort } from "serialport";
import type { SerialSession } from "./serial-session";

/**
 * Wraps an already-created (and ideally already-open) Node.js SerialPort into
 * a SerialSession. The caller is responsible for opening the port before
 * passing it here, or for listening to the 'open' event before sending data.
 */
export function createNodeSerialSession(port: NodeSerialPort): SerialSession {
	const dataListeners: Array<(data: Uint8Array) => void> = [];

	port.on("data", (data: Buffer) => {
		const chunk = new Uint8Array(data);
		for (const listener of dataListeners) {
			queueMicrotask(() => listener(chunk));
		}
	});

	return {
		async writeBytes(data: Uint8Array) {
			await new Promise<void>((resolve, reject) => {
				port.write(data, (err) => (err ? reject(err) : resolve()));
			});
		},
		async writeText(text: string) {
			const bytes = new Uint8Array(text.length);
			for (let i = 0; i < text.length; i++) {
				const code = text.charCodeAt(i);
				if (code > 0x7f) {
					throw new Error(
						`Non-ASCII character at position ${i} (code ${code}) is not allowed.`
					);
				}
				bytes[i] = code;
			}
			await new Promise<void>((resolve, reject) => {
				port.write(bytes, (err) => (err ? reject(err) : resolve()));
			});
		},
		on(listener: (data: Uint8Array) => void) {
			dataListeners.push(listener);
		},
		off(listener: (data: Uint8Array) => void) {
			const idx = dataListeners.indexOf(listener);
			if (idx !== -1) {
				dataListeners.splice(idx, 1);
			}
		},
		async disconnect() {
			await new Promise<void>((resolve, reject) => {
				port.close((err) => (err ? reject(err) : resolve()));
			});
		}
	};
}
