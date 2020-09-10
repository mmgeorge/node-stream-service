import WebSocket, { Server, ServerOptions,  } from "ws";
import * as readline from "readline"
import { createFeatureMessage, initFeatureSet } from "./lib";

type Message = string | Buffer | ArrayBuffer | Buffer[];

interface SocketInfo {
  ready: boolean;
}

interface StreamServerOptions {
  // Max KB to buffer per client
  maxBufferredAmount: number; 
}

interface IHandshakeMessage {
  format: "json";
  spatialReference: {
    wkid: number
  },
  outFields?: string[]
}

class StreamServer extends Server {
  constructor(options: ServerOptions & StreamServerOptions) {
    super(options);

    this.on("connection", this._onConnection.bind(this));
  }

  options: ServerOptions & StreamServerOptions;

  socketInfo = new Map<WebSocket, SocketInfo>();

  broadcast(message: string): void {
    for (const socket of this.clients) {
      if (socket.readyState === WebSocket.OPEN &&
          this.socketInfo.has(socket) &&
          socket.bufferedAmount < this.options.maxBufferredAmount * 1024)
        socket.send(message);
    }
  }

  private _onConnection(socket: WebSocket): void {
    socket.on("message", (message) => this._onMessage(socket, message));
    socket.on("close", this._onClose.bind(this));
    socket.on("error", this._onError.bind(this));
  }

  private _handshake(socket: WebSocket, message: string) {
    try {
      const parsed = JSON.parse(message) as IHandshakeMessage;

      // This example server only supports WebMercator but we know that's the format
      // the client will use. Make sure you support projecting features in the the spatial
      // reference requested by the client if it can vary from that of your underlying data
      if (parsed.spatialReference.wkid !== 102100) {
        socket.close();
        return;
      }

      // Echo back the properties set in the handshake
      socket.send(JSON.stringify({
        format: "json",
        spatialReference: {
          wkid: parsed.spatialReference.wkid
        },
      }))

      this.socketInfo.set(socket, { ready: true })
    } catch (e) {
      console.debug("Got error on handshake", e);
      socket.close();
    }
    
  }

  private _onMessage(socket: WebSocket, message: Message): void {
    // Only handle text
    if (typeof message !== "string") {
      socket.close();
      return;
    }

    this._handshake(socket, message);
  }

  private _onClose(code: number, reason: string): void {
    console.log("Websocket closed", code, reason);
  }

  private _onError(error: Error): void {
    console.debug("Websocket erroed", error, "for weboscket");
  }
}

async function main(): Promise<void> {
  const server = new StreamServer({ port: 8000, maxBufferredAmount: 256 });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const highways = await initFeatureSet();
  const intervalId = setInterval(() => {
    const message = createFeatureMessage(highways);
    server.broadcast(message);
  }, 200);

  console.log("Started listening on port 8080");

  rl.question("Press any key to stop server", (_response: string) => {
    console.log("Closing Server...")
    clearInterval(intervalId);
    server.close();
    rl.close();
  })
}


main();

