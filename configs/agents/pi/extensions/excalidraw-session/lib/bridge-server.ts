import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 19275;
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "http://excalidraw.localhost",
  "http://exacalidraw.localhost",
  "http://excalidraw.local",
  "http://exacalidraw.local",
  "http://localhost",
  "http://127.0.0.1",
]);

export type BridgeClient = {
  socket: Socket;
  tabId: string;
  token?: string;
  url?: string;
  title?: string;
  focused: boolean;
  visible: boolean;
  apiReady: boolean;
  connectedAt: number;
  lastSeenAt: number;
  lastFocusedAt: number;
  elementCount?: number;
};

export type BridgeStatus = {
  running: boolean;
  host: string;
  port: number;
  clients: Array<Omit<BridgeClient, "socket" | "token"> & { hasToken: boolean }>;
  activeTabId?: string;
};

export type BridgeRequestOptions = {
  tabId?: string;
  timeoutMs?: number;
};

export type ExcalidrawBridge = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): BridgeStatus;
  request(action: string, params?: Record<string, unknown>, options?: BridgeRequestOptions): Promise<unknown>;
};

export type BridgeServerOptions = {
  host?: string;
  port?: number;
  allowedOrigins?: Set<string>;
  requestTimeoutMs?: number;
  now?: () => number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SocketWithBuffer = Socket & { wsBuffer?: Buffer; wsFragments?: Buffer[] };

type JsonObject = Record<string, unknown>;

export function createExcalidrawBridgeServer(options: BridgeServerOptions = {}): ExcalidrawBridge {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const allowedOrigins = options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const now = options.now ?? Date.now;

  let server: Server | undefined;
  let starting: Promise<void> | undefined;
  const clients = new Map<Socket, BridgeClient>();
  const pending = new Map<string, PendingRequest>();

  async function start(): Promise<void> {
    if (server?.listening) return;
    if (starting) return starting;

    starting = new Promise<void>((resolve, reject) => {
      const nextServer = createServer();
      nextServer.on("upgrade", handleUpgrade);
      nextServer.once("error", reject);
      nextServer.listen(port, host, () => {
        nextServer.off("error", reject);
        server = nextServer;
        resolve();
      });
    }).finally(() => {
      starting = undefined;
    });

    return starting;
  }

  async function stop(): Promise<void> {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Excalidraw bridge stopped before the browser responded."));
    }
    pending.clear();

    for (const socket of clients.keys()) socket.destroy();
    clients.clear();

    if (!server) return;
    const current = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      current.close((error) => (error ? reject(error) : resolve()));
    });
  }

  function getStatus(): BridgeStatus {
    const active = selectClient();
    return {
      running: !!server?.listening,
      host,
      port,
      activeTabId: active?.tabId,
      clients: [...clients.values()].map(({ socket: _socket, token, ...client }) => ({
        ...client,
        hasToken: !!token,
      })),
    };
  }

  async function request(
    action: string,
    params: Record<string, unknown> = {},
    requestOptions: BridgeRequestOptions = {},
  ): Promise<unknown> {
    await start();
    const candidates = selectClients(requestOptions.tabId);
    if (candidates.length === 0)
      throw new Error("No Excalidraw browser tab is connected. Open or reload http://excalidraw.localhost/.");

    const errors: string[] = [];
    for (const client of candidates) {
      if (action !== "ping" && !client.token) {
        errors.push(`tab ${client.tabId}: missing bridge token`);
        continue;
      }

      try {
        return await sendRequestToClient(client, action, params, requestOptions.timeoutMs ?? requestTimeoutMs);
      } catch (error) {
        errors.push(`tab ${client.tabId}: ${error instanceof Error ? error.message : String(error)}`);
        client.apiReady = false;
        client.lastSeenAt = 0;
      }
    }

    throw new Error(`No connected Excalidraw tab responded to ${action}. ${errors.join("; ")}`);
  }

  function sendRequestToClient(
    client: BridgeClient,
    action: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = `${action}-${now()}-${Math.random().toString(36).slice(2)}`;
    const payload = {
      type: "request",
      id,
      action,
      params,
      ...(action === "ping" ? {} : { token: client.token }),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for Excalidraw ${action} response after ${timeoutMs}ms.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      sendFrame(client.socket, JSON.stringify(payload));
    });
  }

  function handleUpgrade(request: IncomingMessage, socket: Socket): void {
    if (!isAllowedOrigin(request.headers.origin, allowedOrigins)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1").update(`${key}${WEBSOCKET_GUID}`).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    const client: BridgeClient = {
      socket,
      tabId: `pending-${now()}-${Math.random().toString(36).slice(2)}`,
      focused: false,
      visible: false,
      apiReady: false,
      connectedAt: now(),
      lastSeenAt: now(),
      lastFocusedAt: 0,
    };
    clients.set(socket, client);

    const buffered = socket as SocketWithBuffer;
    buffered.wsBuffer = Buffer.alloc(0);
    buffered.wsFragments = [];
    socket.on("data", (chunk) => handleSocketData(buffered, typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  }

  function handleSocketData(socket: SocketWithBuffer, chunk: Buffer): void {
    socket.wsBuffer = Buffer.concat([socket.wsBuffer ?? Buffer.alloc(0), chunk]);

    while (socket.wsBuffer.length >= 2) {
      const frame = readFrame(socket.wsBuffer);
      if (!frame) return;
      socket.wsBuffer = socket.wsBuffer.subarray(frame.consumed);

      if (frame.opcode === 0x8) {
        socket.end();
        continue;
      }

      if (frame.opcode === 0x1 && !frame.fin) {
        socket.wsFragments = [frame.payload];
        continue;
      }

      if (frame.opcode === 0x0) {
        socket.wsFragments = [...(socket.wsFragments ?? []), frame.payload];
        if (!frame.fin) continue;
        const payload = Buffer.concat(socket.wsFragments);
        socket.wsFragments = [];
        handleTextMessage(socket, payload);
        continue;
      }

      if (frame.opcode !== 0x1) continue;
      handleTextMessage(socket, frame.payload);
    }
  }

  function handleTextMessage(socket: Socket, payload: Buffer): void {
    try {
      handleBrowserMessage(socket, JSON.parse(payload.toString("utf8")) as JsonObject);
    } catch {
      // Drop malformed browser bridge messages without crashing the extension runtime.
    }
  }

  function handleBrowserMessage(socket: Socket, message: JsonObject): void {
    const client = clients.get(socket);
    if (!client) return;
    client.lastSeenAt = now();

    if (message.type === "hello") {
      client.tabId = stringValue(message.tabId) ?? client.tabId;
      client.token = stringValue(message.token) ?? client.token;
      client.url = stringValue(message.url) ?? client.url;
      client.title = stringValue(message.title) ?? client.title;
      client.focused = booleanValue(message.focused) ?? client.focused;
      client.visible = booleanValue(message.visible) ?? client.visible;
      client.apiReady = booleanValue(message.apiReady) ?? client.apiReady;
      if (client.focused) client.lastFocusedAt = now();
      return;
    }

    if (message.type === "focus") {
      client.focused = booleanValue(message.focused) ?? client.focused;
      client.visible = booleanValue(message.visible) ?? client.visible;
      client.url = stringValue(message.url) ?? client.url;
      if (client.focused) client.lastFocusedAt = now();
      return;
    }

    if (message.type === "scene_changed") {
      client.elementCount = numberValue(message.elementCount) ?? client.elementCount;
      return;
    }

    if (message.type === "response") {
      const id = stringValue(message.id);
      if (!id) return;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timeout);
      if (message.ok === true) request.resolve(message.result);
      else request.reject(new Error(stringValue(message.error) ?? "Excalidraw browser request failed."));
    }
  }

  function selectClient(tabId?: string): BridgeClient | undefined {
    return selectClients(tabId)[0];
  }

  function selectClients(tabId?: string): BridgeClient[] {
    const candidates = [...clients.values()].filter((client) => client.apiReady);
    const filtered = tabId ? candidates.filter((client) => client.tabId === tabId) : candidates;
    return filtered.sort(compareActiveClients);
  }

  function compareActiveClients(left: BridgeClient, right: BridgeClient): number {
    return clientScore(right) - clientScore(left);
  }

  function clientScore(client: BridgeClient): number {
    let score = 0;
    if (client.focused && client.visible) score += 1_000_000_000;
    if (client.visible) score += 100_000_000;
    score += Math.max(client.lastFocusedAt, client.lastSeenAt) / 1_000_000;
    return score;
  }

  return { start, stop, getStatus, request };
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function readFrame(buffer: Buffer): { fin: boolean; opcode: number; payload: Buffer; consumed: number } | undefined {
  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return undefined;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return undefined;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large.");
    length = Number(bigLength);
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return undefined;

  const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  }

  return { fin, opcode, payload, consumed: offset + length };
}

function sendFrame(socket: Socket, text: string): void {
  const payload = Buffer.from(text, "utf8");
  let header: Buffer;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65_536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
