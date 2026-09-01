import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents/discovery";
import { appendAgentPromptSection, buildAgentPromptSection } from "./agents/prompt";
import type { AgentDefinition, AgentDiscoveryResult } from "./agents/types";
import {
  type ArtifactPage,
  type ReadArtifactPageOptions,
  type ReadArtifactPageResult,
  readArtifact,
  readAuthorizedArtifactPage,
  writeArtifact,
} from "./artifacts/artifacts";
import type { ResolvedAgentExecution } from "./execution/profile";
import { formatExecutionError, parseReasoningEffort } from "./execution/profile";
import { resolveAgentExecution, validateAgentExecution } from "./execution/resolution";
import { type AuthenticatedCaller, CHILD_IPC_SOCKET_ENV, CHILD_IPC_TOKEN_ENV } from "./ipc/authentication";
import {
  createIpcServer,
  createSupervisorIpcDispatcher,
  type IpcServer,
  type SupervisorIpcExecutionResolver,
} from "./ipc/server";
import { buildAgentInvocation, CHILD_DEPTH_ENV } from "./runner/invocation";
import type {
  AgentAssignmentRequest,
  AgentProcessEventListener,
  AgentProcessState,
  AgentSubmission,
} from "./runner/process";
import { createAgentProcess } from "./runner/process";
import { type AgentPromptFile, removeAgentPromptFile, writeAgentPromptFile } from "./runner/prompt-file";
import { createEnvironmentRedactor, type RedactText, redactStringValues } from "./security/redaction";
import { createRuntimeEntry, SUBAGENT_RUNTIME_ENTRY_TYPE } from "./sessions/entries";
import { getProjectSessionDirectory } from "./sessions/paths";
import { recoverRuntimeMetadata } from "./sessions/recovery";
import { type FinalAnswerNotification, formatFinalAnswerMailMessage } from "./supervisor/mailbox";
import {
  type AgentActivity,
  type AgentSupervisor,
  type CreateSupervisorProcessRequest,
  createAgentSupervisor,
  DEFAULT_SUPERVISOR_LIMITS,
  type RestoreAgentRequest,
  type SupervisorAgentProcess,
  type SupervisorLimits,
} from "./supervisor/supervisor";
import { registerAgentTools } from "./tools/catalog";
import type { ExecutionInput } from "./tools/schemas";
import type { AgentToolsRuntime } from "./tools/shared";
import { ToolInputError } from "./tools/shared";
import { createAgentActivityWidget, hasLiveAgentActivity } from "./ui/activity";

export const PARENT_ORCHESTRATION_GUIDANCE = `## Persistent subagent orchestration
Use persistent subagents for concrete, bounded, self-contained work with disjoint ownership.
Before delegating, decide what immediate critical-path work must stay local; do not hand off an urgent blocker when your next step depends on its result.
Spawn independent work in the background, continue useful local work, communicate deliberately, and wait only when a result becomes a dependency.
Avoid duplicate lanes. Review child evidence and changes before integrating them.
Use exact agent IDs or canonical paths returned by agent tools. Communication does not start an assignment; follow-up does.
Provider and model are atomic. Model and effort resolve independently by invocation, trusted repository, agent definition, then parent execution.`;

export interface SubagentBoundaryRuntime extends AgentToolsRuntime {
  start(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void>;
  buildParentPrompt(ctx: ExtensionContext): Promise<string>;
  shutdown(): Promise<void>;
}

export function registerSubagentExtension(
  pi: ExtensionAPI,
  runtime: SubagentBoundaryRuntime = createPiSubagentBoundaryRuntime(),
): void {
  if (hasChildLaunchEnvironment(process.env)) return;

  let started = false;
  registerAgentTools(pi, runtime);
  pi.on("session_start", async (_event, ctx) => {
    await runtime.start(pi, ctx);
    started = true;
  });
  pi.on("before_agent_start", async (event, ctx) => {
    if (!started) {
      await runtime.start(pi, ctx);
      started = true;
    }
    runtime.supervisor.clearSettledActivities();
    return { systemPrompt: appendAgentPromptSection(event.systemPrompt, await runtime.buildParentPrompt(ctx)) };
  });
  pi.on("turn_start", () => {
    runtime.supervisor.clearSettledActivities();
  });
  pi.on("session_shutdown", async () => {
    started = false;
    await runtime.shutdown();
  });
}

export function hasChildLaunchEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const depth = Number(environment[CHILD_DEPTH_ENV]);
  return Boolean(
    environment[CHILD_IPC_SOCKET_ENV] || environment[CHILD_IPC_TOKEN_ENV] || (Number.isInteger(depth) && depth > 0),
  );
}

export function createPiSubagentBoundaryRuntime(): SubagentBoundaryRuntime {
  return new PiSubagentBoundaryRuntime();
}

class PiSubagentBoundaryRuntime implements SubagentBoundaryRuntime {
  readonly supervisor: AgentSupervisor = delegatingSupervisor(() => this.requireSession().supervisor);
  private session: ActiveSession | undefined;
  private shutdownPromise: Promise<void> | undefined;

  async start(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
    await this.shutdown();
    const token = Symbol("subagent-session");
    const discovery = await discoverForContext(ctx);
    const sessionFiles = new Map<string, string>();
    const socketPath = sessionSocketPath(ctx);
    const redact = createEnvironmentRedactor(process.env, [socketPath]);
    let supervisor!: AgentSupervisor;
    const ipc = createIpcServer({
      socketPath,
      redact,
      dispatcher: createSupervisorIpcDispatcher({
        supervisor: delegatingSupervisor(() => supervisor),
        execution: this.createNestedExecutionResolver(token, sessionFiles),
        artifacts: {
          read: async (caller, reference, options, signal) =>
            await this.readNestedArtifactPage(token, caller, reference, options, signal),
        },
      }),
    });
    const limits = limitsFromDiscovery(discovery);
    const processFactory = new PiProcessFactory({
      cwd: ctx.cwd,
      discovery,
      sessionDirectory: getProjectSessionDirectory(ctx.cwd),
      childRuntimeExtensionPath: fileURLToPath(new URL("./runner/child-runtime.ts", import.meta.url)),
      ipc,
      socketPath,
      sessionFiles,
    });
    supervisor = createAgentSupervisor(
      {
        createAgentId: () => randomUUID(),
        createMailId: () => randomUUID(),
        createProcess: (request) => processFactory.create(request),
        reportAgentActivity: (agentPath, activity) => this.reportAgentActivity(token, agentPath, activity),
        deliverRootCompletion: (notification) => this.deliverRootCompletion(token, notification),
        journal: {
          append: (entry) => {
            const active = this.session;
            if (!active || active.token !== token) return;
            active.pi.appendEntry(SUBAGENT_RUNTIME_ENTRY_TYPE, createRuntimeEntry(redactStringValues(entry, redact)));
          },
        },
        artifacts: {
          write: async (input) =>
            await writeArtifact({ cwd: ctx.cwd, ...input, content: redact(input.content) }).then(({ reference }) => ({
              reference,
            })),
          read: async (reference) => {
            const result = await readArtifact(reference, ctx.cwd);
            return result.ok ? { ok: true as const, content: redact(result.content) } : result;
          },
        },
      },
      { limits, redact },
    );
    this.session = {
      token,
      pi,
      ctx,
      discovery,
      supervisor,
      ipc,
      processFactory,
      sessionFiles,
      activities: new Map(),
      redact,
      stopping: false,
    };
    const recovered = recoverRuntimeMetadata(ctx.sessionManager.getBranch());
    for (const item of recovered) sessionFiles.set(item.agentPath, item.sessionFile);
    if (recovered.length) await supervisor.restore(recoveryRequests(recovered));
  }

  async readArtifactPage(reference: string, options: ReadArtifactPageOptions): Promise<ReadArtifactPageResult> {
    const active = this.requireSession();
    const result = await readAuthorizedArtifactPage(reference, active.ctx.cwd, "/root", options);
    if (!result.ok) return result;
    return {
      ok: true,
      page: { ...result.page, content: active.redact(result.page.content) },
    };
  }

  async buildParentPrompt(ctx: ExtensionContext): Promise<string> {
    const active = this.session;
    const discovery = active && !active.stopping ? active.discovery : await discoverForContext(ctx);
    return appendAgentPromptSection(PARENT_ORCHESTRATION_GUIDANCE, buildAgentPromptSection(discovery.agents));
  }

  async resolveExecution(
    input: ExecutionInput | undefined,
    options: {
      operation: "spawn" | "followup";
      agentType?: string;
      target?: string;
      ctx: ExtensionContext;
    },
  ): Promise<ResolvedAgentExecution> {
    const active = this.requireSession();
    return await this.resolveForSession(active, input, {
      operation: options.operation,
      agentType: options.agentType,
      target: options.target,
      parent: parentExecution(options.ctx),
    });
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return await this.shutdownPromise;
    const active = this.session;
    if (!active) return;
    active.stopping = true;
    const operation = this.stopActiveSession(active);
    this.shutdownPromise = operation;
    try {
      await operation;
    } finally {
      if (this.session === active) this.session = undefined;
      if (this.shutdownPromise === operation) this.shutdownPromise = undefined;
    }
  }

  private async stopActiveSession(active: ActiveSession): Promise<void> {
    if (active.ctx.hasUI) active.ctx.ui.setWidget("subagent-activity", undefined);
    const failures: unknown[] = [];
    for (const cleanup of [
      () => active.ipc.stop(),
      () => active.supervisor.shutdown(),
      () => active.processFactory.close(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Subagent session cleanup failed");
  }

  private async readNestedArtifactPage(
    token: symbol,
    caller: AuthenticatedCaller,
    reference: string,
    options: ReadArtifactPageOptions,
    signal: AbortSignal,
  ): Promise<ArtifactPage> {
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    const active = this.requireSession(token);
    const result = await readAuthorizedArtifactPage(reference, active.ctx.cwd, caller.agentPath, options);
    if (!result.ok)
      throw new ToolInputError("artifact_access_denied", "Artifact is unavailable to the authenticated caller");
    return { ...result.page, content: active.redact(result.page.content) };
  }

  private reportAgentActivity(token: symbol, agentPath: string, activity: AgentActivity | undefined): void {
    const active = this.session;
    if (!active || active.token !== token || active.stopping) return;
    if (activity) active.activities.set(agentPath, activity);
    else active.activities.delete(agentPath);
    if (!active.ctx.hasUI) return;
    const rows = [...active.activities.entries()].sort(([left], [right]) => left.localeCompare(right));
    const activityRows = rows.map(([agentPath, activity]) => ({ agentPath, activity }));
    if (!hasLiveAgentActivity(activityRows)) {
      active.ctx.ui.setWidget("subagent-activity", undefined);
      return;
    }
    active.ctx.ui.setWidget(
      "subagent-activity",
      (tui, theme) => createAgentActivityWidget(activityRows, theme, (force) => tui.requestRender(force)),
      { placement: "aboveEditor" },
    );
  }

  private deliverRootCompletion(token: symbol, notification: FinalAnswerNotification): void {
    const active = this.requireSession(token);
    const message = formatRootFinalAnswer(notification, active.redact);
    active.pi.sendMessage(
      {
        customType: "subagent-final-answer",
        content: message,
        display: false,
      },
      active.ctx.isIdle() ? undefined : { deliverAs: "steer" },
    );
  }

  private createNestedExecutionResolver(
    token: symbol,
    sessionFiles: Map<string, string>,
  ): SupervisorIpcExecutionResolver {
    return {
      resolve: async (input, options) => {
        const active = this.requireSession(token);
        const entries = await active.supervisor.list(options.signal);
        const caller = entries.find((entry) => entry.agentPath === options.caller.agentPath);
        if (!caller) throw new ToolInputError("invalid_path", "Authenticated caller is not registered");
        return await this.resolveForSession(active, input, {
          operation: options.operation,
          agentType: options.agentType,
          target: options.target,
          parent: caller.execution,
        });
      },
      resolveForkParentSession: async (caller) => sessionFiles.get(caller.agentPath) ?? "",
    };
  }

  private async resolveForSession(
    active: ActiveSession,
    input: ExecutionInput | undefined,
    options: {
      operation: "spawn" | "followup";
      agentType?: string;
      target?: string;
      parent: ResolvedAgentExecution;
    },
  ): Promise<ResolvedAgentExecution> {
    let agent: AgentDefinition | undefined;
    let parent = options.parent.profile;
    if (options.operation === "spawn") {
      agent = active.discovery.agents.find((candidate) => candidate.name === options.agentType);
      if (!agent) throw new ToolInputError("unknown_agent", `Unknown subagent type: ${options.agentType ?? ""}`);
    } else {
      const entries = await active.supervisor.list();
      const target = entries.find((entry) => entry.agentId === options.target || entry.agentPath === options.target);
      if (!target) throw new ToolInputError("invalid_path", "Agent target was not found");
      agent = active.discovery.agents.find((candidate) => candidate.name === target.agentType);
      if (!agent) throw new ToolInputError("unknown_agent", `Unknown subagent type: ${target.agentType}`);
      parent = target.execution.profile;
    }

    const selectedAgent = agent;
    const repository = active.discovery.repositoryConfig?.agents.get(selectedAgent.name);
    const resolved = resolveAgentExecution({
      invocation: input,
      repository: repository
        ? { ...repository.execution, allowInvocationOverride: repository.allowInvocationOverride }
        : undefined,
      agent: selectedAgent.execution,
      parent,
    });
    if (!resolved.ok) throw new ToolInputError(resolved.error.kind, formatExecutionError(resolved.error));

    const registry = active.ctx.modelRegistry;
    const selected = registry.find(resolved.value.profile.provider, resolved.value.profile.model);
    const providerExists = registry.getAll().some((model) => model.provider === resolved.value.profile.provider);
    const authenticated = selected ? (await registry.getApiKeyAndHeaders(selected)).ok : false;
    const validation = validateAgentExecution(resolved.value, {
      hasProvider: (provider) => provider === resolved.value.profile.provider && providerExists,
      findModel: (provider, model) =>
        selected && selected.provider === provider && selected.id === model
          ? { provider, model, supportedEfforts: getSupportedThinkingLevels(selected) }
          : undefined,
      canAuthenticate: (provider) => provider === resolved.value.profile.provider && authenticated,
    });
    if (!validation.ok) throw new ToolInputError(validation.error.kind, formatExecutionError(validation.error));
    return validation.value;
  }

  private requireSession(token?: symbol): ActiveSession {
    const active = this.session;
    if (!active || active.stopping || (token && active.token !== token)) {
      throw new ToolInputError("session_unavailable", "Subagent session is not active");
    }
    return active;
  }
}

export function formatRootFinalAnswer(notification: FinalAnswerNotification, redact: RedactText): string {
  return formatFinalAnswerMailMessage(redactStringValues(notification, redact));
}

interface ActiveSession {
  token: symbol;
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  discovery: AgentDiscoveryResult;
  supervisor: AgentSupervisor;
  ipc: IpcServer;
  processFactory: PiProcessFactory;
  sessionFiles: Map<string, string>;
  activities: Map<string, AgentActivity>;
  redact: RedactText;
  stopping: boolean;
}

interface PiProcessFactoryOptions {
  cwd: string;
  discovery: AgentDiscoveryResult;
  sessionDirectory: string;
  childRuntimeExtensionPath: string;
  ipc: IpcServer;
  socketPath: string;
  sessionFiles: Map<string, string>;
}

class PiProcessFactory {
  private readonly processes = new Set<LazyPiAgentProcess>();

  constructor(private readonly options: PiProcessFactoryOptions) {}

  create(request: CreateSupervisorProcessRequest): SupervisorAgentProcess {
    const definition = this.options.discovery.agents.find((agent) => agent.name === request.agentType);
    if (!definition) throw new Error(`Unknown subagent type: ${request.agentType}`);
    const process = new LazyPiAgentProcess(this.options, request, definition, () => this.processes.delete(process));
    this.processes.add(process);
    return process;
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.processes].map((process) => process.close()));
    this.processes.clear();
  }
}

class LazyPiAgentProcess implements SupervisorAgentProcess {
  private process: ReturnType<typeof createAgentProcess> | undefined;
  private promptFile: AgentPromptFile | undefined;
  private readonly listeners = new Set<AgentProcessEventListener>();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  private capabilityIssued = false;

  constructor(
    private readonly options: PiProcessFactoryOptions,
    private readonly request: CreateSupervisorProcessRequest,
    private readonly definition: AgentDefinition,
    private readonly onClose: () => void,
  ) {}

  async startup(options: { signal?: AbortSignal } = {}): Promise<AgentProcessState> {
    if (this.closed) throw new Error("Agent process is closed");
    await this.options.ipc.start();
    const capability = this.options.ipc.authority.issue({
      agentId: this.request.agentId,
      agentPath: this.request.agentPath,
    });
    this.capabilityIssued = true;
    try {
      this.promptFile = await writeAgentPromptFile({
        agentPath: this.request.agentPath,
        instructions: this.definition.systemPrompt,
      });
      const invocation = buildAgentInvocation({
        cwd: this.options.cwd,
        session: invocationSession(this.request, this.options.sessionDirectory),
        execution: this.request.execution,
        childRuntimeExtensionPath: this.options.childRuntimeExtensionPath,
        systemPromptPath: this.promptFile.filePath,
      });
      invocation.env[CHILD_IPC_SOCKET_ENV] = this.options.socketPath;
      invocation.env[CHILD_IPC_TOKEN_ENV] = capability.token;
      const redact = createEnvironmentRedactor(invocation.env, [capability.token, this.options.socketPath]);
      const process = createAgentProcess({ invocation, execution: this.request.execution, redact });
      this.process = process;
      for (const listener of this.listeners) process.onEvent(listener);
      process.onEvent((event) => {
        if (event.type === "exit") void this.cleanup();
      });
      const state = await process.startup(options);
      if (state.sessionFile) this.options.sessionFiles.set(this.request.agentPath, state.sessionFile);
      return state;
    } catch (error) {
      await this.process?.close().catch(() => {});
      await this.cleanup();
      throw error;
    } finally {
      await this.removePrompt();
    }
  }

  submit(request: AgentAssignmentRequest): Promise<AgentSubmission> {
    return this.requireProcess().submit(request);
  }

  send(message: string, signal?: AbortSignal): Promise<void> {
    return this.requireProcess().send(message, signal);
  }

  followup(request: AgentAssignmentRequest): Promise<AgentSubmission> {
    return this.requireProcess().followup(request);
  }

  interrupt(signal?: AbortSignal): Promise<void> {
    return this.requireProcess().interrupt(signal);
  }

  onEvent(listener: AgentProcessEventListener): () => void {
    this.listeners.add(listener);
    const remove = this.process?.onEvent(listener);
    return () => {
      this.listeners.delete(listener);
      remove?.();
    };
  }

  async close(): Promise<void> {
    if (this.closePromise) return await this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      try {
        await this.process?.close();
      } finally {
        await this.cleanup();
      }
    })();
    return await this.closePromise;
  }

  private requireProcess(): ReturnType<typeof createAgentProcess> {
    if (!this.process || this.closed) throw new Error("Agent process is unavailable");
    return this.process;
  }

  private async cleanup(): Promise<void> {
    if (this.capabilityIssued) {
      this.options.ipc.authority.revoke({ agentId: this.request.agentId, agentPath: this.request.agentPath });
      this.capabilityIssued = false;
    }
    await this.removePrompt();
    this.onClose();
  }

  private async removePrompt(): Promise<void> {
    const promptFile = this.promptFile;
    this.promptFile = undefined;
    if (promptFile) await removeAgentPromptFile(promptFile).catch(() => {});
  }
}

function invocationSession(request: CreateSupervisorProcessRequest, sessionDirectory: string) {
  switch (request.session.kind) {
    case "fresh":
      return { kind: "fresh" as const, sessionDirectory };
    case "fork":
      return { kind: "fork" as const, sessionDirectory, parentSessionFile: request.session.parentSessionFile };
    case "recovered":
      return { kind: "recovered" as const, sessionFile: request.session.sessionFile };
  }
}

function parentExecution(ctx: ExtensionContext): ResolvedAgentExecution {
  if (!ctx.model) throw new ToolInputError("parent_model_unavailable", "Parent session has no active model");
  const effort = ctx.model.reasoning ? (parseReasoningEffort(ctx.thinkingLevel) ?? "medium") : "off";
  return {
    profile: { provider: ctx.model.provider, model: ctx.model.id, effort },
    source: { model: "parent", effort: "parent" },
  };
}

function limitsFromDiscovery(discovery: AgentDiscoveryResult): SupervisorLimits {
  const configured = discovery.repositoryConfig?.runtime;
  return configured
    ? {
        maxActiveAgents: configured.maxActiveAgents,
        maxResidentAgents: configured.maxResidentAgents,
        maxDepth: configured.maxDepth,
      }
    : { ...DEFAULT_SUPERVISOR_LIMITS };
}

async function discoverForContext(ctx: ExtensionContext): Promise<AgentDiscoveryResult> {
  return await discoverAgents({
    cwd: ctx.cwd,
    projectTrusted: ctx.isProjectTrusted(),
    globalAgentsDir: join(getAgentDir(), "agents"),
  });
}

function sessionSocketPath(ctx: ExtensionContext): string {
  const identity = `${ctx.cwd}\0${ctx.sessionManager.getSessionId()}\0${randomUUID()}`;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 24);
  return join(tmpdir(), `pi-subagent-${hash}`, "control.sock");
}

function recoveryRequests(metadata: ReturnType<typeof recoverRuntimeMetadata>): RestoreAgentRequest[] {
  return metadata.map((item) => ({
    agentPath: item.agentPath,
    agentId: item.agentId,
    agentType: item.agentType,
    sessionFile: item.sessionFile,
    execution: item.execution,
    assignmentGeneration: item.assignmentGeneration,
    assignments: item.assignments,
    queuedMailIds: item.queuedMailIds,
    status: item.status,
  }));
}

function delegatingSupervisor(current: () => AgentSupervisor): AgentSupervisor {
  return {
    spawn: (request) => current().spawn(request),
    send: (request) => current().send(request),
    followup: (request) => current().followup(request),
    wait: (request) => current().wait(request),
    interrupt: (target, signal) => current().interrupt(target, signal),
    list: (signal) => current().list(signal),
    close: (target, signal) => current().close(target, signal),
    clearSettledActivities: () => current().clearSettledActivities(),
    restore: (requests, signal) => current().restore(requests, signal),
    shutdown: (signal) => current().shutdown(signal),
  };
}
