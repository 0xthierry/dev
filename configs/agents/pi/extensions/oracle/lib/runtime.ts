import { loadOracleConfig, normalizeOracleConfig } from "./config";
import { askChatGptOracle, type OracleAnswer } from "./providers/chatgpt/direct";
import type { OracleSessionState } from "./session";

export interface OracleRuntime {
  ask: (request: OracleRuntimeAskRequest) => Promise<OracleAnswer>;
}

export interface OracleRuntimeAskRequest {
  prompt: string;
  signal?: AbortSignal;
  state?: OracleSessionState;
}

export function createOracleRuntime(): OracleRuntime {
  return {
    ask: (request) => askChatGptOracle({ ...request, config: normalizeOracleConfig(loadOracleConfig()).chatgpt }),
  };
}
