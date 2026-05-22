import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createConnection, type Socket } from "node:net";

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

export type BridgeMode = "owner" | "attached" | "incompatible" | "stopped";

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
  mode: BridgeMode;
  host: string;
  port: number;
  clients: Array<Omit<BridgeClient, "socket" | "token"> & { hasToken: boolean }>;
  activeTabId?: string;
  controllerCount?: number;
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

type ControllerClient = {
  socket: Socket;
  connectedAt: number;
  lastSeenAt: number;
};

type ControllerPendingRequest = {
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
  let controllerSocket: SocketWithBuffer | undefined;
  let controllerConnected = false;
  let remoteStatus: BridgeStatus = stoppedStatus(host, port);
  let attachError: string | undefined;
  const clients = new Map<Socket, BridgeClient>();
  const controllers = new Map<Socket, ControllerClient>();
  const pending = new Map<string, PendingRequest>();
  const controllerPending = new Map<string, ControllerPendingRequest>();

  async function start(): Promise<void> {
    if (server?.listening || isControllerOpen()) return;
    if (starting) return starting;

    starting = startOwnerBridge()
      .catch(async (error) => {
        if (!isAddressInUseError(error)) throw error;
        await attachToExistingBridge();
      })
      .finally(() => {
        starting = undefined;
      });

    return starting;
  }

  async function stop(): Promise<void> {
    if (controllerSocket) {
      await closeControllerSocket();
      return;
    }

    // If another Pi session is attached, this process is currently the shared bridge owner.
    // Keep the server alive so attached sessions and browser tabs do not lose the bridge.
    if (controllers.size > 0) return;

    await stopOwnerBridge();
  }

  function getStatus(): BridgeStatus {
    if (controllerSocket) return remoteStatus;
    if (server?.listening) return ownerStatus();
    return stoppedStatus(host, port);
  }

  async function request(
    action: string,
    params: Record<string, unknown> = {},
    requestOptions: BridgeRequestOptions = {},
  ): Promise<unknown> {
    await start();
    if (controllerSocket) {
      return requestThroughOwner(action, params, requestOptions);
    }
    return requestFromOwner(action, params, requestOptions);
  }

  function startOwnerBridge(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const nextServer = createServer();
      nextServer.on("upgrade", handleUpgrade);
      nextServer.once("error", reject);
      nextServer.listen(port, host, () => {
        nextServer.off("error", reject);
        server = nextServer;
        remoteStatus = stoppedStatus(host, port);
        resolve();
      });
    });
  }

  async function stopOwnerBridge(): Promise<void> {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Excalidraw bridge stopped before the browser responded."));
    }
    pending.clear();

    for (const socket of clients.keys()) socket.destroy();
    clients.clear();
    for (const controller of controllers.keys()) controller.destroy();
    controllers.clear();

    if (!server) return;
    const current = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      current.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async function attachToExistingBridge(): Promise<void> {
    const socket = createConnection({ host, port }) as SocketWithBuffer;
    controllerSocket = socket;
    controllerConnected = false;
    socket.wsBuffer = Buffer.alloc(0);
    socket.wsFragments = [];

    socket.on("close", () => {
      if (controllerSocket === socket) controllerSocket = undefined;
      controllerConnected = false;
      rejectControllerPending("Excalidraw bridge controller disconnected.");
      remoteStatus = stoppedStatus(host, port);
      attachError = undefined;
    });
    socket.on("error", () => undefined);

    await waitForControllerHandshake(socket, host, port);
    socket.on("data", (chunk) =>
      handleControllerSocketData(socket, typeof chunk === "string" ? Buffer.from(chunk) : chunk),
    );
    controllerConnected = true;
    sendMaskedFrame(
      socket,
      JSON.stringify({ type: "controller_hello", pid: process.pid, timestamp: new Date().toISOString() }),
    );
    try {
      const status = await requestControllerStatus();
      remoteStatus = coerceStatus(status);
      attachError = undefined;
    } catch (error) {
      attachError = error instanceof Error ? error.message : String(error);
      remoteStatus = incompatibleStatus(host, port, attachError);
    }
  }

  function requestThroughOwner(
    action: string,
    params: Record<string, unknown>,
    requestOptions: BridgeRequestOptions,
  ): Promise<unknown> {
    return sendControllerRequest(
      "browser_request",
      { action, params, options: requestOptions },
      (requestOptions.timeoutMs ?? requestTimeoutMs) + 1_000,
    );
  }

  async function requestControllerStatus(): Promise<unknown> {
    return sendControllerRequest("bridge_status", {}, 3_000);
  }

  function sendControllerRequest(action: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const socket = controllerSocket;
    if (!socket || !controllerConnected || socket.destroyed) {
      throw new Error("Excalidraw bridge is attached to another session but the controller socket is not connected.");
    }
    if (attachError) {
      throw new Error(
        `The existing Excalidraw bridge on ${host}:${port} does not support shared Pi sessions yet (${attachError}). Restart or reload the Pi session that owns the bridge.`,
      );
    }

    const id = `controller-${action}-${now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        controllerPending.delete(id);
        reject(new Error(`Timed out waiting for shared Excalidraw bridge ${action} response after ${timeoutMs}ms.`));
      }, timeoutMs);
      controllerPending.set(id, { resolve, reject, timeout });
      sendMaskedFrame(socket, JSON.stringify({ type: "controller_request", id, action, params }));
    });
  }

  function handleControllerSocketData(socket: SocketWithBuffer, chunk: Buffer): void {
    socket.wsBuffer = Buffer.concat([socket.wsBuffer ?? Buffer.alloc(0), chunk]);

    while (socket.wsBuffer.length >= 2) {
      const frame = readFrame(socket.wsBuffer);
      if (!frame) return;
      socket.wsBuffer = socket.wsBuffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) {
        socket.end();
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      handleControllerSocketMessage(frame.payload);
    }
  }

  function handleControllerSocketMessage(payload: Buffer): void {
    try {
      const message = JSON.parse(payload.toString("utf8")) as JsonObject;
      if (message.type !== "controller_response") return;
      const id = stringValue(message.id);
      if (!id) return;
      const request = controllerPending.get(id);
      if (!request) return;
      controllerPending.delete(id);
      clearTimeout(request.timeout);
      if (message.ok === true) {
        attachError = undefined;
        if (message.action === "bridge_status") remoteStatus = coerceStatus(message.result);
        request.resolve(message.result);
      } else {
        request.reject(new Error(stringValue(message.error) ?? "Shared Excalidraw bridge request failed."));
      }
    } catch {
      // Ignore malformed owner messages.
    }
  }

  async function closeControllerSocket(): Promise<void> {
    const socket = controllerSocket;
    controllerSocket = undefined;
    remoteStatus = stoppedStatus(host, port);
    attachError = undefined;
    rejectControllerPending("Excalidraw bridge controller closed.");
    controllerConnected = false;
    if (!socket || socket.destroyed) return;
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
      setTimeout(resolve, 250);
    });
  }

  function rejectControllerPending(message: string): void {
    for (const request of controllerPending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(message));
    }
    controllerPending.clear();
  }

  function requestFromOwner(
    action: string,
    params: Record<string, unknown> = {},
    requestOptions: BridgeRequestOptions = {},
  ): Promise<unknown> {
    const candidates = selectClients(requestOptions.tabId);
    if (candidates.length === 0)
      throw new Error("No Excalidraw browser tab is connected. Open or reload http://excalidraw.localhost/.");

    const errors: string[] = [];
    return tryClients(candidates, action, params, requestOptions.timeoutMs ?? requestTimeoutMs, errors);
  }

  async function tryClients(
    candidates: BridgeClient[],
    action: string,
    params: Record<string, unknown>,
    timeoutMs: number,
    errors: string[],
  ): Promise<unknown> {
    for (const client of candidates) {
      if (action !== "ping" && !client.token) {
        errors.push(`tab ${client.tabId}: missing bridge token`);
        continue;
      }

      try {
        return await sendRequestToClient(client, action, params, timeoutMs);
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

    const buffered = socket as SocketWithBuffer;
    buffered.wsBuffer = Buffer.alloc(0);
    buffered.wsFragments = [];
    socket.on("data", (chunk) => handleSocketData(buffered, typeof chunk === "string" ? Buffer.from(chunk) : chunk));
    socket.on("close", () => {
      clients.delete(socket);
      controllers.delete(socket);
    });
    socket.on("error", () => {
      clients.delete(socket);
      controllers.delete(socket);
    });
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
      handleSocketMessage(socket, JSON.parse(payload.toString("utf8")) as JsonObject);
    } catch {
      // Drop malformed bridge messages without crashing the extension runtime.
    }
  }

  function handleSocketMessage(socket: Socket, message: JsonObject): void {
    if (message.type === "controller_hello") {
      clients.delete(socket);
      controllers.set(socket, { socket, connectedAt: now(), lastSeenAt: now() });
      return;
    }

    if (message.type === "controller_request") {
      void handleControllerRequest(socket, message);
      return;
    }

    handleBrowserMessage(socket, message);
  }

  async function handleControllerRequest(socket: Socket, message: JsonObject): Promise<void> {
    const controller = controllers.get(socket);
    if (!controller) return;
    controller.lastSeenAt = now();
    const id = stringValue(message.id);
    const action = stringValue(message.action);
    if (!id || !action) return;

    try {
      const params = objectValue(message.params) ?? {};
      const result =
        action === "bridge_status"
          ? ownerStatus()
          : await requestFromOwner(
              stringValue(params.action) ?? "",
              objectValue(params.params) ?? {},
              objectValue(params.options) as BridgeRequestOptions | undefined,
            );
      sendFrame(socket, JSON.stringify({ type: "controller_response", id, action, ok: true, result }));
    } catch (error) {
      sendFrame(
        socket,
        JSON.stringify({
          type: "controller_response",
          id,
          action,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  function handleBrowserMessage(socket: Socket, message: JsonObject): void {
    let client = clients.get(socket);

    if (message.type === "hello") {
      if (!client) {
        client = {
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
      }
      controllers.delete(socket);
      client.lastSeenAt = now();
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

    if (!client) return;
    client.lastSeenAt = now();

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

  function ownerStatus(): BridgeStatus {
    const active = selectClient();
    return {
      running: true,
      mode: "owner",
      host,
      port,
      activeTabId: active?.tabId,
      controllerCount: controllers.size,
      clients: [...clients.values()].map(({ socket: _socket, token, ...client }) => ({
        ...client,
        hasToken: !!token,
      })),
    };
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

  function isControllerOpen(): boolean {
    return controllerConnected && !!controllerSocket && !controllerSocket.destroyed;
  }

  return { start, stop, getStatus, request };
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function stoppedStatus(host: string, port: number): BridgeStatus {
  return { running: false, mode: "stopped", host, port, clients: [] };
}

function incompatibleStatus(host: string, port: number, reason: string): BridgeStatus {
  return {
    running: true,
    mode: "incompatible",
    host,
    port,
    clients: [],
    controllerCount: 0,
    activeTabId: `Existing bridge does not support shared Pi sessions yet: ${reason}`,
  };
}

function coerceStatus(value: unknown): BridgeStatus {
  const object = objectValue(value);
  if (!object) return stoppedStatus(DEFAULT_HOST, DEFAULT_PORT);
  return {
    running: object.running === true,
    mode: object.mode === "owner" || object.mode === "attached" ? "attached" : "stopped",
    host: stringValue(object.host) ?? DEFAULT_HOST,
    port: numberValue(object.port) ?? DEFAULT_PORT,
    activeTabId: stringValue(object.activeTabId),
    controllerCount: numberValue(object.controllerCount),
    clients: Array.isArray(object.clients) ? (object.clients as BridgeStatus["clients"]) : [],
  };
}

async function waitForControllerHandshake(socket: Socket, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  const response = new Promise<void>((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => reject(new Error("Timed out connecting to existing Excalidraw bridge.")), 3_000);
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      if (!buffered.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      clearTimeout(timeout);
      if (buffered.startsWith("HTTP/1.1 101")) resolve();
      else reject(new Error(`Existing Excalidraw bridge rejected controller connection: ${buffered}`));
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });

  const key = randomBytes(16).toString("base64");
  socket.write(
    [
      "GET / HTTP/1.1",
      `Host: ${host}:${port}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"),
  );
  await response;
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EADDRINUSE";
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
  socket.write(encodeFrame(text, false));
}

function sendMaskedFrame(socket: Socket, text: string): void {
  socket.write(encodeFrame(text, true));
}

function encodeFrame(text: string, masked: boolean): Buffer {
  const payload = Buffer.from(text, "utf8");
  const lengthBytes = payload.length < 126 ? 0 : payload.length < 65_536 ? 2 : 8;
  const maskBytes = masked ? 4 : 0;
  const header = Buffer.alloc(2 + lengthBytes + maskBytes);
  header[0] = 0x81;
  let offset = 2;

  if (payload.length < 126) {
    header[1] = (masked ? 0x80 : 0) | payload.length;
  } else if (payload.length < 65_536) {
    header[1] = (masked ? 0x80 : 0) | 126;
    header.writeUInt16BE(payload.length, offset);
    offset += 2;
  } else {
    header[1] = (masked ? 0x80 : 0) | 127;
    header.writeBigUInt64BE(BigInt(payload.length), offset);
    offset += 8;
  }

  if (!masked) return Buffer.concat([header, payload]);

  const mask = randomBytes(4);
  mask.copy(header, offset);
  const maskedPayload = Buffer.from(payload);
  for (let index = 0; index < maskedPayload.length; index += 1) {
    maskedPayload[index] ^= mask[index % 4];
  }
  return Buffer.concat([header, maskedPayload]);
}

function objectValue(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
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
