import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import type { RedactText } from "../security/redaction";
import {
  boundIpcErrorMessage,
  cancelFrame,
  encodeIpcFrame,
  IpcJsonlDecoder,
  type IpcOperation,
  type IpcOperationPayload,
  type IpcResponseFrame,
  requestFrame,
} from "./protocol";

export interface IpcClientConnection {
  write(record: string): void;
  onData(listener: (chunk: Uint8Array | string) => void): () => void;
  onClose(listener: (error?: Error) => void): () => void;
  close(): void;
}

export interface IpcClientRuntime {
  connect(socketPath: string): Promise<IpcClientConnection>;
  createRequestId(): string;
}

export interface IpcClientOptions {
  socketPath: string;
  token: string;
  runtime?: IpcClientRuntime;
  redact?: RedactText;
}

export class IpcClientError extends Error {
  constructor(
    readonly kind: "closed" | "authentication_failed" | "request_failed" | "protocol_error",
    message: string,
    readonly remoteKind?: string,
  ) {
    super(message);
    this.name = "IpcClientError";
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  removeAbort?: () => void;
}

export class IpcClient {
  private readonly runtime: IpcClientRuntime;
  private readonly pending = new Map<string, PendingRequest>();
  private connection: IpcClientConnection | undefined;
  private connecting: Promise<void> | undefined;
  private removeData: (() => void) | undefined;
  private removeClose: (() => void) | undefined;
  private closed = false;
  private readonly redact: RedactText;

  constructor(private readonly options: IpcClientOptions) {
    if (!options.socketPath || !options.token)
      throw new IpcClientError("authentication_failed", "Collaboration unavailable");
    this.runtime = options.runtime ?? nodeClientRuntime;
    this.redact = options.redact ?? ((value) => value);
  }

  async request<Operation extends IpcOperation>(
    operation: Operation,
    payload: IpcOperationPayload[Operation],
    signal?: AbortSignal,
  ): Promise<unknown> {
    throwIfAborted(signal);
    await abortable(this.ensureConnected(), signal);
    return await this.sendRequest(operation, payload as Readonly<Record<string, unknown>>, signal);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection?.close();
    this.failAll(new IpcClientError("closed", "Collaboration connection closed"));
    this.detach();
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) throw new IpcClientError("closed", "Collaboration connection closed");
    if (this.connection) return;
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = undefined;
      });
    }
    await this.connecting;
  }

  private async open(): Promise<void> {
    let connection: IpcClientConnection;
    try {
      connection = await this.runtime.connect(this.options.socketPath);
    } catch {
      throw new IpcClientError("closed", "Collaboration connection unavailable");
    }
    if (this.closed) {
      connection.close();
      throw new IpcClientError("closed", "Collaboration connection closed");
    }
    this.connection = connection;
    const decoder = new IpcJsonlDecoder((frame) => {
      if (frame.type !== "response") return this.failProtocol();
      this.handleResponse(frame);
    });
    this.removeData = connection.onData((chunk) => {
      try {
        decoder.push(chunk);
      } catch {
        this.failProtocol();
      }
    });
    this.removeClose = connection.onClose(() => {
      this.connection = undefined;
      this.failAll(new IpcClientError("closed", "Collaboration connection closed"));
      this.detach();
    });

    const id = this.runtime.createRequestId();
    try {
      await this.sendRequest("authenticate", { token: this.options.token }, undefined, id);
    } catch {
      if (this.connection === connection) connection.close();
      throw new IpcClientError("authentication_failed", "Collaboration authentication failed");
    }
  }

  private sendRequest(
    operation: IpcOperation | "authenticate",
    payload: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
    explicitId?: string,
  ): Promise<unknown> {
    const connection = this.connection;
    if (!connection || this.closed)
      return Promise.reject(new IpcClientError("closed", "Collaboration connection closed"));
    throwIfAborted(signal);
    const id = explicitId ?? this.runtime.createRequestId();
    if (this.pending.has(id)) return Promise.reject(new IpcClientError("protocol_error", "Duplicate request identity"));

    return new Promise<unknown>((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      if (signal) {
        const onAbort = () => {
          if (!this.pending.delete(id)) return;
          signal.removeEventListener("abort", onAbort);
          try {
            connection.write(encodeIpcFrame(cancelFrame(id)));
          } catch {
            // The local abort remains authoritative when the transport is already gone.
          }
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        pending.removeAbort = () => signal.removeEventListener("abort", onAbort);
      }
      this.pending.set(id, pending);
      try {
        connection.write(encodeIpcFrame(requestFrame(id, operation, payload)));
      } catch {
        this.pending.delete(id);
        pending.removeAbort?.();
        reject(new IpcClientError("closed", "Collaboration connection unavailable"));
      }
    });
  }

  private handleResponse(frame: IpcResponseFrame): void {
    const pending = this.pending.get(frame.id);
    if (!pending) {
      this.failProtocol();
      return;
    }
    this.pending.delete(frame.id);
    pending.removeAbort?.();
    if (frame.ok) pending.resolve(frame.result);
    else {
      pending.reject(
        new IpcClientError("request_failed", boundIpcErrorMessage(this.redact(frame.error.message)), frame.error.kind),
      );
    }
  }

  private failProtocol(): void {
    const error = new IpcClientError("protocol_error", "Invalid collaboration response");
    this.connection?.close();
    this.connection = undefined;
    this.failAll(error);
    this.detach();
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.removeAbort?.();
      pending.reject(error);
    }
    this.pending.clear();
  }

  private detach(): void {
    this.removeData?.();
    this.removeData = undefined;
    this.removeClose?.();
    this.removeClose = undefined;
  }
}

export function createIpcClient(options: IpcClientOptions): IpcClient {
  return new IpcClient(options);
}

const nodeClientRuntime: IpcClientRuntime = {
  createRequestId: () => randomUUID(),
  connect: (socketPath) =>
    new Promise<IpcClientConnection>((resolve, reject) => {
      const socket = connect(socketPath);
      const onError = () => {
        cleanupInitial();
        socket.destroy();
        reject(new Error("IPC connection failed"));
      };
      const onConnect = () => {
        cleanupInitial();
        resolve({
          write(record) {
            if (!socket.writable || socket.destroyed) throw new Error("IPC socket is not writable");
            socket.write(record);
          },
          onData(listener) {
            socket.on("data", listener);
            return () => socket.removeListener("data", listener);
          },
          onClose(listener) {
            const close = () => listener();
            const error = () => listener(new Error("IPC connection failed"));
            socket.once("close", close);
            socket.once("error", error);
            return () => {
              socket.removeListener("close", close);
              socket.removeListener("error", error);
            };
          },
          close() {
            socket.destroy();
          },
        });
      };
      const cleanupInitial = () => {
        socket.removeListener("error", onError);
        socket.removeListener("connect", onConnect);
      };
      socket.once("error", onError);
      socket.once("connect", onConnect);
    }),
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  throwIfAborted(signal);
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
