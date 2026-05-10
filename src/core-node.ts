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
