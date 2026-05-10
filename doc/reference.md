# hamkeyer — API Reference

This document covers the full public API of the `hamkeyer` library.

---

## Table of Contents

1. [Overview](#overview)
2. [CWKeyer](#cwkeyer)
   - [Factory](#factory)
   - [Environment detection](#environment-detection)
   - [Connection](#connection)
   - [Lifecycle](#lifecycle)
   - [Sending CW](#sending-cw)
   - [Speed and mode](#speed-and-mode)
   - [Keying characteristics](#keying-characteristics)
   - [Reflection](#reflection)
   - [Status and events](#status-and-events)
3. [NodeCWKeyer](#nodecwkeyer)
4. [Types and enums (core)](#types-and-enums-core)
   - [KeyerMode](#keyermode)
   - [KeyingMode](#keyingmode)
   - [KeyerStatus](#keyerstatus)
   - [SerialSession](#serialsession)
5. [Winkeyer protocol adapter](#winkeyer-protocol-adapter)
   - [WinkeyerProtocolAdapter](#winkeyer-protocol-adapter-class)
   - [WinkeyerMode](#winkeyermode)
   - [WinkeyerCommand](#winkeyercommand)
   - [AdminCommand](#admincommand)
   - [WinkeyerStatusByte](#winkeyerstatusbyte)
   - [SpeedPotParameters](#speedpotparameters)
   - [MessageSlot](#messageslot)
   - [textToBytes()](#texttobytes)
6. [Serial session factories](#serial-session-factories)
   - [createWebSerialSession()](#createwebserialsession)
   - [createNodeSerialSession()](#createnodeserialsession)
   - [Web Serial helpers](#web-serial-helpers)

---

## Overview

`hamkeyer` is a TypeScript library for controlling hardware CW keyers (morse code) over a serial port. It supports both **browser** (via the Web Serial API) and **Node.js** (via the `serialport` package).

```
┌──────────────┐    SerialSession     ┌──────────────────────────┐
│   CWKeyer    │ ──────────────────── │ WinkeyerProtocolAdapter  │
│  (high-level)│                      │  (Winkeyer 3.1 protocol) │
└──────────────┘                      └──────────────────────────┘
       │                                           │
  (events)                                   (bytes in/out)
       │                                           │
  StatusListener                          SerialSession
  EchoListener                      ┌──────────────────────────┐
                                    │  createWebSerialSession  │  ← browser
                                    │  createNodeSerialSession │  ← Node.js
                                    └──────────────────────────┘
```

### Imports

```typescript
// Universal (browser + Node.js)
import { CWKeyer, KeyingMode } from "hamkeyer";
import { createNodeSerialSession } from "hamkeyer";  // Node.js only

// Node.js convenience class (includes connectWithSerialPort)
import { NodeCWKeyer } from "hamkeyer/core-node";

// Browser-only build (no serialport dependency)
import { CWKeyer, KeyingMode } from "hamkeyer/browser";
```

---

## CWKeyer

The main entry point for all keyer interactions. Manages connection, protocol, and events.

### Factory

#### `CWKeyer.create(keyerType: string): CWKeyer`

Creates a new keyer instance. Currently the only supported `keyerType` is `"winkeyer"`.

```typescript
const keyer = CWKeyer.create("winkeyer");
```

#### `suggestDefaultBaudrate(): number`

Returns the recommended baud rate for the keyer type. For Winkeyer this is `1200`; for unknown types it returns `9600`.

```typescript
const baud = keyer.suggestDefaultBaudrate(); // 1200 for winkeyer
```

---

### Environment detection

#### `isBrowser(): boolean`

Returns `true` when running inside a browser (i.e. `window` is defined).

#### `hasWebSerial(): boolean`

Returns `true` when the browser supports the Web Serial API (`navigator.serial` is available).

---

### Connection

A keyer must be connected to a serial session before any commands can be sent.

#### `connect(baud: number): Promise<void>` *(browser only)*

Opens a port-picker dialog (Web Serial API `requestPort()`), opens the chosen port at `baud`, and connects. Throws if the Web Serial API is not available.

```typescript
await keyer.connect(1200);
```

#### `connectWithSession(session: SerialSession): Promise<void>`

Connects using any pre-built `SerialSession`. Works in both browser and Node.js. This is the lowest-level connection method and the one used in Node.js tests and standalone scripts.

```typescript
import { SerialPort } from "serialport";
import { createNodeSerialSession } from "hamkeyer";

const port = new SerialPort({ path: "COM10", baudRate: 1200 });
port.once("open", async () => {
    const session = createNodeSerialSession(port);
    await keyer.connectWithSession(session);
});
```

> Only one session may be active at a time. Calling `connectWithSession()` while already connected throws `"Keyer is already connected."`.

---

### Lifecycle

#### `init(): Promise<void>`

Initialises the keyer hardware. For Winkeyer this sends HOST OPEN, enables WK2 mode, configures the speed-pot range, and clears the transmit buffer. Must be called after `connectWithSession()` / `connect()` / `connectStandalone()` before sending CW.

```typescript
await keyer.init();
```

Throws if the Winkeyer responds with `0xFF` which could mean that the keyer is actually commuicating at 9600 bps but the port is set to 1200 bps or if no version byte is received within 500 ms.

For other types of keyers (e.g. Spider Keyer) the error condition might differ.

#### `close(): Promise<void>`

Sends the protocol-specific close command (Winkeyer: HOST CLOSE) and then calls `disconnect()`.

#### `disconnect(): Promise<void>`

Closes the serial session without sending any protocol commands. Resets all internal state. Safe to call even if `init()` was never invoked.

---

### Sending CW

#### `sendCw(text: string): Promise<void>`

Queues ASCII text for buffer transmission as CW. The text is uppercased before sending. Only printable ASCII characters (0x20–0x7F) are allowed; non-ASCII characters throw.

All Winkeyer buffered command bytes (`0x16`–`0x1F`) are passed through without validation. The caller is responsible for correctly including any required parameter bytes after a command byte:

| Byte | Command | Parameters |
|---|---|---|
| `0x16 n` | `SET_POINTER` | Position/count byte |
| `0x17 n` | `DITDAH_RATIO` | Ratio byte (33–66) |
| `0x18 n` | `BUFFERED_PTT` | 0 = off, 1 = on |
| `0x19 n` | `BUFFERED_KEYDOWN` | Key-down time in seconds (0–99) |
| `0x1A n` | `BUFFERED_WAIT` | Pause in seconds (0–99) |
| `0x1B a b` | `MERGE_LETTERS` | Two ASCII character bytes |
| `0x1C n` | `BUFFERED_SPEED` | Speed in WPM (5–99) |
| `0x1D n` | `BUFFERED_HSCW` | High-speed CW (LPM / 100) |
| `0x1E` | `BUFFERED_SPEED_OFF` | No parameters |
| `0x1F` | `BUFFERED_NOP` | No parameters |

```typescript
await keyer.sendCw("CQ CQ DE OK1RAA");
```

#### `break(): Promise<void>`

Immediately stops transmission and clears the keyer's transmit buffer.

---

### Speed and mode

#### `setWpm(wpm: number): Promise<void>`

Sets the CW speed in words per minute. Clamped to 5–99 WPM.

```typescript
await keyer.setWpm(20);
```

#### `setKeyerMode(mode: KeyerMode): Promise<void>`

Configures keying characteristics. The supplied `mode` is merged with the current mode state, so you can update individual fields without overwriting others.

```typescript
await keyer.setKeyerMode({
    keyingMode: KeyingMode.IAMBIC_B,
    paddleEcho: true,
    bufferEcho: true,
});
```

See [KeyerMode](#keyermode) for all fields.

---

### Keying characteristics

#### `setWeighting(weighting: number): Promise<void>`

Adjusts the dit/dah element weight. `1.0` is normal (equal on/off balance). Values above `1.0` increase key-down time; values below `1.0` increase space time. Converted to the Winkeyer range 10–90 and clamped.

```typescript
await keyer.setWeighting(1.1);  // slightly heavier dits/dahs
```

#### `setDashRatio(ratio: number): Promise<void>`

Sets the dit:dah length ratio. The standard value is `3.0` (a dah is three times a dit). Converted to the Winkeyer range 33–66 and clamped.

```typescript
await keyer.setDashRatio(3.0);  // standard ratio
```

#### `setSidetoneFrequency(freq: number): Promise<void>`

Sets the sidetone pitch in Hz. Converted to a Winkeyer divisor (`4000 / freq`), clamped to 1–10 (approximately 400 Hz – 4 kHz).

```typescript
await keyer.setSidetoneFrequency(700);  // 700 Hz sidetone
```

#### `setExtendedOptions(options: Record<string, any>): Promise<void>`

Sets adapter-specific options not covered by the standard `KeyerMode` interface. For Winkeyer, accepts any fields of [`WinkeyerMode`](#winkeyermode) and merges them into the current mode state.

```typescript
await keyer.setExtendedOptions({ paddleSwap: true, autospace: true });
```

---

### Reflection

These methods return the current locally-tracked value for each keyer parameter. They reflect the last value set by the corresponding setter (or the adapter's initial default), not a value read back from the hardware.

#### `getWpm(): number | undefined`

Returns the WPM last reported in a hardware status byte, or `undefined` if no speed update has been received yet.

#### `getWeighting(): number`

Returns the current weighting value (default `1.0`).

#### `getKeyerMode(): KeyerMode`

Returns a shallow copy of the current keyer mode state.

#### `getDashRatio(): number`

Returns the current dit:dah ratio (default `3.0`).

#### `getSidetoneFrequency(): number`

Returns the current sidetone frequency in Hz (default `700`).

---

### Status and events

#### `getVersion(): string | null`

Returns the firmware version string (e.g. `"3.1"`) as reported by the keyer after `init()`, or `null` if not yet available.

#### `getStatus(): KeyerStatus`

Returns a snapshot of the current keyer status. See [KeyerStatus](#keyerstatus).

#### `getEchoAscii(): string`

Returns the accumulated ASCII echo buffer (characters sent back by the keyer during or after transmission).

#### `on(eventName: "status" | "echo", listener): void`

Subscribes to an event.

| Event | Listener signature | Fired when |
|---|---|---|
| `"status"` | `(status: KeyerStatus) => void` | Any status field changes |
| `"echo"` | `(ascii: string) => void` | A single ASCII character is echoed back by the keyer |

Listeners are called asynchronously (via `queueMicrotask`).

```typescript
keyer.on("status", (s) => {
    console.log("WPM:", s.wpm, "Busy:", s.busy);
});

keyer.on("echo", (ch) => process.stdout.write(ch));
```

#### `off(eventName: "status" | "echo", listener): void`

Removes a previously registered listener. The `listener` reference must be the same function passed to `on()`.

---

## NodeCWKeyer

`NodeCWKeyer` extends `CWKeyer` with a single-call convenience method for Node.js environments. It is exported from `src/core-node.ts` (or `hamkeyer/core-node` in a published build).

### Factory

#### `NodeCWKeyer.create(keyerType: string): NodeCWKeyer`

Overrides `CWKeyer.create()` and returns a `NodeCWKeyer` instance.

```typescript
const keyer = NodeCWKeyer.create("winkeyer");
```

### Connection

#### `connectWithSerialPort(portPath: string, baud?: number): Promise<void>`

Opens the given serial port at `baud` (default `1200`) using the Node.js `serialport` package, wraps it in a `SerialSession`, and calls `connectWithSession()`. This replaces the manual `new SerialPort` + `createNodeSerialSession` + `connectWithSession` sequence.

```typescript
import { NodeCWKeyer } from "../../src/core-node";

const keyer = NodeCWKeyer.create("winkeyer");
await keyer.connectWithSerialPort("COM10", 1200);
await keyer.init();
await keyer.sendCw("DE OK1RAA");
await keyer.close();
```

All other `CWKeyer` methods (`init()`, `sendCw()`, `setWpm()`, `close()`, events, etc.) are inherited unchanged.

---

## Types and enums (core)

### KeyerMode

Keying characteristics shared across all protocol adapters.

```typescript
interface KeyerMode {
    keyingMode?: KeyingMode;   // Iambic mode, Ultimatic, Bug
    paddleEcho?: boolean;      // Echo paddle presses as ASCII to host
    bufferEcho?: boolean;      // Echo buffered characters as ASCII to host
    paddleBreak?: boolean;     // Paddle press interrupts buffered transmission
}
```

This interface type may be further extended if type of keyer other than 
Winkeyer protocol required additional features necessary for essential interaction with a computer application.

Also, the actual protocol adapters internally use keyer mode type extending KeyerMode to accommodate their specific features.

### KeyingMode

```typescript
enum KeyingMode {
    IAMBIC_B  = 0,   // Standard Curtis B squeeze keying (default)
    IAMBIC_A  = 1,   // Curtis A — no trailing element completion
    ULTIMATIC = 2,   // Last-paddle-pressed wins
    BUG       = 3,   // Semi-automatic (bug) mode
}
```

### KeyerStatus

Snapshot of the keyer's reported state. Fields are updated asynchronously as status bytes arrive from the hardware.

```typescript
interface KeyerStatus {
    keyerType?: string;   // e.g. "winkeyer"
    isOpen?: boolean;     // true after HOST OPEN, false after HOST CLOSE / disconnect
    version?: string;     // Firmware version string, e.g. "3.1"
    emit?: boolean;       // true while the keyer is actively transmitting
    full?: boolean;       // true when the transmit buffer is full
    wpm?: number;         // Current WPM (from speed pot or SET_SPEED)
    busy?: boolean;       // true while keying hardware is busy
    break?: boolean;      // true when paddle break-in has occurred
}
```

### SerialSession

Transport-agnostic serial session interface. Implemented by `createWebSerialSession()` (browser) and `createNodeSerialSession()` (Node.js).

```typescript
interface SerialSession {
    writeBytes(data: Uint8Array): Promise<void>;
    writeText(text: string): Promise<void>;
    disconnect(): Promise<void>;
    on(listener: (data: Uint8Array) => void): void;
    off(listener: (data: Uint8Array) => void): void;
}
```

---

## Winkeyer protocol adapter

The `WinkeyerProtocolAdapter` implements subset of the Winkeyer 2 host mode protocol and its subset should be also fully compatible with Winkeyer 3. It is created automatically by `CWKeyer.create("winkeyer")` and is not normally instantiated directly. The enums and types below are exported for advanced use.

### WinkeyerProtocolAdapter class

Implements `ProtocolAdapter`. Constructed with an `WinkeyerAdapterHooks` object that wires it to a `CWKeyer` instance. In addition to the methods delegated by `CWKeyer`, it exposes the following Winkeyer-specific commands:

| Method | Description |
|---|---|
| `setWeighting(weighting: number)` | Adjusts dit/dah weight. `1.0` = normal, `>1.0` = more key-down, `<1.0` = more space. Converted to Winkeyer range 10–90. |
| `setDashRatio(ratio: number)` | Sets the dit:dah ratio. Normal value is `3.0` (3:1). Converted to Winkeyer range 33–66. |
| `setSidetoneFrequency(freq: number)` | Sets sidetone frequency in Hz. Converted to Winkeyer divisor (4000 / freq), clamped to 1–10. |
| `setExtendedOptions(options: WinkeyerMode)` | Sets Winkeyer-specific mode bits (see [WinkeyerMode](#winkeyermode)) merged into the current mode. |
| `getWpm()` | Returns the WPM from the last received hardware status byte, or `undefined`. |
| `getWeighting()` | Returns the current weighting (default `1.0`). |
| `getKeyerMode()` | Returns a shallow copy of the current keyer mode state. |
| `getDashRatio()` | Returns the current dit:dah ratio (default `3.0`). |
| `getSidetoneFrequency()` | Returns the current sidetone frequency in Hz (default `700`). |

> These methods are also available directly on `CWKeyer` (`setWeighting`, `setDashRatio`, `setSidetoneFrequency`, `setExtendedOptions`). The adapter-level implementations are documented here for completeness.

---

### WinkeyerMode

Extends `KeyerMode` with Winkeyer-specific bitfield options. Used with `setExtendedOptions()`.

```typescript
interface WinkeyerMode extends KeyerMode {
    disableWatchdog?: boolean;  // Bit 7 — disable the 10-second host watchdog
    paddleSwap?: boolean;       // Bit 3 — swap dit and dah paddles
    autospace?: boolean;        // Bit 1 — automatic word spacing
    contestSpacing?: boolean;   // Bit 0 — contest (5/6 dit) word spacing
}
```

> `paddleEcho`, `bufferEcho`, `keyingMode`, and `paddleBreak` come from `KeyerMode` and are all supported.

---

### WinkeyerCommand

All host-to-device command bytes defined by the Winkeyer 3.1 protocol.

| Constant | Value | Description |
|---|---|---|
| `ADMIN` | `0x00` | Admin command prefix (followed by an `AdminCommand` byte) |
| `SET_SIDETONE` | `0x01` | Sidetone divisor (1–10) |
| `SET_SPEED` | `0x02` | CW speed in WPM (5–99) |
| `SET_WEIGHTING` | `0x03` | Dit/dah weighting (10–90) |
| `PTT_LEADTAIL` | `0x04` | PTT lead/tail times (×10 ms, 0–250) |
| `SET_SPEED_POT` | `0x06` | Speed pot: min WPM, span, reserved |
| `GET_SPEED_POT` | `0x07` | Request speed pot position |
| `SET_PAUSE` | `0x08` | Pause/resume transmission (0 = off, 1 = on) |
| `BUFFER_BACKSPACE` | `0x08` | Delete last buffered character |
| `SET_PINCONFIG` | `0x09` | I/O pin configuration mask |
| `CLEAR_BUFFER` | `0x0A` | Stop transmission, clear buffer |
| `KEY_IMMEDIATE` | `0x0B` | Key the output immediately |
| `SET_HSCW` | `0x0C` | High-speed CW speed (LPM / 100) |
| `SET_FARNSWORTH` | `0x0D` | Farnsworth character spacing WPM |
| `SET_MODE` | `0x0E` | Mode register (see mode bitfield) |
| `SET_DEFAULTS` | `0x0F` | Load 15-byte default configuration |
| `SET_1ST_EXT` | `0x10` | First extension (0–250 ms) |
| `SET_KEY_COMP` | `0x11` | Keying compensation (0–250 ms) |
| `SET_PADDLE_SWITCHPOINT` | `0x12` | Paddle switch point (10–90, default 50) |
| `NULL_CMD` | `0x13` | No-operation |
| `SWPADDLE` | `0x14` | Software paddle (bit 0 = dit, bit 1 = dah) |
| `REQ_STATUS` | `0x15` | Request current status byte |
| `LOAD_BUFFER` | `0x15` | Load message buffer |
| `SET_POINTER` | `0x16` | Buffer pointer control |
| `DITDAH_RATIO` | `0x17` | Dit:dah ratio (33–66, default 50) |
| `BUFFERED_PTT` | `0x18` | Buffered PTT on/off |
| `BUFFERED_KEYDOWN` | `0x19` | Buffered key-down time (0–99 s) |
| `BUFFERED_WAIT` | `0x1A` | Buffered wait (0–99 s) |
| `MERGE_LETTERS` | `0x1B` | Merge two characters into one |
| `BUFFERED_SPEED` | `0x1C` | Buffered speed change (5–99 WPM) |
| `BUFFERED_HSCW` | `0x1D` | Buffered high-speed CW |
| `BUFFERED_SPEED_OFF` | `0x1E` | Cancel buffered speed |
| `BUFFERED_NOP` | `0x1F` | Buffered no-operation |

---

### AdminCommand

Sub-commands used with `WinkeyerCommand.ADMIN` (`0x00`).

| Constant | Value | Description |
|---|---|---|
| `COLD_RESET` | `0x01` | Factory reset |
| `HOST_OPEN` | `0x02` | Enter host mode; keyer replies with firmware version byte |
| `HOST_CLOSE` | `0x03` | Exit host mode |
| `GET_FIRMWARE_VERSION` | `0x09` | Request firmware version byte |
| `SET_WK2_MODE` | `0x0B` | Enable WK2 (extended) mode |

> The version byte returned by HOST OPEN / GET_FIRMWARE_VERSION is encoded as `(major * 10 + minor)`, e.g. `31` → `"3.1"`.

---

### WinkeyerStatusByte

Structure of a decoded Winkeyer status byte (pattern `110x0xxx`).

```typescript
interface WinkeyerStatusByte {
    kind: "winkeyer-status";
    raw: number;
    waiting: boolean;       // Bit 4 — keyer is waiting for next character
    keydown: boolean;       // Bit 3 — key output is currently active
    busy: boolean;          // Bit 2 — keyer is sending (buffer not empty)
    paddleBreakIn: boolean; // Bit 1 — paddle break-in has occurred
    xoff: boolean;          // Bit 0 — buffer full (flow control)
}
```

---

### SpeedPotParameters

Used when configuring speed-pot range (command `0x05`).

```typescript
interface SpeedPotParameters {
    minWpm: number;   // Minimum WPM at pot fully CCW
    maxWpm: number;   // Maximum WPM at pot fully CW
}
```

The internal adapter uses `minWpm = 5` and a span of `0x1F` (31 steps). WPM updates from the keyer are reported as an offset from `minWpm`.

---

### MessageSlot

Identifiers for the six non-volatile message slots in Winkeyer.

```typescript
enum MessageSlot {
    MESSAGE_1 = 0x00,
    MESSAGE_2 = 0x01,
    MESSAGE_3 = 0x02,
    MESSAGE_4 = 0x03,
    MESSAGE_5 = 0x04,
    MESSAGE_6 = 0x05,
}
```

---

### textToBytes()

```typescript
function textToBytes(text: string): Uint8Array
```

Converts a plain ASCII string to a `Uint8Array` for direct transmission to Winkeyer. Throws if any character is outside the ASCII range (code > 127). Used internally by `sendCw()`.

---

## Serial session factories

### createWebSerialSession()

```typescript
function createWebSerialSession(port: SerialPort): SerialSession
```

Wraps an already-opened Web Serial API `SerialPort` into a `SerialSession`. Uses the WHATWG Streams API (`port.readable` / `port.writable`). The port must be open before this is called.

---

### createNodeSerialSession()

```typescript
import { createNodeSerialSession } from "hamkeyer";  // universal build only
function createNodeSerialSession(port: SerialPort): SerialSession
```

Wraps a Node.js `serialport` `SerialPort` instance into a `SerialSession`. The port should be opened (or about to open) before any writes are attempted.

```typescript
import { SerialPort } from "serialport";
import { createNodeSerialSession, CWKeyer } from "hamkeyer";

const port = new SerialPort({ path: "/dev/ttyUSB0", baudRate: 1200 });
port.once("open", async () => {
    const session = createNodeSerialSession(port);
    const keyer = CWKeyer.create("winkeyer");
    await keyer.connectWithSession(session);
    await keyer.init();
    await keyer.sendCw("DE W1AW");
});
```

> This function is not available in the browser build (`hamkeyer/browser`) because it depends on the `serialport` native module.

---

### Web Serial helpers

Utility functions exported from `hamkeyer` for browser use.

#### `isWebSerialSupported(): boolean`

Returns `true` if `navigator.serial` is available.

#### `requestSerialPort(options?: SerialPortRequestOptions): Promise<SerialPort>`

Shows the browser's port-picker dialog and returns the chosen `SerialPort`. Throws if Web Serial is not supported.

#### `openSerialPort(port: SerialPort, options: SerialOptions): Promise<void>`

Opens a `SerialPort` with the given options. Skips the open call if the port is already open (i.e. `port.readable` or `port.writable` are already set).

#### `closeSerialPort(port: SerialPort): Promise<void>`

Closes a `SerialPort` if it is currently open.
