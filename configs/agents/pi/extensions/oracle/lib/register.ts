import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createOracleRuntime, type OracleRuntime } from "./runtime";
import { registerOracleTool } from "./tool";

export function registerOracleExtension(pi: ExtensionAPI): void {
  registerOracle(pi, createOracleRuntime());
}

export function registerOracle(pi: ExtensionAPI, runtime: OracleRuntime): void {
  registerOracleTool(pi, runtime);
}
