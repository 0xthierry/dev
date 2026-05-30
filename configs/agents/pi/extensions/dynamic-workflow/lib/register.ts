import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shouldRegisterWorkflowInCurrentProcess } from "./runner/invocation";
import { createDynamicWorkflowRuntime } from "./runtime/runtime";
import type { DynamicWorkflowRuntime } from "./runtime/types";
import { registerWorkflowTool } from "./tools/workflow-tool";

export function registerDynamicWorkflowExtension(pi: ExtensionAPI): void {
  if (!shouldRegisterWorkflowInCurrentProcess()) return;
  registerDynamicWorkflowTools(pi, createDynamicWorkflowRuntime());
}

export function registerDynamicWorkflowTools(pi: ExtensionAPI, runtime: DynamicWorkflowRuntime): void {
  registerWorkflowTool(pi, runtime);
}
