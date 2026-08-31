export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface RpcModelState {
  provider: string;
  id: string;
}

export interface RpcSessionState {
  model: RpcModelState | null;
  thinkingLevel: ReasoningEffort;
  isStreaming: boolean;
  isCompacting: boolean;
  sessionFile?: string;
  sessionId: string;
  pendingMessageCount: number;
}

interface RpcCommandBase {
  id?: string;
}

export type RpcCommand =
  | (RpcCommandBase & { type: "get_state" })
  | (RpcCommandBase & { type: "set_model"; provider: string; modelId: string })
  | (RpcCommandBase & { type: "set_thinking_level"; level: ReasoningEffort })
  | (RpcCommandBase & {
      type: "prompt";
      message: string;
      streamingBehavior?: "steer" | "followUp";
    })
  | (RpcCommandBase & { type: "follow_up"; message: string })
  | (RpcCommandBase & { type: "steer"; message: string })
  | (RpcCommandBase & { type: "abort" })
  | (RpcCommandBase & { type: "get_last_assistant_text" });

export type RpcCommandType = RpcCommand["type"];

export interface RpcSuccessResponse<T = unknown> {
  id?: string;
  type: "response";
  command: string;
  success: true;
  data?: T;
}

export interface RpcFailureResponse {
  id?: string;
  type: "response";
  command: string;
  success: false;
  error: string;
}

export type RpcResponse<T = unknown> = RpcSuccessResponse<T> | RpcFailureResponse;

export type BlockingExtensionUiMethod = "select" | "confirm" | "input" | "editor";

export interface RpcExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: string;
  [key: string]: unknown;
}

export interface RpcExtensionUiCancellation {
  type: "extension_ui_response";
  id: string;
  cancelled: true;
}

export interface RpcAgentSettledEvent {
  type: "agent_settled";
  [key: string]: unknown;
}

export interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

export type RpcInboundMessage = RpcResponse | RpcExtensionUiRequest | RpcAgentSettledEvent | RpcEvent;

export function isRpcResponse(value: RpcInboundMessage): value is RpcResponse {
  return value.type === "response";
}

export function isExtensionUiRequest(value: RpcInboundMessage): value is RpcExtensionUiRequest {
  return value.type === "extension_ui_request" && typeof value.id === "string" && typeof value.method === "string";
}

export function isBlockingExtensionUiMethod(method: string): method is BlockingExtensionUiMethod {
  return method === "select" || method === "confirm" || method === "input" || method === "editor";
}

export function isAgentSettledEvent(value: RpcInboundMessage): value is RpcAgentSettledEvent {
  return value.type === "agent_settled";
}
