import { mkdir } from "node:fs/promises";
import type { BlueprintTemplateState } from "../template";
import type { PiThinkingLevel } from "../thinking";
import type {
  BlueprintNode,
  BlueprintNodeResult,
  BlueprintRunProgress,
  BlueprintRunResult,
  LoadedBlueprint,
} from "../types";
import { type BlueprintRunArtifacts, createBlueprintRunArtifacts } from "./artifacts";
import { executeCommandNode } from "./command-node";
import { hydrateBlueprintContext } from "./context";
import { executePiNode } from "./pi-node";
import { runShellCommand } from "./shell";

export interface BlueprintRunRequest {
  blueprint: LoadedBlueprint;
  task: string;
  cwd: string;
  signal?: AbortSignal;
  modelRef?: string;
  thinking?: PiThinkingLevel;
  artifactRootDir?: string;
}

export interface BlueprintNodeExecutors {
  hydrate: typeof hydrateBlueprintContext;
  command: typeof executeCommandNode;
  pi: typeof executePiNode;
}

export interface BlueprintRunOptions {
  executors?: BlueprintNodeExecutors;
  createArtifacts?: typeof createBlueprintRunArtifacts;
}

const DEFAULT_MAX_STEPS = 50;

export async function runBlueprint(
  request: BlueprintRunRequest,
  onProgress?: (progress: BlueprintRunProgress) => void,
  options: BlueprintRunOptions = {},
): Promise<BlueprintRunResult> {
  const executors = options.executors ?? {
    hydrate: hydrateBlueprintContext,
    command: executeCommandNode,
    pi: executePiNode,
  };
  const createArtifacts = options.createArtifacts ?? createBlueprintRunArtifacts;
  const artifacts = await createArtifacts(request.blueprint, request.cwd, { rootDir: request.artifactRootDir });
  const startedContext = await executors.hydrate(request.blueprint, request.cwd, request.task, {
    runCommand: (command) => runShellCommand(command, { cwd: request.cwd, signal: request.signal }),
  });
  await artifacts.writeContext(startedContext);

  const state: BlueprintTemplateState = {
    blueprint: request.blueprint,
    input: { task: request.task },
    contextFile: artifacts.contextFile,
    context: startedContext,
    nodes: {},
  };
  const results: BlueprintNodeResult[] = [];
  const attempts = new Map<string, number>();
  let currentNodeId: string | undefined = request.blueprint.definition.start;
  let status: BlueprintRunResult["status"] = "running";
  let message = `Starting blueprint ${request.blueprint.id}.`;

  emitProgress(onProgress, artifacts, status, currentNodeId, message, results);

  for (let step = 0; currentNodeId && step < DEFAULT_MAX_STEPS; step += 1) {
    const node = request.blueprint.definition.nodes[currentNodeId];
    if (!node) {
      status = "failed";
      message = `Blueprint referenced missing node '${currentNodeId}'.`;
      break;
    }

    const attempt = (attempts.get(currentNodeId) ?? 0) + 1;
    attempts.set(currentNodeId, attempt);
    if (node.maxAttempts && attempt > node.maxAttempts) {
      status = "failed";
      message = `Node '${currentNodeId}' exceeded maxAttempts (${node.maxAttempts}).`;
      break;
    }

    emitProgress(onProgress, artifacts, status, currentNodeId, `Running ${currentNodeId} (${node.type}).`, results);
    const result = await executeNode(currentNodeId, node, attempt, request, artifacts, state, executors);
    results.push(result);
    state.nodes[currentNodeId] = result;
    await artifacts.writeNodeResult(result);

    if (node.type === "hydrate" && result.status === "success") {
      state.context = result.output;
      await artifacts.writeContext(result.output);
    }

    if (node.type === "final") {
      status = result.status === "success" ? "succeeded" : "failed";
      message = result.output;
      currentNodeId = undefined;
      break;
    }

    const nextNode = nextNodeId(node, result);
    if (!nextNode) {
      status = result.status === "success" ? "succeeded" : "failed";
      message = result.status === "success" ? `Blueprint stopped after '${currentNodeId}'.` : result.output;
      currentNodeId = undefined;
      break;
    }

    currentNodeId = nextNode;
  }

  if (currentNodeId && status === "running") {
    status = "failed";
    message = `Blueprint exceeded maximum graph steps (${DEFAULT_MAX_STEPS}).`;
  }

  const finalResult: BlueprintRunResult = {
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    contextFile: artifacts.contextFile,
    blueprint: request.blueprint.id,
    task: request.task,
    status,
    currentNodeId,
    message,
    results,
  };
  await artifacts.writeRunResult(finalResult);
  emitProgress(onProgress, artifacts, status, currentNodeId, message, results);
  return finalResult;
}

async function executeNode(
  nodeId: string,
  node: BlueprintNode,
  attempt: number,
  request: BlueprintRunRequest,
  artifacts: BlueprintRunArtifacts,
  state: BlueprintTemplateState,
  executors: BlueprintNodeExecutors,
): Promise<BlueprintNodeResult> {
  const nodeDir = artifacts.nodeDir(nodeId, attempt);
  await mkdir(nodeDir, { recursive: true });

  switch (node.type) {
    case "hydrate":
      return executeHydrateNode(nodeId, attempt, request, executors);
    case "command":
      return executors.command({
        nodeId,
        node,
        attempt,
        cwd: request.cwd,
        nodeDir,
        templateState: state,
        signal: request.signal,
        runShellCommand,
      });
    case "pi":
      return executors.pi({
        nodeId,
        node,
        attempt,
        blueprintDir: request.blueprint.dir,
        nodeDir,
        cwd: request.cwd,
        contextFile: artifacts.contextFile,
        sessionsDir: artifacts.sessionsDir,
        templateState: state,
        signal: request.signal,
        parentModelRef: request.modelRef,
        parentThinking: request.thinking,
      });
    case "final":
      return executeFinalNode(nodeId, node, attempt, state);
  }
}

async function executeHydrateNode(
  nodeId: string,
  attempt: number,
  request: BlueprintRunRequest,
  executors: BlueprintNodeExecutors,
): Promise<BlueprintNodeResult> {
  const startedAt = new Date().toISOString();
  const output = await executors.hydrate(request.blueprint, request.cwd, request.task, {
    runCommand: (command) => runShellCommand(command, { cwd: request.cwd, signal: request.signal }),
  });
  return {
    nodeId,
    type: "hydrate",
    attempt,
    status: "success",
    output,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function executeFinalNode(
  nodeId: string,
  node: Extract<BlueprintNode, { type: "final" }>,
  attempt: number,
  state: BlueprintTemplateState,
): BlueprintNodeResult {
  const now = new Date().toISOString();
  return {
    nodeId,
    type: "final",
    attempt,
    status: "success",
    output: node.message ?? `Blueprint ${state.blueprint.id} completed.`,
    startedAt: now,
    finishedAt: now,
  };
}

function nextNodeId(node: BlueprintNode, result: BlueprintNodeResult): string | undefined {
  if (result.status === "success") return node.on?.success ?? node.next;
  return node.on?.failure;
}

function emitProgress(
  onProgress: ((progress: BlueprintRunProgress) => void) | undefined,
  artifacts: BlueprintRunArtifacts,
  status: BlueprintRunResult["status"],
  currentNodeId: string | undefined,
  message: string,
  results: BlueprintNodeResult[],
): void {
  onProgress?.({
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    status,
    currentNodeId,
    message,
    results: results.map((result) => ({ ...result })),
  });
}
