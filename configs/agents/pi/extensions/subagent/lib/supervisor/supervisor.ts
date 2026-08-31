import { type ArtifactKind, ArtifactTooLargeError } from "../artifacts/artifacts";
import { prepareCompletionPreview } from "../artifacts/output";
import type { ResolvedAgentExecution } from "../execution/profile";
import type { AgentExecutionSettings } from "../runner/invocation";
import type {
  AgentAssignmentRequest,
  AgentProcessEventListener,
  AgentProcessState,
  AgentSettlement,
  AgentSubmission,
} from "../runner/process";
import { type RedactText, redactStringValues } from "../security/redaction";
import { SUBAGENT_RUNTIME_ENTRY_VERSION, type SubagentRuntimeEntry } from "../sessions/entries";
import {
  assertConfigurableLimit,
  DEFAULT_ACTIVE_AGENTS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_RESIDENT_AGENTS,
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "./limits";
import {
  AgentMailbox,
  FINAL_ANSWER_MESSAGE_TYPE,
  type FinalAnswerNotification,
  formatFinalAnswerMailMessage,
  type MailboxLimits,
  type MailMessage,
} from "./mailbox";
import {
  type AgentRecord,
  AgentRegistry,
  type AssignmentOutcome,
  type AssignmentRecord,
  RegistryError,
} from "./registry";
import { AgentScheduler, type SchedulerLimits, type ScheduleTicket } from "./scheduler";

export const DEFAULT_SUPERVISOR_LIMITS: SupervisorLimits = {
  maxActiveAgents: DEFAULT_ACTIVE_AGENTS,
  maxResidentAgents: DEFAULT_RESIDENT_AGENTS,
  maxDepth: DEFAULT_MAX_DEPTH,
};

export interface SupervisorLimits extends SchedulerLimits {
  maxDepth: number;
}

export interface SupervisorAgentProcess {
  startup(options?: { signal?: AbortSignal }): Promise<AgentProcessState>;
  submit(request: AgentAssignmentRequest): Promise<AgentSubmission>;
  send(message: string, signal?: AbortSignal): Promise<void>;
  followup(request: AgentAssignmentRequest): Promise<AgentSubmission>;
  interrupt(signal?: AbortSignal): Promise<void>;
  onEvent(listener: AgentProcessEventListener): () => void;
  close(): Promise<void>;
}

export type SupervisorProcessSession =
  | { kind: "fresh" }
  | { kind: "fork"; parentSessionFile: string }
  | { kind: "recovered"; sessionFile: string };

export interface CreateSupervisorProcessRequest {
  agentPath: string;
  agentId: string;
  agentType: string;
  execution: AgentExecutionSettings;
  session: SupervisorProcessSession;
}

export interface SupervisorJournalPort {
  append(entry: SubagentRuntimeEntry): void | Promise<void>;
}

export interface SupervisorArtifactPort {
  write(input: {
    agentPath: string;
    agentId: string;
    kind: ArtifactKind;
    content: string;
  }): Promise<{ reference: string }>;
  read(reference: string): Promise<{ ok: true; content: string } | { ok: false; reason: string }>;
}

export interface SupervisorRuntime {
  createAgentId(): string;
  createMailId(): string;
  createProcess(request: CreateSupervisorProcessRequest): SupervisorAgentProcess;
  deliverRootCompletion?(notification: FinalAnswerNotification): void | Promise<void>;
  journal: SupervisorJournalPort;
  artifacts: SupervisorArtifactPort;
}

export interface SupervisorOptions {
  limits: SupervisorLimits;
  mailboxLimits?: MailboxLimits;
  redact?: RedactText;
}

export interface SpawnAgentRequest {
  parentPath?: string;
  taskName: string;
  agentType: string;
  prompt: string;
  execution: ResolvedAgentExecution;
  context?: { kind: "isolated" } | { kind: "fork"; parentSessionFile: string };
  signal?: AbortSignal;
}

export interface FollowupAgentRequest {
  target: string;
  message: string;
  execution?: ResolvedAgentExecution;
  signal?: AbortSignal;
}

export interface SendAgentRequest {
  senderPath?: string;
  target: string;
  message: string;
  signal?: AbortSignal;
}

export interface AgentOperationResult {
  agentPath: string;
  agentId: string;
  assignmentId: string;
  status: "queued" | "running";
  execution: ResolvedAgentExecution;
}

export interface SendAgentResult {
  agentPath: string;
  agentId: string;
  delivery: "steered" | "queued";
  mailId?: string;
}

export interface WaitAgentRequest {
  targets: readonly string[];
  condition?: "all" | "any";
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type CompletionNotificationDelivery =
  | { status: "delivered"; delivery: "root" | "steered" | "queued"; mailId?: string }
  | {
      status: "failed";
      failure: {
        kind: "root_callback_failed" | "parent_unavailable" | "parent_mailbox_failed" | "shutting_down";
        targetPath: string;
        retryable: boolean;
        notification: FinalAnswerNotification;
      };
    };

export interface WaitSettlement {
  agentPath: string;
  agentId: string;
  assignmentId: string;
  outcome: AssignmentOutcome;
  artifactReference?: string;
  outputPreview?: string;
  errorKind?: string;
  notification?: CompletionNotificationDelivery;
}

export interface WaitAgentResult {
  condition: "all" | "any";
  timedOut: boolean;
  completed: WaitSettlement[];
  pending: { agentPath: string; agentId: string; assignmentId: string }[];
}

export interface AgentListEntry {
  agentPath: string;
  agentId: string;
  agentType: string;
  status: AgentRecord["status"];
  assignment?: { id: string; generation: number; phase: AssignmentRecord["phase"] };
  execution: ResolvedAgentExecution;
}

export interface RestoreAgentRequest {
  agentPath: string;
  agentId: string;
  agentType: string;
  sessionFile: string;
  execution: ResolvedAgentExecution;
  assignmentGeneration: number;
  queuedMailIds: readonly string[];
  status?: "unloaded" | "closed";
}

export type SupervisorErrorKind =
  | "invalid_task_name"
  | "invalid_path"
  | "invalid_message"
  | "depth_exceeded"
  | "closed"
  | "no_assignment"
  | "invalid_wait"
  | "shutting_down"
  | "process_unavailable"
  | "mail_recovery_unavailable";

export class SupervisorError extends Error {
  constructor(
    readonly kind: SupervisorErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SupervisorError";
  }
}

export interface AgentSupervisor {
  spawn(request: SpawnAgentRequest): Promise<AgentOperationResult>;
  send(request: SendAgentRequest): Promise<SendAgentResult>;
  followup(request: FollowupAgentRequest): Promise<AgentOperationResult>;
  wait(request: WaitAgentRequest): Promise<WaitAgentResult>;
  interrupt(target: string, signal?: AbortSignal): Promise<AgentListEntry>;
  list(signal?: AbortSignal): Promise<AgentListEntry[]>;
  close(target: string, signal?: AbortSignal): Promise<AgentListEntry>;
  restore(requests: readonly RestoreAgentRequest[], signal?: AbortSignal): Promise<void>;
  shutdown(signal?: AbortSignal): Promise<void>;
}

export class PersistentAgentSupervisor implements AgentSupervisor {
  private readonly registry = new AgentRegistry();
  private readonly scheduler: AgentScheduler;
  private readonly mailbox: AgentMailbox;
  private readonly processes = new Map<string, SupervisorAgentProcess>();
  private readonly tickets = new Map<string, ScheduleTicket>();
  private readonly interruptRequested = new Set<string>();
  private readonly interruptAcknowledged = new Set<string>();
  private readonly closingPaths = new Set<string>();
  private readonly settlementListeners = new Set<() => void>();
  private readonly completionNotifications = new Map<string, Promise<CompletionNotificationDelivery>>();
  private readonly completionNotificationResults = new Map<string, CompletionNotificationDelivery>();
  private journalTail: Promise<void> = Promise.resolve();
  private readonly redact: RedactText;
  private stopping = false;

  constructor(
    private readonly runtime: SupervisorRuntime,
    private readonly options: SupervisorOptions = { limits: DEFAULT_SUPERVISOR_LIMITS },
  ) {
    validateLimits(options.limits);
    this.redact = options.redact ?? ((value) => value);
    this.scheduler = new AgentScheduler(options.limits);
    this.mailbox = new AgentMailbox({ createMailId: () => runtime.createMailId() }, options.mailboxLimits);
  }

  async spawn(request: SpawnAgentRequest): Promise<AgentOperationResult> {
    this.requireOpen();
    throwIfAborted(request.signal);
    requireMessage(request.prompt, "spawn prompt");
    const parent = request.parentPath ?? "/root";
    const { path, depth } = this.childPath(parent, request.taskName);
    if (depth > this.options.limits.maxDepth) {
      throw new SupervisorError("depth_exceeded", `Agent depth ${depth} exceeds limit ${this.options.limits.maxDepth}`);
    }
    const agentId = exactId(this.runtime.createAgentId(), "agent");
    const record = this.registry.register({
      agentPath: path,
      agentId,
      parentPath: parent,
      taskName: request.taskName,
      agentType: request.agentType,
      depth,
      execution: request.execution,
    });
    const assignment = this.registry.queueAssignment(path, "spawn");
    const session: SupervisorProcessSession =
      request.context?.kind === "fork"
        ? { kind: "fork", parentSessionFile: request.context.parentSessionFile }
        : { kind: "fresh" };
    const ticket = this.scheduleAssignment(
      record,
      assignment,
      request.prompt,
      request.execution,
      session,
      request.signal,
    );
    return await this.operationResult(path, assignment.id, ticket);
  }

  async send(request: SendAgentRequest): Promise<SendAgentResult> {
    this.requireOpen();
    throwIfAborted(request.signal);
    requireMessage(request.message, "mail message");
    const message = this.redact(request.message);
    const record = this.registry.resolve(request.target);
    this.requireNotClosing(record);
    const process = this.processes.get(record.agentPath);
    if (record.status === "running" && process) {
      await process.send(message, request.signal);
      return { agentPath: record.agentPath, agentId: record.agentId, delivery: "steered" };
    }
    const senderPath = request.senderPath ?? "/root";
    const reservation = this.mailbox.reserve(senderPath, record.agentPath, message);
    let mail: MailMessage;
    try {
      const artifact = await this.runtime.artifacts.write({
        agentPath: record.agentPath,
        agentId: record.agentId,
        kind: "handoff",
        content: encodeDurableMail(senderPath, message),
      });
      mail = this.mailbox.commit(reservation, durableMailId(artifact.reference));
    } catch (error) {
      this.mailbox.release(reservation);
      throw error;
    }
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "mail_queued",
      agentPath: record.agentPath,
      agentId: record.agentId,
      mailId: mail.id,
    });
    return { agentPath: record.agentPath, agentId: record.agentId, delivery: "queued", mailId: mail.id };
  }

  async followup(request: FollowupAgentRequest): Promise<AgentOperationResult> {
    this.requireOpen();
    throwIfAborted(request.signal);
    requireMessage(request.message, "follow-up message");
    const record = this.registry.resolve(request.target);
    this.requireNotClosing(record);
    const execution = request.execution ?? record.execution;
    const assignment = this.registry.queueAssignment(record.agentPath, "followup");
    const session: SupervisorProcessSession = this.processes.has(record.agentPath)
      ? { kind: "recovered", sessionFile: record.sessionFile ?? "resident" }
      : { kind: "recovered", sessionFile: requireSessionFile(record) };
    const ticket = this.scheduleAssignment(record, assignment, request.message, execution, session, request.signal);
    return await this.operationResult(record.agentPath, assignment.id, ticket);
  }

  async wait(request: WaitAgentRequest): Promise<WaitAgentResult> {
    this.requireOpen();
    throwIfAborted(request.signal);
    const condition = request.condition ?? "all";
    const timeoutMs = request.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    if (
      (condition !== "all" && condition !== "any") ||
      request.targets.length < 1 ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_WAIT_TIMEOUT_MS
    ) {
      throw new SupervisorError(
        "invalid_wait",
        `Wait requires at least one target and a timeout from 0-${MAX_WAIT_TIMEOUT_MS}ms`,
      );
    }
    const targets = request.targets.map((target) => {
      const agent = this.registry.resolve(target);
      const assignment = this.registry.latestAssignment(agent.agentPath);
      if (!assignment) throw new SupervisorError("no_assignment", `Agent has no assignment: ${agent.agentPath}`);
      return { agentPath: agent.agentPath, agentId: agent.agentId, assignmentId: assignment.id };
    });
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const result = this.inspectWait(targets, condition, false);
      if (waitSatisfied(result, condition)) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return this.inspectWait(targets, condition, true);
      const notified = await this.waitForSettlement(Math.min(remaining, MAX_WAIT_TIMEOUT_MS), request.signal);
      if (!notified) return this.inspectWait(targets, condition, true);
      this.requireOpen();
    }
  }

  async interrupt(target: string, signal?: AbortSignal): Promise<AgentListEntry> {
    this.requireOpen();
    throwIfAborted(signal);
    const record = this.registry.resolve(target);
    this.requireNotClosing(record);
    const active = record.assignments.find(
      (assignment) => assignment.phase === "starting" || assignment.phase === "running",
    );
    if (!active) return listEntry(record);
    const interruptedAgent = {
      agentPath: record.agentPath,
      agentId: record.agentId,
      agentType: record.agentType,
      execution: copyExecution(record.execution),
    };
    const firstRequest = !this.interruptRequested.has(active.id);
    this.interruptRequested.add(active.id);
    const process = this.processes.get(record.agentPath);
    if (firstRequest && process) {
      try {
        await process.interrupt();
        this.interruptAcknowledged.add(active.id);
      } catch (error) {
        this.interruptRequested.delete(active.id);
        this.interruptAcknowledged.delete(active.id);
        throw error;
      }
    }
    const ticket = this.tickets.get(active.id);
    if (ticket) await ticket.done.catch(() => {});
    const settled = this.registry.assignmentById(record.agentPath, active.id);
    return {
      ...interruptedAgent,
      status:
        settled.outcome === "completed" ? "idle" : (settled.outcome ?? this.registry.resolve(record.agentPath).status),
      assignment: { id: settled.id, generation: settled.generation, phase: settled.phase },
    };
  }

  async list(signal?: AbortSignal): Promise<AgentListEntry[]> {
    throwIfAborted(signal);
    return this.registry.list().map(listEntry);
  }

  async close(target: string, signal?: AbortSignal): Promise<AgentListEntry> {
    throwIfAborted(signal);
    const record = this.registry.resolve(target);
    if (record.status === "closed") return listEntry(record);
    if (this.closingPaths.has(record.agentPath)) {
      const ticket = [...record.assignments]
        .reverse()
        .map((assignment) => this.tickets.get(assignment.id))
        .find(Boolean);
      if (ticket) await ticket.done.catch(() => {});
      return listEntry(this.registry.resolve(record.agentPath));
    }

    this.closingPaths.add(record.agentPath);
    try {
      const latest = this.registry.resolve(record.agentPath);
      for (const assignment of latest.assignments.filter((candidate) => candidate.phase === "queued")) {
        this.tickets.get(assignment.id)?.detachRequestSignal();
        this.scheduler.cancel(assignment.id);
        this.registry.settleQueuedAssignment(record.agentPath, assignment.id, "interrupted");
        this.notifySettlement();
      }
      const active = this.registry
        .resolve(record.agentPath)
        .assignments.find((assignment) => assignment.phase === "starting" || assignment.phase === "running");
      const process = this.processes.get(record.agentPath);
      if (active) {
        this.interruptRequested.add(active.id);
        await process
          ?.interrupt()
          .then(() => this.interruptAcknowledged.add(active.id))
          .catch(() => this.interruptRequested.delete(active.id));
      }
      await process?.close();
      if (active) await this.tickets.get(active.id)?.done.catch(() => {});
      this.processes.delete(record.agentPath);
      if (this.scheduler.isResident(record.agentPath)) this.scheduler.releaseResident(record.agentPath);
      const current = this.registry.resolve(record.agentPath);
      if (current.status !== "closed") this.registry.transition(record.agentPath, "closed");
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "closed",
        agentPath: record.agentPath,
        agentId: record.agentId,
      });
      return listEntry(this.registry.resolve(record.agentPath));
    } finally {
      this.closingPaths.delete(record.agentPath);
    }
  }

  async restore(requests: readonly RestoreAgentRequest[], signal?: AbortSignal): Promise<void> {
    this.requireOpen();
    for (const request of requests) {
      throwIfAborted(signal);
      const { parentPath, taskName, depth } = splitAgentPath(request.agentPath);
      this.registry.register({
        agentPath: request.agentPath,
        agentId: request.agentId,
        parentPath,
        taskName,
        agentType: request.agentType,
        depth,
        status: request.status ?? "unloaded",
        execution: request.execution,
        sessionFile: request.sessionFile,
        assignmentGeneration: request.assignmentGeneration,
      });
      for (const mailId of request.queuedMailIds) {
        const reference = artifactReferenceFromMailId(mailId);
        if (!reference) {
          throw new SupervisorError("mail_recovery_unavailable", `Invalid durable mail id for ${request.agentPath}`);
        }
        const artifact = await this.runtime.artifacts.read(reference);
        const mail = artifact.ok ? decodeDurableMail(artifact.content) : undefined;
        if (!mail) {
          throw new SupervisorError(
            "mail_recovery_unavailable",
            `Durable mail is unavailable for ${request.agentPath}`,
          );
        }
        this.mailbox.queue(mail.senderPath, request.agentPath, mail.content, mailId);
      }
    }
  }

  async shutdown(signal?: AbortSignal): Promise<void> {
    if (this.stopping) {
      await abortable(this.journalTail, signal);
      return;
    }
    this.stopping = true;
    this.notifySettlement();
    const cleanup = (async () => {
      for (const record of this.registry.list()) {
        if (record.status === "closed") continue;
        for (const assignment of record.assignments.filter((candidate) => candidate.phase === "queued")) {
          this.scheduler.cancel(assignment.id);
          this.registry.settleQueuedAssignment(record.agentPath, assignment.id, "interrupted");
        }
        const active = this.registry
          .resolve(record.agentPath)
          .assignments.find((assignment) => assignment.phase === "starting" || assignment.phase === "running");
        if (active) this.interruptRequested.add(active.id);
        const process = this.processes.get(record.agentPath);
        await process
          ?.interrupt()
          .then(() => {
            if (active) this.interruptAcknowledged.add(active.id);
          })
          .catch(() => {
            if (active) this.interruptRequested.delete(active.id);
          });
        await process?.close().catch(() => {});
        if (active) await this.tickets.get(active.id)?.done.catch(() => {});
        this.processes.delete(record.agentPath);
        if (this.scheduler.isResident(record.agentPath)) this.scheduler.releaseResident(record.agentPath);
        const current = this.registry.resolve(record.agentPath);
        if (current.status !== "closed" && current.status !== "unloaded") {
          this.registry.transition(record.agentPath, "unloaded");
          await this.persist({
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "unloaded",
            agentPath: record.agentPath,
            agentId: record.agentId,
          });
        }
      }
      await this.scheduler.shutdown();
      await this.journalTail;
    })();
    await abortable(cleanup, signal);
  }

  private scheduleAssignment(
    record: AgentRecord,
    assignment: AssignmentRecord,
    message: string,
    execution: ResolvedAgentExecution,
    session: SupervisorProcessSession,
    signal?: AbortSignal,
  ): ScheduleTicket {
    const ticket = this.scheduler.schedule(
      {
        assignmentId: assignment.id,
        agentPath: record.agentPath,
        start: async (schedulerSignal) =>
          await this.startAssignment(record.agentPath, assignment, message, execution, session, schedulerSignal),
      },
      signal,
    );
    this.tickets.set(assignment.id, ticket);
    void ticket.done.finally(() => this.tickets.delete(assignment.id)).catch(() => {});
    return ticket;
  }

  private async startAssignment(
    agentPath: string,
    assignment: AssignmentRecord,
    message: string,
    execution: ResolvedAgentExecution,
    session: SupervisorProcessSession,
    signal: AbortSignal,
  ): Promise<{ settled: Promise<void> }> {
    let process = this.processes.get(agentPath);
    let created = false;
    try {
      this.registry.startAssignment(agentPath, assignment.id);
      const record = this.registry.resolve(agentPath);
      let sessionFile = record.sessionFile;
      if (!process) {
        process = this.runtime.createProcess({
          agentPath,
          agentId: record.agentId,
          agentType: record.agentType,
          execution: execution.profile,
          session,
        });
        this.processes.set(agentPath, process);
        process.onEvent((event) => {
          if (event.type !== "exit" || this.processes.get(agentPath) !== process) return;
          this.processes.delete(agentPath);
          if (this.scheduler.isResident(agentPath)) this.scheduler.releaseResident(agentPath);
        });
        created = true;
        const state = await process.startup({ signal });
        sessionFile = requireStateSession(state);
        if (assignment.kind === "spawn") {
          await this.persist({
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "spawned",
            agentPath,
            agentId: record.agentId,
            agentType: record.agentType,
            sessionFile,
            execution: copyExecution(execution),
          });
        }
      }
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "started",
        agentPath,
        agentId: record.agentId,
        generation: assignment.generation,
      });
      const request: AgentAssignmentRequest = {
        message,
        ...(assignment.kind === "followup" ? { execution: execution.profile } : {}),
        signal,
      };
      const submission = assignment.kind === "spawn" ? await process.submit(request) : await process.followup(request);
      this.registry.markRunning(
        agentPath,
        assignment.id,
        sessionFile ?? requireSessionFile(this.registry.resolve(agentPath)),
      );
      if (!sameExecution(record.execution, execution)) {
        this.registry.updateExecution(agentPath, execution);
        await this.persist({
          version: SUBAGENT_RUNTIME_ENTRY_VERSION,
          event: "execution_changed",
          agentPath,
          agentId: record.agentId,
          execution: copyExecution(execution),
        });
      }
      const finalization = this.finalizeAssignment(agentPath, assignment.id, submission.settlement).finally(() =>
        this.notifySettlement(),
      );
      void this.deliverMail(agentPath, process, signal).catch(() => {});
      return { settled: finalization };
    } catch (error) {
      if (created) {
        await process?.close().catch(() => {});
        this.processes.delete(agentPath);
      }
      await this.failStartingAssignment(agentPath, assignment.id, "start_failed");
      throw error;
    }
  }

  private async finalizeAssignment(
    agentPath: string,
    assignmentId: string,
    settlement: Promise<AgentSettlement>,
  ): Promise<void> {
    const record = this.registry.resolve(agentPath);
    let result: AgentSettlement;
    try {
      result = await settlement;
    } catch {
      const interrupted = this.interruptAcknowledged.delete(assignmentId);
      this.interruptRequested.delete(assignmentId);
      if (interrupted) {
        await this.finalizeRejectedInterrupt(record, assignmentId);
      } else {
        await this.finalizeFailure(record, assignmentId, "runtime_failure", true);
      }
      return;
    }

    const generation = this.registry.assignmentById(agentPath, assignmentId).generation;
    const output = this.redact(result.output ?? "");
    const interrupted = this.interruptAcknowledged.delete(assignmentId);
    this.interruptRequested.delete(assignmentId);
    let artifact: { reference: string };
    try {
      artifact = await this.runtime.artifacts.write({
        agentPath,
        agentId: record.agentId,
        kind: interrupted ? "handoff" : "completion",
        content: output,
      });
    } catch (error) {
      const errorKind = error instanceof ArtifactTooLargeError ? "artifact_too_large" : "artifact_write_failed";
      const unavailableNotice = `\n\n[Durable artifact unavailable: ${errorKind}]`;
      const preview = prepareCompletionPreview(`${output}${unavailableNotice}`).text;
      await this.finalizeFailure(record, assignmentId, errorKind, false, preview);
      return;
    }

    const preview = prepareCompletionPreview(output, artifact.reference).text;
    const outcome: AssignmentOutcome = interrupted ? "interrupted" : "completed";
    const settled = this.registry.settleAssignment(agentPath, assignmentId, {
      outcome,
      artifactReference: artifact.reference,
      outputPreview: preview,
    });
    if (!settled.applied) return;
    await this.persist(
      interrupted
        ? {
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "interrupted",
            agentPath,
            agentId: record.agentId,
            generation,
          }
        : {
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "completed",
            agentPath,
            agentId: record.agentId,
            generation,
            artifactReference: artifact.reference,
          },
    );
    await this.notifyCompletion(record, settled.assignment);
  }

  private async finalizeRejectedInterrupt(record: AgentRecord, assignmentId: string): Promise<void> {
    const assignment = this.registry.assignmentById(record.agentPath, assignmentId);
    let artifact: { reference: string } | undefined;
    try {
      artifact = await this.runtime.artifacts.write({
        agentPath: record.agentPath,
        agentId: record.agentId,
        kind: "handoff",
        content: "",
      });
    } catch {
      artifact = undefined;
    }
    const settled = this.registry.settleAssignment(record.agentPath, assignmentId, {
      outcome: "interrupted",
      ...(artifact ? { artifactReference: artifact.reference } : {}),
    });
    if (!settled.applied) return;
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "interrupted",
      agentPath: record.agentPath,
      agentId: record.agentId,
      generation: assignment.generation,
    });
    await this.notifyCompletion(record, settled.assignment);
  }

  private async finalizeFailure(
    record: AgentRecord,
    assignmentId: string,
    errorKind: "runtime_failure" | "artifact_write_failed" | "artifact_too_large",
    writeArtifact: boolean,
    outputPreview?: string,
  ): Promise<void> {
    const generation = this.registry.assignmentById(record.agentPath, assignmentId).generation;
    const artifact = writeArtifact ? await this.writeFailureArtifact(record, errorKind) : undefined;
    const effectiveKind = writeArtifact && !artifact ? "artifact_write_failed" : errorKind;
    const fallbackPreview =
      outputPreview ??
      (!artifact ? `[Agent assignment failed: ${effectiveKind}. Durable failure artifact unavailable.]` : undefined);
    const settled = this.registry.settleAssignment(record.agentPath, assignmentId, {
      outcome: "failed",
      errorKind: effectiveKind,
      ...(artifact ? { artifactReference: artifact.reference } : {}),
      ...(fallbackPreview ? { outputPreview: fallbackPreview } : {}),
    });
    if (!settled.applied) return;
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "failed",
      agentPath: record.agentPath,
      agentId: record.agentId,
      generation,
      errorKind: effectiveKind,
      ...(artifact ? { artifactReference: artifact.reference } : {}),
    });
    await this.notifyCompletion(record, settled.assignment);
  }

  private async failStartingAssignment(agentPath: string, assignmentId: string, errorKind: string): Promise<void> {
    const record = this.registry.resolve(agentPath);
    const assignment = this.registry.assignmentById(agentPath, assignmentId);
    if (assignment.phase === "queued")
      this.registry.settleQueuedAssignment(agentPath, assignmentId, "failed", errorKind);
    else {
      this.registry.settleAssignment(agentPath, assignmentId, { outcome: "failed", errorKind });
    }
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "failed",
      agentPath,
      agentId: record.agentId,
      generation: assignment.generation,
      errorKind,
    });
    this.notifySettlement();
  }

  private async notifyCompletion(
    record: AgentRecord,
    assignment: AssignmentRecord,
  ): Promise<CompletionNotificationDelivery> {
    const existing = this.completionNotifications.get(assignment.id);
    if (existing) return await existing;
    if (!assignment.outcome) {
      throw new Error(`Settled completion notification lacks an outcome: ${assignment.id}`);
    }

    const notification: FinalAnswerNotification = {
      messageType: FINAL_ANSWER_MESSAGE_TYPE,
      agentPath: record.agentPath,
      agentId: record.agentId,
      parentPath: record.parentPath,
      assignmentId: assignment.id,
      generation: assignment.generation,
      status: assignment.outcome,
      ...(assignment.artifactReference ? { artifactReference: assignment.artifactReference } : {}),
      ...(assignment.outputPreview ? { outputPreview: assignment.outputPreview } : {}),
      execution: copyExecution(record.execution),
    };
    const delivery = Promise.resolve()
      .then(async () => await this.deliverCompletion(notification))
      .catch(() => notificationFailure("parent_mailbox_failed", notification.parentPath, true, notification))
      .then((result) => {
        this.completionNotificationResults.set(assignment.id, result);
        return result;
      });
    this.completionNotifications.set(assignment.id, delivery);
    return await delivery;
  }

  private async deliverCompletion(notification: FinalAnswerNotification): Promise<CompletionNotificationDelivery> {
    if (notification.parentPath === "/root") {
      try {
        if (!this.runtime.deliverRootCompletion) throw new Error("Root completion delivery is unavailable");
        await this.runtime.deliverRootCompletion(copyFinalAnswerNotification(notification));
        return { status: "delivered", delivery: "root" };
      } catch {
        return notificationFailure("root_callback_failed", "/root", true, notification);
      }
    }
    if (this.stopping) return notificationFailure("shutting_down", notification.parentPath, true, notification);

    let parent: AgentRecord;
    try {
      parent = this.registry.resolve(notification.parentPath);
    } catch {
      return notificationFailure("parent_unavailable", notification.parentPath, false, notification);
    }
    if (parent.status === "closed" || this.closingPaths.has(parent.agentPath)) {
      return notificationFailure("parent_unavailable", parent.agentPath, false, notification);
    }

    const message = formatFinalAnswerMailMessage(notification);
    const process = this.processes.get(parent.agentPath);
    if (parent.status === "running" && process) {
      try {
        await process.send(message);
        return { status: "delivered", delivery: "steered" };
      } catch {
        // A failed steer is not acknowledged; preserve the notification durably below.
      }
    }
    if (this.stopping) return notificationFailure("shutting_down", parent.agentPath, true, notification);

    let reservation: ReturnType<AgentMailbox["reserve"]>;
    try {
      reservation = this.mailbox.reserve(notification.agentPath, parent.agentPath, message);
    } catch {
      return notificationFailure("parent_mailbox_failed", parent.agentPath, true, notification);
    }
    try {
      const artifact = await this.runtime.artifacts.write({
        agentPath: parent.agentPath,
        agentId: parent.agentId,
        kind: "handoff",
        content: encodeDurableMail(notification.agentPath, message),
      });
      const currentParent = this.registry.resolve(parent.agentPath);
      if (currentParent.status === "closed" || this.closingPaths.has(parent.agentPath) || this.stopping) {
        this.mailbox.release(reservation);
        return notificationFailure(
          this.stopping ? "shutting_down" : "parent_unavailable",
          parent.agentPath,
          this.stopping,
          notification,
        );
      }
      const mail = this.mailbox.commit(reservation, durableMailId(artifact.reference));
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "mail_queued",
        agentPath: parent.agentPath,
        agentId: parent.agentId,
        mailId: mail.id,
      });
      return { status: "delivered", delivery: "queued", mailId: mail.id };
    } catch {
      this.mailbox.release(reservation);
      return notificationFailure("parent_mailbox_failed", parent.agentPath, true, notification);
    }
  }

  private async deliverMail(agentPath: string, process: SupervisorAgentProcess, signal: AbortSignal): Promise<void> {
    const record = this.registry.resolve(agentPath);
    const delivered = await this.mailbox.deliver(
      agentPath,
      async (message: MailMessage, deliverySignal?: AbortSignal) => process.send(message.content, deliverySignal),
      signal,
    );
    for (const message of delivered) {
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "mail_delivered",
        agentPath,
        agentId: record.agentId,
        mailId: message.id,
      });
    }
  }

  private async operationResult(
    agentPath: string,
    assignmentId: string,
    ticket: ScheduleTicket,
  ): Promise<AgentOperationResult> {
    if (ticket.queued) {
      ticket.detachRequestSignal();
      const record = this.registry.resolve(agentPath);
      return {
        agentPath,
        agentId: record.agentId,
        assignmentId,
        status: "queued",
        execution: record.execution,
      };
    }
    try {
      await ticket.accepted;
      const record = this.registry.resolve(agentPath);
      return {
        agentPath,
        agentId: record.agentId,
        assignmentId,
        status: "running",
        execution: record.execution,
      };
    } finally {
      ticket.detachRequestSignal();
    }
  }

  private inspectWait(
    targets: readonly { agentPath: string; agentId: string; assignmentId: string }[],
    condition: "all" | "any",
    timedOut: boolean,
  ): WaitAgentResult {
    const completed: WaitSettlement[] = [];
    const pending: { agentPath: string; agentId: string; assignmentId: string }[] = [];
    for (const target of targets) {
      const assignment = this.registry.assignmentById(target.agentPath, target.assignmentId);
      if (assignment.phase === "settled" && assignment.outcome) {
        completed.push({
          ...target,
          outcome: assignment.outcome,
          ...(assignment.artifactReference ? { artifactReference: assignment.artifactReference } : {}),
          ...(assignment.outputPreview ? { outputPreview: assignment.outputPreview } : {}),
          ...(assignment.errorKind ? { errorKind: assignment.errorKind } : {}),
          ...(this.completionNotificationResults.has(assignment.id)
            ? { notification: this.completionNotificationResults.get(assignment.id) }
            : {}),
        });
      } else pending.push({ ...target });
    }
    return { condition, timedOut, completed, pending };
  }

  private waitForSettlement(timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let settled = false;
      const finish = (value: boolean, error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.settlementListeners.delete(onSettlement);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const onSettlement = () => finish(true);
      const onAbort = () => finish(false, signal?.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => finish(false), timeoutMs);
      timer.unref();
      this.settlementListeners.add(onSettlement);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (this.stopping) finish(false, new SupervisorError("shutting_down", "Supervisor is shutting down"));
    });
  }

  private notifySettlement(): void {
    for (const listener of [...this.settlementListeners]) listener();
  }

  private childPath(parentPath: string, taskName: string): { path: string; depth: number } {
    if (!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(parentPath) || !parentPath.startsWith("/root")) {
      throw new SupervisorError("invalid_path", `Invalid canonical parent path: ${parentPath}`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskName)) {
      throw new SupervisorError("invalid_task_name", `Invalid task name: ${taskName}`);
    }
    if (parentPath !== "/root") {
      const parent = this.registry.resolve(parentPath);
      this.requireNotClosing(parent);
    }
    return { path: `${parentPath}/${taskName}`, depth: parentPath.split("/").length - 1 };
  }

  private requireOpen(): void {
    if (this.stopping) throw new SupervisorError("shutting_down", "Supervisor is shutting down");
  }

  private requireNotClosing(record: AgentRecord): void {
    if (record.status === "closed" || this.closingPaths.has(record.agentPath)) {
      throw new SupervisorError("closed", `Agent is closed: ${record.agentPath}`);
    }
  }

  private persist(entry: SubagentRuntimeEntry): Promise<void> {
    const sanitized = redactStringValues(entry, this.redact);
    const write = this.journalTail.then(() => this.runtime.journal.append(sanitized));
    this.journalTail = write.then(() => undefined);
    return write;
  }

  private async writeFailureArtifact(
    record: AgentRecord,
    errorKind: string,
  ): Promise<{ reference: string } | undefined> {
    try {
      return await this.runtime.artifacts.write({
        agentPath: record.agentPath,
        agentId: record.agentId,
        kind: "failure",
        content: `Agent assignment failed (${errorKind}).`,
      });
    } catch {
      return undefined;
    }
  }
}

export function createAgentSupervisor(runtime: SupervisorRuntime, options?: SupervisorOptions): AgentSupervisor {
  return new PersistentAgentSupervisor(runtime, options);
}

function listEntry(record: AgentRecord): AgentListEntry {
  const assignment =
    [...record.assignments].reverse().find((candidate) => candidate.phase !== "settled") ?? record.assignments.at(-1);
  return {
    agentPath: record.agentPath,
    agentId: record.agentId,
    agentType: record.agentType,
    status: record.status,
    ...(assignment
      ? { assignment: { id: assignment.id, generation: assignment.generation, phase: assignment.phase } }
      : {}),
    execution: record.execution,
  };
}

function waitSatisfied(result: WaitAgentResult, condition: "all" | "any"): boolean {
  return condition === "all" ? result.pending.length === 0 : result.completed.length > 0;
}

function requireMessage(value: string, label: string): void {
  if (!value.trim()) throw new SupervisorError("invalid_message", `${label} must not be empty`);
}

function exactId(value: string, label: string): string {
  if (!value.trim() || value !== value.trim()) throw new Error(`${label} id must be non-empty and exact`);
  return value;
}

function requireSessionFile(record: AgentRecord): string {
  if (!record.sessionFile) {
    throw new SupervisorError("process_unavailable", `Agent has no recoverable session: ${record.agentPath}`);
  }
  return record.sessionFile;
}

function requireStateSession(state: AgentProcessState): string {
  if (!state.sessionFile)
    throw new SupervisorError("process_unavailable", "Child process did not report a session file");
  return state.sessionFile;
}

function durableMailId(artifactReference: string): string {
  return `mail:${artifactReference}`;
}

function artifactReferenceFromMailId(mailId: string): string | undefined {
  return mailId.startsWith("mail:subagent-artifact:") ? mailId.slice("mail:".length) : undefined;
}

function encodeDurableMail(senderPath: string, content: string): string {
  return JSON.stringify({ version: 1, senderPath, content });
}

function decodeDurableMail(value: string): { senderPath: string; content: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  return record.version === 1 &&
    typeof record.senderPath === "string" &&
    record.senderPath.trim() === record.senderPath &&
    record.senderPath.length > 0 &&
    typeof record.content === "string" &&
    record.content.trim().length > 0
    ? { senderPath: record.senderPath, content: record.content }
    : undefined;
}

function copyExecution(execution: ResolvedAgentExecution): ResolvedAgentExecution {
  return { profile: { ...execution.profile }, source: { ...execution.source } };
}

function copyFinalAnswerNotification(notification: FinalAnswerNotification): FinalAnswerNotification {
  return { ...notification, execution: copyExecution(notification.execution) };
}

function notificationFailure(
  kind: Extract<CompletionNotificationDelivery, { status: "failed" }>["failure"]["kind"],
  targetPath: string,
  retryable: boolean,
  notification: FinalAnswerNotification,
): CompletionNotificationDelivery {
  return {
    status: "failed",
    failure: {
      kind,
      targetPath,
      retryable,
      notification: copyFinalAnswerNotification(notification),
    },
  };
}

function sameExecution(left: ResolvedAgentExecution, right: ResolvedAgentExecution): boolean {
  return (
    left.profile.provider === right.profile.provider &&
    left.profile.model === right.profile.model &&
    left.profile.effort === right.profile.effort &&
    left.source.model === right.source.model &&
    left.source.effort === right.source.effort
  );
}

function splitAgentPath(agentPath: string): { parentPath: string; taskName: string; depth: number } {
  if (!/^\/root\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(agentPath)) {
    throw new SupervisorError("invalid_path", `Invalid canonical agent path: ${agentPath}`);
  }
  const parts = agentPath.split("/");
  const taskName = parts.at(-1);
  if (!taskName) throw new SupervisorError("invalid_path", `Invalid canonical agent path: ${agentPath}`);
  return { parentPath: parts.slice(0, -1).join("/"), taskName, depth: parts.length - 2 };
}

function validateLimits(limits: SupervisorLimits): void {
  assertConfigurableLimit("activeAgents", limits.maxActiveAgents);
  assertConfigurableLimit("residentAgents", limits.maxResidentAgents);
  assertConfigurableLimit("depth", limits.maxDepth);
  if (limits.maxActiveAgents > limits.maxResidentAgents) {
    throw new RangeError("maxActiveAgents must not exceed maxResidentAgents");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return await promise;
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const listener = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", listener, { once: true });
      void promise.finally(() => signal.removeEventListener("abort", listener));
    }),
  ]);
}

export function registryErrorKind(error: unknown): RegistryError["kind"] | undefined {
  return error instanceof RegistryError ? error.kind : undefined;
}
