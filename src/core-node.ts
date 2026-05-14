/* Copyright 2026 Jindřich Vavruška jindrich@vavruska.cz 

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee 
is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED “AS IS” AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE 
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE 
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS 
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, 
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/

import { createNodeSerialSession } from "./node-session";
import { CWKeyer } from "./core";
import { SerialPort } from "serialport";

export class NodeCWKeyer extends CWKeyer {

  constructor(keyerType: string) {
    super(keyerType);
  }

  static override create(keyerType: string): NodeCWKeyer {
    return new NodeCWKeyer(keyerType);
  }

  async connectWithSerialPort(
    portPath: string,
    baud: number = 1200,
  ): Promise<void> {
    const port = new SerialPort({ path: portPath, baudRate: baud });
    const session = createNodeSerialSession(port);
    await this.connectWithSession(session);
  }
}
