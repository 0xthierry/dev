import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname } from "node:path";
import type { ArtifactPage, ReadArtifactPageOptions } from "../artifacts/artifacts";
import type { ResolvedAgentExecution } from "../execution/profile";
import { createEnvironmentRedactor, type RedactText, redactStringValues } from "../security/redaction";
import { DEFAULT_WAIT_TIMEOUT_MS } from "../supervisor/limits";
import { DEFAULT_MAILBOX_LIMITS } from "../supervisor/mailbox";
import { RegistryError } from "../supervisor/registry";
import { type AgentSupervisor, SupervisorError } from "../supervisor/supervisor";
import type { ExecutionInput } from "../tools/schemas";
import { type AuthenticatedCaller, type CapabilityAuthority, createCapabilityAuthority } from "./authentication";
import {
  boundIpcErrorMessage,
  encodeIpcFrame,
  IPC_PROTOCOL_VERSION,
  IpcJsonlDecoder,
  type IpcOperation,
  type IpcOperationPayload,
  IpcProtocolError,
  type IpcRequestFrame,
  parseOperationPayload,
} from "./protocol";

export interface IpcServerConnection {
  write(record: string): void;
  onData(listener: (chunk: Uint8Array | string) => void): () => void;
  onClose(listener: () => void): () => void;
  close(): void;
}

export interface IpcServerListener {
  close(): Promise<void>;
}

export interface IpcServerRuntime {
  prepare(socketPath: string): Promise<void>;
  listen(socketPath: string, accept: (connection: IpcServerConnection) => void): Promise<IpcServerListener>;
  cleanup(socketPath: string): Promise<void>;
}

export interface AuthenticatedIpcRequest<Operation extends IpcOperation = IpcOperation> {
  caller: AuthenticatedCaller;
  operation: Operation;
  payload: IpcOperationPayload[Operation];
}

export interface AuthenticatedIpcDispatcher {
  dispatch(request: AuthenticatedIpcRequest, signal: AbortSignal): Promise<unknown>;
}

export interface IpcServerOptions {
  socketPath: string;
  dispatcher: AuthenticatedIpcDispatcher;
  authority?: CapabilityAuthority;
  runtime?: IpcServerRuntime;
  redact?: RedactText;
}

export interface SupervisorIpcExecutionResolver {
  resolve(
    input: ExecutionInput | undefined,
    options: {
      operation: "spawn" | "followup";
      caller: AuthenticatedCaller;
      agentType?: string;
      target?: string;
      signal: AbortSignal;
    },
  ): Promise<ResolvedAgentExecution>;
  resolveForkParentSession?(caller: AuthenticatedCaller, signal: AbortSignal): Promise<string>;
}

export interface SupervisorIpcArtifactReader {
  read(
    caller: AuthenticatedCaller,
    reference: string,
    options: ReadArtifactPageOptions,
    signal: AbortSignal,
  ): Promise<ArtifactPage>;
}

export interface SupervisorIpcDispatcherOptions {
  supervisor: AgentSupervisor;
  execution: SupervisorIpcExecutionResolver;
  artifacts?: SupervisorIpcArtifactReader;
}

export class IpcServer {
  readonly authority: CapabilityAuthority;
  private readonly runtime: IpcServerRuntime;
  private readonly connections = new Set<IpcServerConnection>();
  private readonly connectionCleanups = new Map<IpcServerConnection, () => void>();
  private readonly controllers = new Set<AbortController>();
  private listener: IpcServerListener | undefined;
  private starting: Promise<void> | undefined;
  private stopping = false;
  private readonly redact: RedactText;

  constructor(private readonly options: IpcServerOptions) {
    if (!options.socketPath) throw new Error("IPC socket path must not be empty");
    this.authority = options.authority ?? createCapabilityAuthority();
    this.runtime = options.runtime ?? nodeServerRuntime;
    this.redact = options.redact ?? ((value) => value);
  }

  /** Starts the single session-scoped listener only when its first caller needs it. */
  async start(): Promise<void> {
    if (this.stopping) throw new Error("IPC server is stopped");
    if (this.listener) return;
    if (!this.starting) {
      this.starting = (async () => {
        await this.runtime.prepare(this.options.socketPath);
        if (this.stopping) return;
        this.listener = await this.runtime.listen(this.options.socketPath, (connection) => this.accept(connection));
      })().finally(() => {
        this.starting = undefined;
      });
    }
    await this.starting;
  }

  accept(connection: IpcServerConnection): void {
    if (this.stopping) {
      connection.close();
      return;
    }
    this.connections.add(connection);
    let caller: AuthenticatedCaller | undefined;
    let redactConnection = this.redact;
    const active = new Map<string, AbortController>();
    const seenRequestIds = new Set<string>();
    let failed = false;
    const decoder = new IpcJsonlDecoder((frame) => {
      if (frame.type === "response") return failClosed();
      if (frame.type === "cancel") {
        if (!caller) return failClosed();
        const controller = active.get(frame.id);
        if (!controller) return;
        active.delete(frame.id);
        this.controllers.delete(controller);
        controller.abort(new DOMException("IPC request cancelled", "AbortError"));
        return;
      }
      if (!caller) {
        if (
          frame.operation !== "authenticate" ||
          Object.keys(frame.payload).length !== 1 ||
          !("token" in frame.payload)
        )
          return failClosed();
        const token = typeof frame.payload.token === "string" ? frame.payload.token : "";
        const authenticated = this.authority.authenticate(token);
        if (!authenticated) return failClosed();
        const redactToken = createEnvironmentRedactor({}, [token]);
        redactConnection = (value) => redactToken(this.redact(value));
        caller = authenticated;
        seenRequestIds.add(frame.id);
        writeResponse(frame.id, true, { authenticated: true });
        return;
      }
      if (frame.operation === "authenticate" || seenRequestIds.has(frame.id)) return failClosed();
      seenRequestIds.add(frame.id);
      const controller = new AbortController();
      active.set(frame.id, controller);
      this.controllers.add(controller);
      void this.dispatch(frame, caller, controller.signal)
        .then((result) => {
          if (active.get(frame.id) === controller && !controller.signal.aborted) writeResponse(frame.id, true, result);
        })
        .catch((error) => {
          if (active.get(frame.id) !== controller || controller.signal.aborted) return;
          if (error instanceof IpcProtocolError) {
            failClosed();
            return;
          }
          writeResponse(frame.id, false, formatDispatchError(error, redactConnection));
        })
        .finally(() => {
          active.delete(frame.id);
          this.controllers.delete(controller);
        });
    });
    const removeData = connection.onData((chunk) => {
      if (failed) return;
      try {
        decoder.push(chunk);
      } catch {
        failClosed();
      }
    });
    const removeClose = connection.onClose(() => cleanup());

    const writeResponse = (id: string, ok: boolean, value: unknown) => {
      if (failed) return;
      try {
        connection.write(
          encodeIpcFrame(
            ok
              ? {
                  version: IPC_PROTOCOL_VERSION,
                  type: "response",
                  id,
                  ok: true,
                  result: redactStringValues(value, redactConnection),
                }
              : {
                  version: IPC_PROTOCOL_VERSION,
                  type: "response",
                  id,
                  ok: false,
                  error: value as { kind: string; message: string },
                },
          ),
        );
      } catch {
        failClosed();
      }
    };
    const failClosed = () => {
      if (failed) return;
      failed = true;
      connection.close();
      cleanup();
    };
    const cleanup = () => {
      if (!this.connections.delete(connection)) return;
      this.connectionCleanups.delete(connection);
      removeData();
      removeClose();
      for (const controller of active.values()) {
        controller.abort(new DOMException("IPC connection closed", "AbortError"));
        this.controllers.delete(controller);
      }
      active.clear();
    };
    this.connectionCleanups.set(connection, cleanup);
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    await this.starting?.catch(() => {});
    for (const controller of this.controllers) controller.abort(new DOMException("IPC server stopped", "AbortError"));
    this.controllers.clear();
    for (const connection of [...this.connections]) {
      this.connectionCleanups.get(connection)?.();
      connection.close();
    }
    await this.listener?.close().catch(() => {});
    this.listener = undefined;
    this.authority.clear();
    await this.runtime.cleanup(this.options.socketPath).catch(() => {});
  }

  private async dispatch(frame: IpcRequestFrame, caller: AuthenticatedCaller, signal: AbortSignal): Promise<unknown> {
    if (frame.operation === "authenticate") throw new Error("Unexpected authentication request");
    const payload = parseOperationPayload(frame.operation, frame.payload);
    return await this.options.dispatcher.dispatch({ caller, operation: frame.operation, payload }, signal);
  }
}

export function createIpcServer(options: IpcServerOptions): IpcServer {
  return new IpcServer(options);
}

export function createSupervisorIpcDispatcher(options: SupervisorIpcDispatcherOptions): AuthenticatedIpcDispatcher {
  const { supervisor, execution, artifacts } = options;
  return {
    async dispatch(request, signal) {
      switch (request.operation) {
        case "agent_spawn": {
          const payload = request.payload as IpcOperationPayload["agent_spawn"];
          const resolved = await execution.resolve(payload.execution, {
            operation: "spawn",
            caller: request.caller,
            agentType: payload.subagent_type,
            signal,
          });
          const parentSessionFile =
            payload.context?.fork_turns === "all"
              ? await requireForkSession(execution, request.caller, signal)
              : undefined;
          return await supervisor.spawn({
            parentPath: request.caller.agentPath,
            taskName: payload.task_name,
            agentType: payload.subagent_type,
            prompt: payload.prompt,
            execution: resolved,
            context: parentSessionFile ? { kind: "fork", parentSessionFile } : { kind: "isolated" },
            signal,
          });
        }
        case "agent_send": {
          const payload = request.payload as IpcOperationPayload["agent_send"];
          if (Buffer.byteLength(payload.message, "utf8") > DEFAULT_MAILBOX_LIMITS.maxMessageBytes) {
            throw new SupervisorError(
              "invalid_message",
              `Mail message exceeds ${DEFAULT_MAILBOX_LIMITS.maxMessageBytes} UTF-8 bytes`,
            );
          }
          const target = await accessibleTarget(supervisor, request.caller, payload.target, signal);
          return await supervisor.send({
            senderPath: request.caller.agentPath,
            target,
            message: payload.message,
            signal,
          });
        }
        case "agent_followup": {
          const payload = request.payload as IpcOperationPayload["agent_followup"];
          const target = await accessibleTarget(supervisor, request.caller, payload.target, signal);
          const resolved = payload.execution
            ? await execution.resolve(payload.execution, {
                operation: "followup",
                caller: request.caller,
                target,
                signal,
              })
            : undefined;
          return await supervisor.followup({ target, message: payload.message, execution: resolved, signal });
        }
        case "agent_wait": {
          const payload = request.payload as IpcOperationPayload["agent_wait"];
          if (payload.operation === "read_artifact") {
            if (!artifacts) throw new SupervisorError("invalid_path", "Artifact retrieval is unavailable");
            return await artifacts.read(
              request.caller,
              payload.artifact_ref,
              { cursor: payload.cursor, maxBytes: payload.page_bytes, maxLines: payload.page_lines },
              signal,
            );
          }
          const targets = await Promise.all(
            payload.targets.map((target) => accessibleTarget(supervisor, request.caller, target, signal)),
          );
          return await supervisor.wait({
            targets,
            condition: payload.condition ?? "all",
            timeoutMs:
              payload.timeout_seconds === undefined ? DEFAULT_WAIT_TIMEOUT_MS : payload.timeout_seconds * 1_000,
            signal,
          });
        }
        case "agent_interrupt": {
          const payload = request.payload as IpcOperationPayload["agent_interrupt"];
          return await supervisor.interrupt(
            await accessibleTarget(supervisor, request.caller, payload.target, signal),
            signal,
          );
        }
        case "agent_list": {
          const entries = await supervisor.list(signal);
          return entries.filter((entry) => isVisible(request.caller.agentPath, entry.agentPath));
        }
        case "agent_close": {
          const payload = request.payload as IpcOperationPayload["agent_close"];
          return await supervisor.close(
            await accessibleTarget(supervisor, request.caller, payload.target, signal),
            signal,
          );
        }
      }
    },
  };
}

const nodeServerRuntime: IpcServerRuntime = {
  async prepare(socketPath) {
    const parent = dirname(socketPath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    try {
      const existing = await lstat(socketPath);
      if (!existing.isSocket()) throw new Error("IPC control path is occupied");
      await rm(socketPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  },
  listen(socketPath, accept) {
    return new Promise<IpcServerListener>((resolve, reject) => {
      const server = createServer((socket) => {
        const connection: IpcServerConnection = {
          write(record) {
            if (!socket.writable || socket.destroyed) throw new Error("IPC socket is not writable");
            socket.write(record);
          },
          onData(listener) {
            socket.on("data", listener);
            return () => socket.removeListener("data", listener);
          },
          onClose(listener) {
            socket.once("close", listener);
            socket.once("error", listener);
            return () => {
              socket.removeListener("close", listener);
              socket.removeListener("error", listener);
            };
          },
          close() {
            socket.destroy();
          },
        };
        accept(connection);
      });
      const onError = () => {
        server.close();
        reject(new Error("IPC listener failed"));
      };
      server.once("error", onError);
      server.listen(socketPath, async () => {
        server.removeListener("error", onError);
        try {
          await chmod(socketPath, 0o600);
        } catch {
          server.close();
          reject(new Error("IPC listener permissions failed"));
          return;
        }
        resolve({
          close: () =>
            new Promise<void>((done) => {
              server.close(() => done());
            }),
        });
      });
    });
  },
  async cleanup(socketPath) {
    await rm(socketPath, { force: true });
  },
};

async function accessibleTarget(
  supervisor: AgentSupervisor,
  caller: AuthenticatedCaller,
  target: string,
  signal: AbortSignal,
): Promise<string> {
  const entries = await supervisor.list(signal);
  const matches = entries.filter((entry) => entry.agentId === target || entry.agentPath === target);
  const match = matches.length === 1 ? matches[0] : undefined;
  if (!match || !isVisible(caller.agentPath, match.agentPath)) {
    throw new SupervisorError("invalid_path", "Agent target is not visible to the authenticated caller");
  }
  return match.agentPath;
}

function isVisible(callerPath: string, targetPath: string): boolean {
  const parent = callerPath.slice(0, callerPath.lastIndexOf("/"));
  const targetParent = targetPath.slice(0, targetPath.lastIndexOf("/"));
  return (
    targetPath === callerPath ||
    targetPath === parent ||
    targetParent === parent ||
    targetPath.startsWith(`${callerPath}/`)
  );
}

async function requireForkSession(
  execution: SupervisorIpcExecutionResolver,
  caller: AuthenticatedCaller,
  signal: AbortSignal,
): Promise<string> {
  const sessionFile = await execution.resolveForkParentSession?.(caller, signal);
  if (!sessionFile) throw new SupervisorError("process_unavailable", "Caller has no saved session available to fork");
  return sessionFile;
}

function formatDispatchError(error: unknown, redact: RedactText): { kind: string; message: string } {
  if (error instanceof SupervisorError || error instanceof RegistryError) {
    return { kind: error.kind, message: boundIpcErrorMessage(redact(error.message)) };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "aborted", message: "Operation aborted" };
  }
  return { kind: "unexpected", message: "Collaboration request failed" };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
