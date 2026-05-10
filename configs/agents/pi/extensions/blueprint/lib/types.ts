import type { PiThinkingLevel } from "./thinking";

export type BlueprintScope = "user" | "project";
export type BlueprintNodeType = "pi" | "command" | "stop";
export type BlueprintNodeStatus = "success" | "failure";
export type BlueprintRunStatus = "running" | "succeeded" | "failed";

export type BlueprintPiActivityItem = BlueprintPiAssistantActivityItem | BlueprintPiToolActivityItem;

export interface BlueprintPiAssistantActivityItem {
  kind: "assistant";
  status: "running" | "completed";
  text: string;
}

export interface BlueprintPiToolActivityItem {
  kind: "tool";
  toolCallId: string;
  toolName: string;
  status: "running" | "succeeded" | "failed";
  argsPreview: string;
  outputPreview?: string;
}

export interface BlueprintActiveNodeProgress {
  nodeId: string;
  type: BlueprintNodeType;
  attempt: number;
  activity?: BlueprintPiActivityItem[];
}

export interface BlueprintEdges {
  success?: string;
  failure?: string;
}

export interface BlueprintNodeBase {
  type: BlueprintNodeType;
  description?: string;
  next?: string;
  on?: BlueprintEdges;
  maxAttempts?: number;
}

export interface PiBlueprintNode extends BlueprintNodeBase {
  type: "pi";
  prompt: string;
  promptFile?: string;
  systemPrompt?: string;
  systemPromptFile?: string;
  tools?: string[];
  skills?: string[];
  model?: string;
  thinking?: PiThinkingLevel;
}

export interface CommandBlueprintNode extends BlueprintNodeBase {
  type: "command";
  run: string;
  timeoutMs?: number;
}

export interface StopBlueprintNode extends BlueprintNodeBase {
  type: "stop";
  message?: string;
}

export type BlueprintNode = PiBlueprintNode | CommandBlueprintNode | StopBlueprintNode;

export interface BlueprintDefinition {
  name: string;
  description: string;
  start: string;
  nodes: Record<string, BlueprintNode>;
}

export interface LoadedBlueprint {
  id: string;
  name: string;
  description: string;
  scope: BlueprintScope;
  filePath: string;
  dir: string;
  definition: BlueprintDefinition;
}

export interface BlueprintDiscoveryResult {
  dirs: string[];
  blueprints: LoadedBlueprint[];
  errors: BlueprintDiscoveryError[];
}

export interface BlueprintDiscoveryError {
  filePath: string;
  message: string;
}

export interface BlueprintRunInput {
  task: string;
}

export interface BlueprintNodeResult {
  nodeId: string;
  type: BlueprintNodeType;
  attempt: number;
  status: BlueprintNodeStatus;
  output: string;
  startedAt: string;
  finishedAt: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  activity?: BlueprintPiActivityItem[];
}

export interface BlueprintRunProgress {
  runId: string;
  status: BlueprintRunStatus;
  currentNodeId?: string;
  message: string;
  results: BlueprintNodeResult[];
  runDir: string;
  activeNode?: BlueprintActiveNodeProgress;
}

export interface BlueprintRunResult extends BlueprintRunProgress {
  blueprint: string;
  task: string;
  contextFile: string;
}
