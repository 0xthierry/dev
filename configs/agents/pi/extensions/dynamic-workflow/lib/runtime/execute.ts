import vm from "node:vm";
import { parseWorkflowScript } from "../script/parse";
import { createLimiter } from "./limiter";
import type { WorkflowAgentOptions, WorkflowChildAgentResult, WorkflowRunOptions, WorkflowRunResult } from "./types";

interface WorkflowRuntimeState {
  currentPhase?: string;
  logs: string[];
  phases: string[];
  agents: WorkflowChildAgentResult[];
  agentCount: number;
  spent: number;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_AGENTS = 12;
const SYNC_VM_TIMEOUT_MS = 1000;

export async function runDynamicWorkflow<T = unknown>(
  script: string,
  options: WorkflowRunOptions,
): Promise<WorkflowRunResult<T>> {
  const started = Date.now();
  const { meta, body } = parseWorkflowScript(script);
  const state: WorkflowRuntimeState = { logs: [], phases: [], agents: [], agentCount: 0, spent: 0 };
  const limiter = createLimiter(options.concurrency ?? DEFAULT_CONCURRENCY);
  const maxAgents = options.maxAgents ?? DEFAULT_MAX_AGENTS;

  const log = (...messages: unknown[]) => {
    const text = messages.map((message) => String(message)).join(" ");
    state.logs.push(text);
    options.onLog?.(text);
  };

  const phase = (title: string) => {
    const normalized = String(title).trim();
    if (!normalized) throw new Error("phase() requires a non-empty title");
    state.currentPhase = normalized;
    if (!state.phases.includes(normalized)) state.phases.push(normalized);
    options.onPhase?.(normalized);
  };

  const budget = Object.freeze({
    total: options.tokenBudget ?? null,
    spent: () => state.spent,
    remaining: () => (options.tokenBudget == null ? Infinity : Math.max(0, options.tokenBudget - state.spent)),
  });

  const throwIfAborted = () => {
    if (options.signal?.aborted) throw new Error("workflow aborted");
  };

  const agent = async (prompt: string, agentOptions: WorkflowAgentOptions = {}) => {
    throwIfAborted();
    if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("agent() requires a non-empty prompt");
    if (state.agentCount >= maxAgents) throw new Error(`workflow exceeded maximum agent count (${maxAgents})`);
    if (budget.total !== null && budget.remaining() <= 0) throw new Error("workflow token budget exhausted");

    const id = state.agentCount + 1;
    state.agentCount = id;
    const assignedPhase = agentOptions.phase ?? state.currentPhase;
    const label = normalizeLabel(agentOptions.label) ?? defaultAgentLabel(assignedPhase, id);

    return limiter(async () => {
      options.onAgentStart?.({ id, label, phase: assignedPhase, prompt });
      try {
        throwIfAborted();
        const result = await options.agentRunner.runAgent(
          {
            runId: options.runId,
            runDir: options.runDir,
            sessionsDir: options.sessionsDir,
            cwd: options.cwd,
            index: id,
            label,
            phase: assignedPhase,
            prompt,
            schema: agentOptions.schema,
            modelRef: agentOptions.model ?? options.modelRef,
            thinking: agentOptions.thinking ?? options.thinking,
            instructions: buildAgentInstructions(assignedPhase, agentOptions),
          },
          options.signal,
          (progress) => options.onAgentProgress?.({ id, label, phase: assignedPhase, result: progress }),
        );
        throwIfAborted();
        state.spent += estimateTokens(result.value ?? result.output);
        state.agents.push(result);
        if (!result.ok) log(`agent ${label} failed: ${result.errorMessage ?? result.output}`);
        options.onAgentEnd?.({ id, label, phase: assignedPhase, result });
        return result.ok ? result.value : null;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const result = failedAgentResult(label, prompt, error);
        state.agents.push(result);
        log(`agent ${label} failed: ${errorMessage(error)}`);
        options.onAgentEnd?.({ id, label, phase: assignedPhase, result });
        return null;
      }
    });
  };

  const parallel = async (thunks: Array<() => Promise<unknown>>) => {
    throwIfAborted();
    if (!Array.isArray(thunks)) throw new TypeError("parallel() expects an array of functions");
    if (thunks.some((thunk) => typeof thunk !== "function")) {
      throw new TypeError("parallel() expects functions, not promises. Wrap each call: () => agent(...)");
    }
    return Promise.all(
      thunks.map(async (thunk, index) => {
        try {
          return await thunk();
        } catch (error) {
          if (options.signal?.aborted) throw error;
          log(`parallel[${index}] failed: ${errorMessage(error)}`);
          return null;
        }
      }),
    );
  };

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(previous: unknown, original: unknown, index: number) => unknown>
  ) => {
    throwIfAborted();
    if (!Array.isArray(items)) throw new TypeError("pipeline() expects an array as the first argument");
    if (stages.some((stage) => typeof stage !== "function")) {
      throw new TypeError("pipeline() stages must be functions");
    }
    return Promise.all(
      items.map(async (item, index) => {
        let value = item;
        for (const stage of stages) {
          try {
            throwIfAborted();
            value = await stage(value, item, index);
            throwIfAborted();
          } catch (error) {
            if (options.signal?.aborted) throw error;
            log(`pipeline[${index}] failed: ${errorMessage(error)}`);
            return null;
          }
        }
        return value;
      }),
    );
  };

  const context = vm.createContext(
    {
      agent,
      parallel,
      pipeline,
      phase,
      log,
      args: options.args,
      cwd: options.cwd,
      process: Object.freeze({ cwd: () => options.cwd }),
      budget,
      console: Object.freeze({
        log,
        info: log,
        warn: (...messages: unknown[]) => log("[warn]", ...messages),
        error: (...messages: unknown[]) => log("[error]", ...messages),
      }),
      JSON,
      Math: createSafeMath(),
      Array,
      Object,
      String,
      Number,
      Boolean,
      Set,
      Map,
      Promise,
    },
    { codeGeneration: { strings: false, wasm: false } },
  );

  const wrapped = `(async () => {\n${body}\n})()`;
  const result = await new vm.Script(wrapped, { filename: `${meta.name || "workflow"}.js` }).runInContext(context, {
    timeout: SYNC_VM_TIMEOUT_MS,
  });

  return {
    meta,
    result: result as T,
    logs: [...state.logs],
    phases: [...state.phases],
    agents: state.agents.map((item) => ({ ...item, activity: item.activity.map((activity) => ({ ...activity })) })),
    agentCount: state.agentCount,
    durationMs: Date.now() - started,
  };
}

function createSafeMath(): Math {
  const safeMath = Object.create(null) as Math;
  for (const name of Object.getOwnPropertyNames(Math) as Array<keyof Math>) {
    if (name === "random") continue;
    Object.defineProperty(safeMath, name, Object.getOwnPropertyDescriptor(Math, name) ?? { value: Math[name] });
  }
  Object.defineProperty(safeMath, "random", {
    value: () => {
      throw new Error("Math.random() is unavailable in workflow scripts");
    },
  });
  return Object.freeze(safeMath);
}

function normalizeLabel(label: string | undefined): string | undefined {
  const value = label?.trim();
  return value || undefined;
}

function defaultAgentLabel(phase: string | undefined, index: number): string {
  return phase ? `${phase} agent ${index}` : `agent ${index}`;
}

function buildAgentInstructions(phase: string | undefined, options: WorkflowAgentOptions): string | undefined {
  const lines: string[] = [];
  if (phase) lines.push(`Workflow phase: ${phase}`);
  if (options.agentType) lines.push(`Act as workflow subagent type: ${options.agentType}`);
  if (options.model) lines.push(`Requested model: ${options.model}`);
  return lines.length ? lines.join("\n") : undefined;
}

function failedAgentResult(label: string, prompt: string, error: unknown): WorkflowChildAgentResult {
  const message = errorMessage(error);
  return {
    label,
    status: "failed",
    ok: false,
    output: `agent ${label} failed: ${message}`,
    value: null,
    outputTruncated: false,
    stderr: message,
    exitCode: 1,
    activity: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0, turns: 0 },
    errorMessage: message || prompt,
  };
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown workflow failure";
}
