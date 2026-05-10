/**
 * Core keyer abstractions: enums, interfaces, protocol adapter factory, and CWKeyer.
 *
 * This module has no dependency on any specific serial transport. It imports only
 * the transport-agnostic SerialSession interface and the Web Serial helper functions
 * needed to implement CWKeyer.connect() / connectStandalone(). Both the browser and
 * universal entry points include this module unchanged.
 */

import { WinkeyerProtocolAdapter } from "./winkeyer";
import {
	type SerialSession,
	createWebSerialSession,
	requestSerialPort,
	openSerialPort
} from "./serial-session";
import { createNodeSerialSession } from "./node-session";

export type { SerialSession };

// ─── Enums & value interfaces ─────────────────────────────────────────────────

export enum KeyingMode {
	IAMBIC_B = 0,
	IAMBIC_A = 1,
	ULTIMATIC = 2,
	BUG = 3
}

export interface KeyerMode {
	paddleEcho?: boolean;
	bufferEcho?: boolean;
	paddleBreak?: boolean;
	keyingMode?: KeyingMode;
}

// ─── ProtocolAdapter interface ────────────────────────────────────────────────

/**
 * ProtocolAdapter defines the interface for a keyer protocol adapter that translates between raw serial data and high-level keyer commands and status updates. 
 * Each supported keyer type (e.g. Winkeyer) will have its own implementation of this interface that knows how to encode/decode the specific command and status 
 * formats for that keyer. The Keyer class uses a ProtocolAdapter to interact with the underlying serial session without needing to know the details of the specific
 * keyer protocol. This separation allows to add support for new keyer types in the future by simply implementing new ProtocolAdapter classes.
 * 
 * The ProtocolAdapter interface includes only methods for handling incoming serial data, opening the connection, retrieving version information, initializing the keyer,
 * breaking (stopping CW and clearing buffers), sending CW text, setting WPM speed, setting detailed keying charateristics (weighting, dit:dash ratio) and setting sidetone 
 * frequency. It does NOT implement all keyer features, only those necessary for application automation.
 * 
 * By design decision it does not include any methods related to manual sending.
 * 
 * The current version also intentionally does not handle buffered speed control and PTT parameters and control. 
 * This may change in the future.  
 * 
 */
export interface ProtocolAdapter {
	handleIncomingData(data: Uint8Array): void;
	open(): Promise<void>;
	getVersion(): Promise<void>;
	init(): Promise<void>;
	break(): Promise<void>;
	sendCw(text: string): Promise<void>;
	setWpm(wpm: number): Promise<void>;
	setSidetoneFrequency(freq: number): Promise<void>;
	setWeighting(weighting: number): Promise<void>;
	setDashRatio(ratio: number): Promise<void>;
	setKeyerMode(mode: KeyerMode): Promise<void>;
	setExtendedOptions(options: Record<string, any>): Promise<void>;
	getWpm(): number | undefined;
	getWeighting(): number;
	getKeyerMode(): KeyerMode;
	getDashRatio(): number;
	getSidetoneFrequency(): number;
	close(): Promise<void>;
}

// ─── KeyerStatus ──────────────────────────────────────────────────────────────

export interface KeyerStatus {
	keyerType?: string;
	isOpen?: boolean;
	version?: string;
	emit?: boolean;
	full?: boolean;
	wpm?: number;
	busy?: boolean;
	break?: boolean;
}

// ─── Internal listener types ──────────────────────────────────────────────────

interface StatusListener {
	(status: KeyerStatus): void;
}

interface EchoListener {
	(ascii: string): void;
}

// ─── Protocol adapter factory ─────────────────────────────────────────────────

function createProtocolAdapter(type: string, keyer: CWKeyer): ProtocolAdapter {
	if (type.toLowerCase() === "winkeyer") {
		return new WinkeyerProtocolAdapter({
			setStatus(status: KeyerStatus) {
				keyer.setStatus(status);
			},
			echoAscii(ascii: string) {
				keyer.echoAscii(ascii);
			},
			async sendBytes(data: Uint8Array) {
				await keyer.sendBytes(data);
			}
		});
	}
	throw new Error(`Unsupported keyer type: ${type}`);
}

// ─── CWKeyer ──────────────────────────────────────────────────────────────────

export class CWKeyer {
	private readonly keyerType: string;
	private readonly browser: boolean;
	private readonly webSerial: boolean;
	protected session: SerialSession | null = null;
	private protocolAdapter: ProtocolAdapter | null = null;
	private status: KeyerStatus = {};
	private statusListeners: Array<StatusListener> = [];
	private echoListeners: Array<EchoListener> = [];
	private versionText: string | null = null;
	private echoText = "";

	protected constructor(keyerType: string) {
		this.keyerType = keyerType;
		this.browser = typeof window !== "undefined";
		this.webSerial = this.browser && "serial" in navigator;
	}

	static create(keyerType: string): CWKeyer {
		return new CWKeyer(keyerType);
	}

    suggestDefaultBaudrate(): number {
        switch (this.keyerType.toLowerCase()) {
            case "winkeyer":
                return 1200;
            default:
                return 9600 ;
        }
    }

	isBrowser(): boolean {
		return this.browser;
	}

	hasWebSerial(): boolean {
		return this.webSerial;
	}

	/**
	 * Requests a Web Serial port via the browser dialog, opens it, and connects.
	 * Browser-only.
	 */
	async connect(baud: number): Promise<void> {
		const serialPort = await requestSerialPort();
		await openSerialPort(serialPort, { baudRate: baud });
		const session = createWebSerialSession(serialPort);
		await this.connectWithSession(session);
	}

	/**
	 * Connects using any pre-built SerialSession. Works in both browser and
	 * Node.js. Use this with createNodeSerialSession() for standalone/test use.
	 */
	async connectWithSession(session: SerialSession): Promise<void> {
		if (this.session) {
			throw new Error("Keyer is already connected.");
		}
		const protocolAdapter = createProtocolAdapter(this.keyerType, this);
		session.on((data: Uint8Array) => {
			if (this.protocolAdapter) {
				this.protocolAdapter.handleIncomingData(data);
			}
		});
		this.session = session;
		this.protocolAdapter = protocolAdapter;
	}

	async disconnect(): Promise<void> {
		if (!this.session) {
			return;
		}
		await this.session.disconnect();
		this.session = null;
		this.protocolAdapter = null;
		this.versionText = null;
		this.status = { isOpen: false };
		this.emitStatus();
	}

	async close(): Promise<void> {
		this.assertConnected();
		await this.protocolAdapter!.close();
		await this.disconnect();
	}

	async sendBytes(data: Uint8Array): Promise<void> {
		this.assertConnected();
		await this.session!.writeBytes(data);
	}

	async init(): Promise<void> {
		this.assertConnected();
        console.log("CWKeyer: Initializing keyer...");
		await this.protocolAdapter!.init();
	}

	async break(): Promise<void> {
		this.assertConnected();
		await this.protocolAdapter!.break();
	}

	async sendCw(text: string): Promise<void> {
		this.assertConnected();
		await this.protocolAdapter!.sendCw(text);
	}

	async setWpm(wpm: number): Promise<void> {
		this.assertConnected();
		await this.protocolAdapter!.setWpm(wpm);
	}

	async setKeyerMode(mode: KeyerMode): Promise<void> {
		this.assertConnected();
		await this.protocolAdapter!.setKeyerMode(mode);
	}

	getVersion(): string | null {
		return this.versionText;
	}

	getWpm(): number | undefined {
		return this.protocolAdapter?.getWpm();
	}

	getWeighting(): number {
		return this.protocolAdapter?.getWeighting() ?? 1.0;
	}

	getKeyerMode(): KeyerMode {
		return this.protocolAdapter?.getKeyerMode() ?? {};
	}

	getDashRatio(): number {
		return this.protocolAdapter?.getDashRatio() ?? 3.0;
	}

	getSidetoneFrequency(): number {
		return this.protocolAdapter?.getSidetoneFrequency() ?? 700;
	}

	getEchoAscii(): string {
		return this.echoText;
	}

	getStatus(): KeyerStatus {
		return { ...this.status, keyerType: this.keyerType };
	}

	on(eventName: "status" | "echo", listener: StatusListener | EchoListener): void {
		if (eventName === "status") {
			this.statusListeners.push(listener as StatusListener);
		} else if (eventName === "echo") {
			this.echoListeners.push(listener as EchoListener);
		}
	}

	off(eventName: "status" | "echo", listener: StatusListener | EchoListener): void {
		if (eventName === "status") {
			const idx = this.statusListeners.indexOf(listener as StatusListener);
			if (idx !== -1) {
				this.statusListeners.splice(idx, 1);
			}
		} else if (eventName === "echo") {
			const idx = this.echoListeners.indexOf(listener as EchoListener);
			if (idx !== -1) {
				this.echoListeners.splice(idx, 1);
			}
		}
	}

	setStatus(status: KeyerStatus): void {
		this.status = { ...this.status, ...status, keyerType: this.keyerType };
		if (typeof status.version === "string") {
			this.versionText = status.version;
		}
		this.emitStatus();
	}

	echoAscii(ascii: string): void {
		for (const listener of this.echoListeners) {
			queueMicrotask(() => listener(ascii));
		}
	}

	private emitStatus(): void {
		const snapshot = { ...this.status };
		for (const listener of this.statusListeners) {
			queueMicrotask(() => listener(snapshot));
		}
	}

	private assertConnected(): void {
		if (!this.session || !this.protocolAdapter) {
			throw new Error(`Keyer is not connected. Session = ${this.session}, ProtocolAdapter = ${this.protocolAdapter}`);
		}
	}

    setWeighting(weighting: number): Promise<void> {
        this.assertConnected();
        return this.protocolAdapter!.setWeighting(weighting);
    }

    setDashRatio(ratio: number): Promise<void> {
        this.assertConnected();
        return this.protocolAdapter!.setDashRatio(ratio);
    }

    setSidetoneFrequency(freq: number): Promise<void> {
        this.assertConnected();
        return this.protocolAdapter!.setSidetoneFrequency(freq);
    }

    setExtendedOptions(options: Record<string, any>): Promise<void> {
        this.assertConnected();
        return this.protocolAdapter!.setExtendedOptions(options);
    }

}
