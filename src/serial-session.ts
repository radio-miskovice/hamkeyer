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
 * SerialSession — transport-agnostic serial session interface and Web Serial API implementation.
 *
 * The interface is identical regardless of the underlying transport (Web Serial API in browser,
 * Node.js serialport in standalone/test builds). The concrete implementations differ only in
 * how they talk to the hardware; the rest of the stack (CWKeyer, ProtocolAdapter) uses only
 * this interface and is never aware of the transport layer.
 */

// ─── Public interface ─────────────────────────────────────────────────────────

export interface SerialSession {
	writeBytes(data: Uint8Array): Promise<void>;
	writeText(text: string): Promise<void>;
	disconnect(): Promise<void>;
	on(listener: (data: Uint8Array) => void): void;
	off(listener: (data: Uint8Array) => void): void;
}

// ─── Web Serial API helpers ───────────────────────────────────────────────────

export function isWebSerialSupported(): boolean {
	return typeof navigator !== "undefined" && "serial" in navigator;
}

export async function requestSerialPort(
	options?: SerialPortRequestOptions
): Promise<SerialPort> {
	if (!isWebSerialSupported()) {
		throw new Error("Web Serial API is not supported in this browser context.");
	}
	return navigator.serial.requestPort(options);
}

export async function openSerialPort(
	port: SerialPort,
	options: SerialOptions
): Promise<void> {
	if (!port.readable && !port.writable) {
		await port.open(options);
	}
}

export async function closeSerialPort(port: SerialPort): Promise<void> {
	if (port.readable || port.writable) {
		await port.close();
	}
}

// ─── Web Serial API implementation ───────────────────────────────────────────

/**
 * Wraps an already-opened Web Serial API SerialPort into a SerialSession.
 * Uses the WHATWG Streams API (port.readable / port.writable).
 */
export function createWebSerialSession(port: SerialPort): SerialSession {
	if (!port.readable || !port.writable) {
		throw new Error("Serial port streams are not available after opening the port.");
	}

	const readable = port.readable as ReadableStream<Uint8Array>;
	const writable = port.writable as WritableStream<Uint8Array>;

	const reader = readable.getReader();
	const writer = writable.getWriter();

	const dataListeners: Array<(data: Uint8Array) => void> = [];
	let isReading = true;

	const startReader = async () => {
		while (isReading) {
			try {
				const { value, done } = await reader.read();
				if (done) {
					isReading = false;
					break;
				}
				const chunk = value.slice();
				for (const listener of dataListeners) {
					queueMicrotask(() => listener(chunk));
				}
			} catch {
				isReading = false;
				break;
			}
		}
	};

	startReader().catch(() => undefined);

	return {
		async writeBytes(data: Uint8Array) {
			await writer.write(data);
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
			await writer.write(bytes);
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
			isReading = false;
			await reader.cancel().catch(() => undefined);
			reader.releaseLock();
			await writer.close().catch(() => undefined);
			writer.releaseLock();
			await closeSerialPort(port);
		}
	};
}

// ─── Convenience factory ──────────────────────────────────────────────────────

/**
 * Requests a Web Serial port, opens it, and returns a SerialSession.
 * Browser-only; throws if the Web Serial API is unavailable.
 */
export async function connectSerialSession(
	serialOptions: SerialOptions,
	requestOptions?: SerialPortRequestOptions
): Promise<SerialSession> {
	const port = await requestSerialPort(requestOptions);
	await openSerialPort(port, serialOptions);
	return createWebSerialSession(port);
}

/**
 * Silently reconnects using the first previously-granted Web Serial port.
 * Returns a connected SerialSession, or null if no port was previously granted
 * or if the Web Serial API is unavailable.
 * Does NOT show a port-picker dialog.
 */
export async function autoConnectWebSerial(
	serialOptions: SerialOptions
): Promise<SerialSession | null> {
	if (!isWebSerialSupported()) return null;
	let ports: SerialPort[];
	try {
		ports = await (navigator as any).serial.getPorts();
	} catch {
		return null;
	}
	if (ports.length === 0) return null;
	const port = ports[0];
	await openSerialPort(port, serialOptions);
	return createWebSerialSession(port);
}
