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
 * Winkeyer 2.3 Protocol Implementation
 *
 * Full implementation of the Winkeyer 2.3 host mode protocol for controlling
 * morse code keyers via serial port. Includes command builders, status parsing,
 * and serial transport wrapper.
 *
 * Reference: Winkeyer 2.3 Host Mode Protocol
 */

import type { KeyerMode, KeyerStatus, KeyingMode, ProtocolAdapter } from "./index";

/**
 * Command codes sent from host to Winkeyer device
 */
export enum WinkeyerCommand {
  ADMIN = 0x00,
  SET_SIDETONE = 0x01, /* 1..10 */
  SET_SPEED = 0x02, /* 5 .. 99 WPM */
  SET_WEIGHTING = 0x03, /* 10 .. 90 */
  PTT_LEADTAIL = 0x04, /* 0..250 x10 ms */
  SET_SPEED_POT = 0x06, /* min, range, 0x00 */
  SET_PAUSE = 0x08, /* 0 off 1 on */
  GET_SPEED_POT = 0x07, /* returns 0x80 + 0 ... 0x1F */
  BUFFER_BACKSPACE = 0x08,
  SET_PINCONFIG = 0x09, /* config mask */
  CLEAR_BUFFER = 0x0A,
  KEY_IMMEDIATE = 0x0B,
  SET_HSCW = 0x0C, /* LPM /100, i.e. 20 == 2000 LPM */
  SET_FARNSWORTH = 0x0D, /* effective WPM */
  SET_MODE = 0x0E,
  SET_DEFAULTS = 0x0F, /* 15 bytes of config data */
  SET_1ST_EXT = 0x10, /* 0 .. 250 ms */
  SET_KEY_COMP = 0x11, /* 0 .. 250 ms */
  SET_PADDLE_SWITCHPOINT = 0x12, /* 10 .. 90, default 50 = one dit */
  NULL_CMD = 0x13,
  SWPADDLE = 0x14, /* software paddle bit 0 = dit, bit 1 = dah */
  REQ_STATUS = 0x15,
  SET_POINTER = 0x16, /* 0 = reset, 1 = move to + overwrite, 2 = move to + insert, 03 = add nulls; second byte is position or count of nulls */
  DITDAH_RATIO = 0x17, /* 33 .. 66, default 50 */
  BUFFERED_PTT = 0x18, /* 0 = off, 1 = on */
  BUFFERED_KEYDOWN = 0x19, /* 0 .. 99 seconds */
  BUFFERED_WAIT = 0x1a, /* 0 .. 99 seconds */
  MERGE_LETTERS = 0x1b, /* char1, char2 */
  BUFFERED_SPEED = 0x1c, /* 5 .. 99 WPM */
  BUFFERED_HSCW = 0x1d, /* LPM /100 */
  BUFFERED_SPEED_OFF = 0x1e,
  BUFFERED_NOP = 0x1f,
  LOAD_BUFFER = 0x15
}

/**
 * Admin sub-commands (used with ADMIN command)
 */
export enum AdminCommand {
  COLD_RESET = 0x01,
  HOST_OPEN = 0x02,
  HOST_CLOSE = 0x03,
  GET_FIRMWARE_VERSION = 0x09,
  SET_WK2_MODE = 0x0B
}

/**
 * Decoded Winkeyer status byte.
 * Format: 110x0xxx
 */
export interface WinkeyerStatusByte {
  kind: "winkeyer-status";
  raw: number;
  waiting: boolean;
  keydown: boolean;
  busy: boolean;
  paddleBreakIn: boolean;
  xoff: boolean;
}

/**
 * Winkeyer device mode configuration
 */
export interface WinkeyerMode extends KeyerMode {
  disableWatchdog?: boolean; // 0x80 bit in mode register
  // paddleEcho?: boolean; // 0x40 bit in mode register
  // keyingMode?: KeyingMode; // 0x30 bit mask in mode register
  paddleSwap?: boolean; // 0x08 bit in mode register
  // bufferEcho?: boolean; // 0x04 bit in mode register
  autospace?: boolean; // 0x02 bit in mode register
  contestSpacing?: boolean; // 0x01 bit in mode register
  // Winkeyer does not have paddle break, it is always on
  paddleBreak?: boolean;
}

/**
 * Speed potentiometer configuration
 */
export interface SpeedPotParameters {
  minWpm: number;
  maxWpm: number;
}

/**
 * Message slot identifiers
 */
export enum MessageSlot {
  MESSAGE_1 = 0x00,
  MESSAGE_2 = 0x01,
  MESSAGE_3 = 0x02,
  MESSAGE_4 = 0x03,
  MESSAGE_5 = 0x04,
  MESSAGE_6 = 0x05
}

/**
 * Convert plain text to ASCII bytes for Winkeyer transmission
 * Winkeyer receives and transmits plain ASCII text
 */
export function textToBytes(text: string): Uint8Array {
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
  return bytes;
}

export interface WinkeyerAdapterHooks {
  setStatus: (status: KeyerStatus) => void;
  echoAscii: (ascii: string) => void;
  sendBytes: (data: Uint8Array) => Promise<void>;
}

/**
 * ProtocolAdapter implementation for Winkeyer over an existing SerialSession.
 */
export class WinkeyerProtocolAdapter implements ProtocolAdapter {
  private pendingResolve: (() => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;
  private speedPotMinWpm = 5;
  private status: KeyerStatus = {};
  private expectVersion = false;
  private keyingMode : WinkeyerMode = {};
  private sidetoneFreq = 700;
  private weight = 1.0;
  private dahDitRatio = 3.0;
  private defaultsBuffer: number[] = [];
  private pendingDefaultsResolve: ((bytes: Uint8Array) => void) | null = null;
  private pendingDefaultsReject: ((error: Error) => void) | null = null;

  constructor(private readonly hooks: WinkeyerAdapterHooks) { }

  /**
   * @param weighting 1 = weighting 1:1, >1 is more key down time, <1 means more space time
   * It is converted to winkeyer parameter, clamped and applied
   */
  setWeighting(weighting: number): Promise<void> {
    this.weight = weighting;
    let wkWeighting = Math.round(weighting * 50);
    wkWeighting = Math.max(10, Math.min(90, wkWeighting));
    return this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.SET_WEIGHTING, wkWeighting]));
  }
  /**
   * 
   * @param ratio dash to dit ratio, default 3.0. It is converted to winkeyer parameter, clamped and applied. Winkeyer default is 3.0, and it accepts 33..66 (i.e. 3.0 .. 6.0) with 50 (3.0) as the default. Note that this is a different parameter from the weighting; changing this does not change the overall speed, only the relative length of dahs to dits. 
   * @returns 
   */
  setDashRatio(ratio: number): Promise<void> {
    this.dahDitRatio = ratio;
    let wkRatio = Math.round(ratio/3 * 50);
    wkRatio = Math.max(33, Math.min(66, wkRatio));
    return this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.DITDAH_RATIO, wkRatio]));
  }

  /**
   * 
   * @returns 
   */
  private getKeyingModeByte (): number {
    return (this.keyingMode.paddleEcho ? 0x40 : 0x00) |
      ((this.keyingMode.keyingMode ?? 0) << 4) |
      (this.keyingMode.bufferEcho ? 0x04 : 0x00) |
      (this.keyingMode.paddleBreak ? 0x02 : 0x00) |
      (this.keyingMode.autospace ? 0x02 : 0x00) | 
      (this.keyingMode.paddleSwap ? 0x08 : 0x00) |
      (this.keyingMode.disableWatchdog ? 0x80 : 0x00) |
      (this.keyingMode.contestSpacing ? 0x01 : 0x00);
  }

  /**
   * 
   * @param mode : standard set of keying options used for computer-driven keying
   * @returns Promise resolving after data had been transferred to the keyer serial port
   */
  setKeyerMode(mode: KeyerMode): Promise<void> {
    this.keyingMode = { ...this.keyingMode, ...mode} as WinkeyerMode; // merge with existing mode, so that we can set multiple parameters independently without overwriting others. Winkeyer mode is a bitfield, so we need to combine all the parameters into a single byte.
    let wkMode = this.getKeyingModeByte();
    console.log("Setting Winkeyer mode byte to 0x" + wkMode.toString(16).padStart(2, "0"));
    return this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.SET_MODE, wkMode]));  
  }

  /**
   * @param options : other non-essential keying options, Winkeyer-specific. Tolerates any options not defined in WinkeyerMode, but only the defined ones will be applied. This is to allow future expansion without changing the method signature. 
   * @returns Promise resolving after data had been transferred to the keyer serial port
   */
  setExtendedOptions(options: Record<string, any>): Promise<void> {
    // throw new Error("Method not implemented.");
    this.keyingMode = { ...this.keyingMode, ...options} as WinkeyerMode; // merge with existing mode, so that we can set multiple parameters independently without overwriting others. Winkeyer mode is a bitfield, so we need to combine all the parameters into a single byte.
    let wkMode = this.getKeyingModeByte();
    return this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.SET_MODE, wkMode]));  
  }

  getWpm(): number | undefined {
    return this.status.wpm;
  }

  getWeighting(): number {
    return this.weight;
  }

  getKeyerMode(): KeyerMode {
    return { ...this.keyingMode };
  }

  getDashRatio(): number {
    return this.dahDitRatio;
  }

  getSidetoneFrequency(): number {
    return this.sidetoneFreq;
  }

  handleIncomingData(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) {
      const b = data[i];

      // Collect defaults response bytes (checked before pendingResolve)
      if (this.pendingDefaultsResolve) {
        this.defaultsBuffer.push(b);
        if (this.defaultsBuffer.length >= 15) {
          const bytes = new Uint8Array(this.defaultsBuffer);
          const cb = this.pendingDefaultsResolve;
          this.pendingDefaultsResolve = null;
          this.pendingDefaultsReject = null;
          this.defaultsBuffer = [];
          cb(bytes);
        }
        continue;
      }

      // Check if we're waiting for a response
      if (this.pendingResolve) {
        // handles version response
        if (this.expectVersion) {
          // 0xFF with Winkeyer means that the port is open at 1200 Bd
          //  but the physical keyer probably communicates at 9600 Bd or higher  
          if (b === 0xff) {
            const reject = this.pendingReject;
            this.pendingResolve = null;
            this.pendingReject = null;
            this.expectVersion = false;
            reject?.(new Error("Winkeyer returned 0xFF to HOST OPEN — keyer may use different baud rate"));
            continue;
          }
          const version = `${Math.floor(b / 10)}.${b % 10}`;
          this.status.version = version;
          this.pendingResolve();
          this.pendingResolve = null;
          this.pendingReject = null;
          this.expectVersion = false;
          continue;
        }
        // not a version ; unexpected response byte
        this.pendingReject?.(new Error(`Unexpected response byte 0x${b.toString(16)} while waiting for version`));
        this.pendingResolve = null;
        this.pendingReject = null;
        this.expectVersion = false;
        continue;
      }
      // ASCII character echo
      if (b >= 0x20 && b <= 0x7F) {
        this.hooks.echoAscii(String.fromCharCode(b));
        continue;
      }
      // WPM value
      if ((b & 0xc0) === 0x80) {
        // change only WPM but report full status
        this.status.wpm = (b & 0x1f) + this.speedPotMinWpm;
        this.hooks.setStatus(this.status);
        continue;
      }
      // Status byte
      if ((b & 0xe8) === 0xc0) {
        console.log(`STATUS 0b${b.toString(2).padStart(8, "0")} = 0x${b.toString(16).padStart(2, "0")}`);
        this.status.busy = !!(b & 0x10);
        this.status.emit = !!(b & 0x04);
        this.status.full = !!(b & 0x01);
        this.status.break = !!(b & 0x02);
        this.hooks.setStatus(this.status);
      }
    }
  }

  /**
   * Sends HOST OPEN and waits for the firmware version byte response.
   * If the keyer responds with 0xFF the keyer is permanently locked; throws immediately.
   */
  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.expectVersion = true;

      this.hooks.sendBytes(
        new Uint8Array([WinkeyerCommand.ADMIN, AdminCommand.HOST_OPEN])
      ).catch((error) => {
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(error);
      });

      // Timeout after 500ms
      const timeoutId = setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          this.pendingReject = null;
          this.expectVersion = false;
          reject(new Error("Host open response timeout"));
        }
      }, 500);

      const resolveWithCleanup = this.pendingResolve;
      this.pendingResolve = () => {
        clearTimeout(timeoutId);
        this.expectVersion = false;
        this.status.isOpen = true;
        this.hooks.setStatus(this.status);
        resolveWithCleanup();
      };

      const rejectWithCleanup = this.pendingReject;
      this.pendingReject = (error: Error) => {
        clearTimeout(timeoutId);
        this.expectVersion = false;
        rejectWithCleanup(error);
      };
    });
  }

  async getVersion(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.expectVersion = true;

      const cmd = new Uint8Array([
        WinkeyerCommand.ADMIN,
        AdminCommand.GET_FIRMWARE_VERSION
      ]);

      this.hooks.sendBytes(cmd).catch((error) => {
        this.pendingResolve = null;
        this.pendingReject = null;
        this.expectVersion = false;
        reject(error);
      });

      // Timeout after 500ms
      const timeoutId = setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          this.pendingReject = null;
          this.expectVersion = false;
          reject(new Error("Version response timeout"));
        }
      }, 500);

      const resolveWithCleanup = this.pendingResolve;
      this.pendingResolve = () => {
        clearTimeout(timeoutId);
        this.expectVersion = false;
        resolveWithCleanup();
      };

      const rejectWithCleanup = this.pendingReject;
      this.pendingReject = (error: Error) => {
        clearTimeout(timeoutId);
        this.expectVersion = false;
        rejectWithCleanup(error);
      };
    });
  }

  async init(): Promise<void> {
    // first get defaults, which will populate the keyer state and allow us to respond to status updates with the correct information. Winkeyer does not provide a way to query individual parameters, so we have to get them all at once and decode them.
    await this.getDefaults();
    await this.open();
    // Set WK2 mode, don't be surprised by double beep
    await this.hooks.sendBytes(
      new Uint8Array([WinkeyerCommand.ADMIN, AdminCommand.SET_WK2_MODE])
    );
    // reset buffers and state
    await this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.CLEAR_BUFFER]));
  }

  /**
   * Resets buffer and stops all transmission immediately.
   */
  async break(): Promise<void> {
    await this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.CLEAR_BUFFER]));
  }

  async sendCw(text: string): Promise<void> {
    const bytes = new Uint8Array(textToBytes(text.toUpperCase()));
    await this.hooks.sendBytes(bytes);
  }

  async setWpm(wpm: number): Promise<void> {
    const clamped = Math.max(5, Math.min(99, wpm));
    this.status.wpm = clamped;
    await this.hooks.sendBytes(new Uint8Array([0x02, clamped]));
  }

  async setSidetoneFrequency(freq: number): Promise<void> {
    const inverse = Math.round(4000 / freq); // Winkeyer sidetone frequency is based on a 4000 Hz clock divided by the value sent
    const clamped = Math.max(1, Math.min(10, inverse));
    await this.hooks.sendBytes(new Uint8Array([0x01, clamped]));
  }

  private decodeDefaults(bytes: Uint8Array): void {
    // Byte 1 (index 0): mode register
    const modeByte = bytes[0];
    this.keyingMode = {
      ...this.keyingMode,
      disableWatchdog: !!(modeByte & 0x80),
      paddleEcho: !!(modeByte & 0x40),
      keyingMode: ((modeByte >> 4) & 0x03) as KeyerMode["keyingMode"],
      paddleSwap: !!(modeByte & 0x08),
      bufferEcho: !!(modeByte & 0x04),
      autospace: !!(modeByte & 0x02),
      contestSpacing: !!(modeByte & 0x01),
    };

    // Byte 2 (index 1): current WPM speed (true speed, not offset by minWPM)
    this.status.wpm = bytes[1];

    // Byte 3 (index 2): sidetone setup — lower nibble is WK divisor, freq = 4000 / divisor
    const sidetoneDivisor = bytes[2] & 0x0F;
    if (sidetoneDivisor > 0) {
      this.sidetoneFreq = Math.round(4000 / sidetoneDivisor);
    }

    // Byte 4 (index 3): weighting (10–90 WK scale), convert to user-facing ratio (1.0 = normal)
    this.weight = bytes[3] / 50;

    // Byte 7 (index 6): minimum WPM for speed pot range
    this.speedPotMinWpm = bytes[6];

    // Byte 13 (index 12): dah/dit ratio (WK value 50 == ratio 3.0)
    this.dahDitRatio = (bytes[12] / 50) * 3.0;
  }

  private getDefaults(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.defaultsBuffer = [];

      const timeoutId = setTimeout(() => {
        const count = this.defaultsBuffer.length;
        this.pendingDefaultsResolve = null;
        this.pendingDefaultsReject = null;
        this.defaultsBuffer = [];
        reject(new Error(`getDefaults timeout: received only ${count} of 15 bytes`));
      }, 5000);

      this.pendingDefaultsResolve = (bytes: Uint8Array) => {
        clearTimeout(timeoutId);
        this.decodeDefaults(bytes);
        resolve();
      };

      this.pendingDefaultsReject = (error: Error) => {
        clearTimeout(timeoutId);
        this.pendingDefaultsResolve = null;
        this.pendingDefaultsReject = null;
        this.defaultsBuffer = [];
        reject(error);
      };

      this.hooks.sendBytes(new Uint8Array([WinkeyerCommand.ADMIN, 0x07])).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingDefaultsResolve = null;
        this.pendingDefaultsReject = null;
        this.defaultsBuffer = [];
        reject(error);
      });
    });
  }

  async close(): Promise<void> {
    await this.hooks.sendBytes(
      new Uint8Array([WinkeyerCommand.ADMIN, AdminCommand.HOST_CLOSE])
    );
    this.status.isOpen = false;
  }
}
