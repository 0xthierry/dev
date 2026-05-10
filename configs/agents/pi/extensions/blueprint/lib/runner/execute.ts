import { mkdir, readFile } from "node:fs/promises";
import type { BlueprintTemplateState } from "../template";
import type { PiThinkingLevel } from "../thinking";
import type {
  BlueprintActiveNodeProgress,
  BlueprintNode,
  BlueprintNodeResult,
  BlueprintRunProgress,
  BlueprintRunResult,
  LoadedBlueprint,
} from "../types";
import { type BlueprintRunArtifacts, createBlueprintRunArtifacts } from "./artifacts";
import { executeCommandNode } from "./command-node";
import { buildInitialBlueprintContext } from "./context";
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
  command: typeof executeCommandNode;
  pi: typeof executePiNode;
}

export interface BlueprintRunOptions {
  executors?: BlueprintNodeExecutors;
  createArtifacts?: typeof createBlueprintRunArtifacts;
  buildInitialContext?: typeof buildInitialBlueprintContext;
}

const DEFAULT_MAX_STEPS = 50;

export async function runBlueprint(
  request: BlueprintRunRequest,
  onProgress?: (progress: BlueprintRunProgress) => void,
  options: BlueprintRunOptions = {},
): Promise<BlueprintRunResult> {
  const executors = options.executors ?? {
    command: executeCommandNode,
    pi: executePiNode,
  };
  const createArtifacts = options.createArtifacts ?? createBlueprintRunArtifacts;
  const createInitialContext = options.buildInitialContext ?? buildInitialBlueprintContext;
  const artifacts = await createArtifacts(request.blueprint, request.cwd, { rootDir: request.artifactRootDir });
  const initialContext = await createInitialContext(request.blueprint, request.cwd, request.task, {
    runCommand: (command) => runShellCommand(command, { cwd: request.cwd, signal: request.signal }),
  });
  await artifacts.writeContext(initialContext);

  const state: BlueprintTemplateState = {
    blueprint: request.blueprint,
    input: { task: request.task },
    contextFile: artifacts.contextFile,
    context: initialContext,
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

    const activeNode = activeNodeProgress(currentNodeId, node, attempt);
    emitProgress(
      onProgress,
      artifacts,
      status,
      currentNodeId,
      `Running ${currentNodeId} (${node.type}).`,
      results,
      activeNode,
    );
    const result = await executeNode(currentNodeId, node, attempt, request, artifacts, state, executors, (progress) =>
      emitProgress(onProgress, artifacts, status, currentNodeId, `Running ${currentNodeId} (${node.type}).`, results, {
        ...activeNode,
        ...progress,
      }),
    );
    results.push(result);
    state.nodes[currentNodeId] = result;
    await artifacts.writeNodeResult(result);
    state.context = await readContextFile(artifacts.contextFile, state.context);

    if (node.type === "stop") {
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
  onNodeProgress: (progress: Partial<BlueprintActiveNodeProgress>) => void,
): Promise<BlueprintNodeResult> {
  const nodeDir = artifacts.nodeDir(nodeId, attempt);
  await mkdir(nodeDir, { recursive: true });

  switch (node.type) {
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
        onProgress: (progress) => onNodeProgress({ activity: progress.activity }),
      });
    case "stop":
      return executeStopNode(nodeId, node, attempt, state);
  }
}

function executeStopNode(
  nodeId: string,
  node: Extract<BlueprintNode, { type: "stop" }>,
  attempt: number,
  state: BlueprintTemplateState,
): BlueprintNodeResult {
  const now = new Date().toISOString();
  return {
    nodeId,
    type: "stop",
    attempt,
    status: "success",
    output: node.message ?? `Blueprint ${state.blueprint.id} completed.`,
    startedAt: now,
    finishedAt: now,
  };
}

function activeNodeProgress(nodeId: string, node: BlueprintNode, attempt: number): BlueprintActiveNodeProgress {
  return { nodeId, type: node.type, attempt };
}

function nextNodeId(node: BlueprintNode, result: BlueprintNodeResult): string | undefined {
  if (result.status === "success") return node.on?.success ?? node.next;
  return node.on?.failure;
}

async function readContextFile(contextFile: string, fallback: string): Promise<string> {
  try {
    return await readFile(contextFile, "utf8");
  } catch {
    return fallback;
  }
}

function emitProgress(
  onProgress: ((progress: BlueprintRunProgress) => void) | undefined,
  artifacts: BlueprintRunArtifacts,
  status: BlueprintRunResult["status"],
  currentNodeId: string | undefined,
  message: string,
  results: BlueprintNodeResult[],
  activeNode?: BlueprintActiveNodeProgress,
): void {
  onProgress?.({
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    status,
    currentNodeId,
    message,
    results: cloneNodeResults(results),
    activeNode: activeNode ? { ...activeNode, activity: activeNode.activity?.map((item) => ({ ...item })) } : undefined,
  });
}

function cloneNodeResults(results: BlueprintNodeResult[]): BlueprintNodeResult[] {
  return results.map((result) => ({ ...result, activity: result.activity?.map((item) => ({ ...item })) }));
}
