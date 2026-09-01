import { type ArtifactKind, ArtifactTooLargeError } from "../artifacts/artifacts";
import { prepareCompletionPreview } from "../artifacts/output";
import type { ResolvedAgentExecution } from "../execution/profile";
import {
  RpcClientClosedError,
  RpcProtocolViolationError,
  RpcRequestError,
  RpcRequestTimeoutError,
} from "../rpc/client";
import type { AgentExecutionSettings } from "../runner/invocation";
import {
  type AgentAssignmentRequest,
  AgentProcessError,
  type AgentProcessEvent,
  type AgentProcessEventListener,
  type AgentProcessState,
  type AgentSettlement,
  type AgentSubmission,
} from "../runner/process";
import { type RedactText, redactStringValues } from "../security/redaction";
import {
  type RuntimeNotificationState,
  SUBAGENT_RUNTIME_ENTRY_VERSION,
  type SubagentRuntimeEntry,
} from "../sessions/entries";
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
import {
  AgentScheduler,
  type ResidentEvictionOutcome,
  type ResidentEvictionReservation,
  type SchedulerLimits,
  type ScheduleTicket,
} from "./scheduler";
import { isResumableStatus } from "./status";

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

interface AgentActivityDetails {
  startedAt: number;
  agentType: string;
  execution: ResolvedAgentExecution;
  queuedCount?: number;
}

export type AgentActivity = AgentActivityDetails &
  (
    | { state: "queued" | "starting" | "working" | "compacting" | "retrying" | "finalizing" }
    | { state: "tool"; toolName: string }
    | { state: AssignmentOutcome; finishedAt: number }
  );

export interface SupervisorRuntime {
  createAgentId(): string;
  createMailId(): string;
  createProcess(request: CreateSupervisorProcessRequest): SupervisorAgentProcess;
  reportAgentActivity?(agentPath: string, activity: AgentActivity | undefined): void;
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
  assignments?: readonly {
    generation: number;
    kind: AssignmentRecord["kind"];
    phase: AssignmentRecord["phase"];
    outcome?: AssignmentOutcome;
    artifactReference?: string;
    errorKind?: string;
    notification?: RuntimeNotificationState;
  }[];
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
  clearSettledActivities(): void;
  restore(requests: readonly RestoreAgentRequest[], signal?: AbortSignal): Promise<void>;
  shutdown(signal?: AbortSignal): Promise<void>;
}

export class PersistentAgentSupervisor implements AgentSupervisor {
  private readonly registry = new AgentRegistry();
  private readonly scheduler: AgentScheduler;
  private readonly mailbox: AgentMailbox;
  private readonly processes = new Map<string, SupervisorAgentProcess>();
  private readonly activities = new Map<string, AgentActivity>();
  private readonly queuedActivities = new Map<string, { agentPath: string; activity: AgentActivity }>();
  private readonly activeToolCalls = new Map<string, Map<string, string>>();
  private readonly residentRecency = new Map<string, number>();
  private readonly unloading = new Map<string, Promise<ResidentEvictionOutcome>>();
  private readonly tickets = new Map<string, ScheduleTicket>();
  private readonly interruptRequested = new Set<string>();
  private readonly interruptAcknowledged = new Set<string>();
  private readonly closingOperations = new Map<string, Promise<AgentListEntry>>();
  private readonly settlementListeners = new Set<() => void>();
  private readonly completionNotifications = new Map<string, Promise<CompletionNotificationDelivery>>();
  private readonly completionNotificationResults = new Map<string, CompletionNotificationDelivery>();
  private journalTail: Promise<void> = Promise.resolve();
  private readonly redact: RedactText;
  private residentUseSequence = 0;
  private stopping = false;
  private shutdownOperation: Promise<void> | undefined;

  constructor(
    private readonly runtime: SupervisorRuntime,
    private readonly options: SupervisorOptions = { limits: DEFAULT_SUPERVISOR_LIMITS },
  ) {
    validateLimits(options.limits);
    this.redact = options.redact ?? ((value) => value);
    this.scheduler = new AgentScheduler(options.limits, {
      reserveIdleResident: (incomingAgentPath) => this.reserveIdleResident(incomingAgentPath),
    });
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
    let record = this.registry.resolve(request.target);
    this.requireNotClosing(record);
    const unloading = this.unloading.get(record.agentPath);
    if (unloading) {
      const outcome = await abortable(unloading, request.signal);
      if (outcome.error !== undefined) throw outcome.error;
      this.requireOpen();
      record = this.registry.resolve(record.agentPath);
      this.requireNotClosing(record);
    }
    const execution = request.execution ?? record.execution;
    const assignment = this.registry.queueAssignment(record.agentPath, "followup");
    try {
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "assignment_queued",
        agentPath: record.agentPath,
        agentId: record.agentId,
        generation: assignment.generation,
        assignmentKind: assignment.kind,
      });
    } catch (error) {
      this.registry.settleQueuedAssignment(record.agentPath, assignment.id, "failed", "journal_write_failed");
      throw error;
    }
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
    if (firstRequest) {
      if (process) {
        try {
          await process.interrupt();
          this.interruptAcknowledged.add(active.id);
        } catch (error) {
          this.interruptRequested.delete(active.id);
          this.interruptAcknowledged.delete(active.id);
          throw error;
        }
      } else {
        this.interruptAcknowledged.add(active.id);
        this.scheduler.cancel(active.id);
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
    const existing = this.closingOperations.get(record.agentPath);
    if (existing) return await abortable(existing, signal);

    const operation = this.closeAgent(record.agentPath, signal);
    this.closingOperations.set(record.agentPath, operation);
    void operation
      .finally(() => {
        if (this.closingOperations.get(record.agentPath) === operation) {
          this.closingOperations.delete(record.agentPath);
        }
      })
      .catch(() => {});
    return await operation;
  }

  private async closeAgent(agentPath: string, signal?: AbortSignal): Promise<AgentListEntry> {
    const record = this.registry.resolve(agentPath);
    const unloading = this.unloading.get(agentPath);
    if (unloading) {
      const outcome = await abortable(unloading, signal);
      if (outcome.error !== undefined) throw outcome.error;
    }
    const latest = this.registry.resolve(agentPath);
    for (const assignment of latest.assignments.filter((candidate) => candidate.phase === "queued")) {
      this.tickets.get(assignment.id)?.detachRequestSignal();
      this.scheduler.cancel(assignment.id);
      this.queuedActivities.delete(assignment.id);
      this.registry.settleQueuedAssignment(agentPath, assignment.id, "interrupted");
      this.endQueuedAgentActivity(agentPath);
      this.notifySettlement();
    }
    const active = this.registry
      .resolve(agentPath)
      .assignments.find((assignment) => assignment.phase === "starting" || assignment.phase === "running");
    const process = this.processes.get(agentPath);
    if (active) {
      this.interruptRequested.add(active.id);
      if (process) {
        await process
          .interrupt()
          .then(() => this.interruptAcknowledged.add(active.id))
          .catch(() => this.interruptRequested.delete(active.id));
      } else {
        this.interruptAcknowledged.add(active.id);
        this.scheduler.cancel(active.id);
      }
    }
    await process?.close();
    if (active) await this.tickets.get(active.id)?.done.catch(() => {});
    this.processes.delete(agentPath);
    this.residentRecency.delete(agentPath);
    if (this.scheduler.isResident(agentPath)) this.scheduler.releaseResident(agentPath);
    const current = this.registry.resolve(agentPath);
    if (current.status !== "closed") this.registry.transition(agentPath, "closed");
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "closed",
      agentPath,
      agentId: record.agentId,
    });
    this.removeAgentActivity(agentPath);
    return listEntry(this.registry.resolve(agentPath));
  }

  clearSettledActivities(): void {
    for (const [agentPath, activity] of this.activities) {
      if (isSettledAgentActivity(activity)) this.removeAgentActivity(agentPath);
    }
  }

  async restore(requests: readonly RestoreAgentRequest[], signal?: AbortSignal): Promise<void> {
    this.requireOpen();
    for (const request of requests) {
      throwIfAborted(signal);
      const { parentPath, taskName, depth } = splitAgentPath(request.agentPath);
      const recoveredAssignments = request.assignments ?? [];
      const unresolved = recoveredAssignments.filter((assignment) => assignment.phase !== "settled");
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
        assignments: recoveredAssignments.map((assignment) => ({
          generation: assignment.generation,
          kind: assignment.kind,
          outcome: assignment.outcome ?? "failed",
          ...(assignment.artifactReference ? { artifactReference: assignment.artifactReference } : {}),
          ...(assignment.errorKind
            ? { errorKind: assignment.errorKind }
            : assignment.phase !== "settled"
              ? { errorKind: "recovery_prompt_unavailable" }
              : {}),
        })),
      });
      const restoredRecord = this.registry.resolve(request.agentPath);
      for (const assignment of unresolved) {
        await this.persist({
          version: SUBAGENT_RUNTIME_ENTRY_VERSION,
          event: "failed",
          agentPath: request.agentPath,
          agentId: request.agentId,
          generation: assignment.generation,
          errorKind: "recovery_prompt_unavailable",
        });
      }
      for (const recovered of recoveredAssignments) {
        if (recovered.phase !== "settled" || !recovered.notification) continue;
        const assignment = this.registry.assignmentById(
          request.agentPath,
          `${request.agentId}:${recovered.generation}`,
        );
        if (recovered.notification.status === "delivered") {
          this.completionNotificationResults.set(assignment.id, { ...recovered.notification });
        } else if (recovered.notification.status === "failed" && !recovered.notification.failure.retryable) {
          this.completionNotificationResults.set(assignment.id, {
            status: "failed",
            failure: {
              ...recovered.notification.failure,
              notification: finalAnswerNotification(restoredRecord, assignment),
            },
          });
        } else {
          await this.notifyCompletion(restoredRecord, assignment);
        }
      }
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
    if (this.shutdownOperation) {
      await abortable(this.shutdownOperation, signal);
      return;
    }
    this.stopping = true;
    this.notifySettlement();
    const cleanup = (async () => {
      const failures: unknown[] = [];
      for (const record of this.registry.list()) {
        if (record.status === "closed") continue;
        for (const assignment of record.assignments.filter((candidate) => candidate.phase === "queued")) {
          this.scheduler.cancel(assignment.id);
          this.queuedActivities.delete(assignment.id);
          this.registry.settleQueuedAssignment(record.agentPath, assignment.id, "interrupted");
          this.endQueuedAgentActivity(record.agentPath);
        }
        const active = this.registry
          .resolve(record.agentPath)
          .assignments.find((assignment) => assignment.phase === "starting" || assignment.phase === "running");
        if (active) this.interruptRequested.add(active.id);
        const process = this.processes.get(record.agentPath);
        if (process) {
          await process
            .interrupt()
            .then(() => {
              if (active) this.interruptAcknowledged.add(active.id);
            })
            .catch(() => {
              if (active) this.interruptRequested.delete(active.id);
            });
        } else if (active) {
          this.interruptAcknowledged.add(active.id);
          this.scheduler.cancel(active.id);
        }
        await process?.close().catch(() => {});
        if (active) await this.tickets.get(active.id)?.done.catch(() => {});
        this.processes.delete(record.agentPath);
        this.residentRecency.delete(record.agentPath);
        if (this.scheduler.isResident(record.agentPath)) this.scheduler.releaseResident(record.agentPath);
        const current = this.registry.resolve(record.agentPath);
        if (current.status !== "closed" && current.status !== "unloaded") {
          this.registry.transition(record.agentPath, "unloaded");
          await this.persist({
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "unloaded",
            agentPath: record.agentPath,
            agentId: record.agentId,
          }).catch((error) => failures.push(error));
        }
      }
      await this.scheduler.shutdown().catch((error) => failures.push(error));
      await this.journalTail.catch((error) => failures.push(error));
      if (failures.length > 0) throw new AggregateError(failures, "Subagent supervisor cleanup failed");
    })();
    this.shutdownOperation = cleanup;
    await abortable(cleanup, signal);
  }

  private reserveIdleResident(incomingAgentPath: string): ResidentEvictionReservation | undefined {
    if (this.stopping) return undefined;
    const candidate = [...this.processes.entries()]
      .filter(([agentPath]) => {
        if (
          agentPath === incomingAgentPath ||
          this.scheduler.isActive(agentPath) ||
          !this.scheduler.isResident(agentPath) ||
          this.closingOperations.has(agentPath) ||
          this.unloading.has(agentPath)
        )
          return false;
        const record = this.registry.resolve(agentPath);
        return (
          isResumableStatus(record.status) &&
          record.status !== "unloaded" &&
          record.assignments.every((assignment) => assignment.phase === "settled")
        );
      })
      .sort(
        ([leftPath], [rightPath]) =>
          (this.residentRecency.get(leftPath) ?? 0) - (this.residentRecency.get(rightPath) ?? 0) ||
          leftPath.localeCompare(rightPath),
      )[0];
    if (!candidate) return undefined;

    const [agentPath, process] = candidate;
    const settled = Promise.resolve().then(async (): Promise<ResidentEvictionOutcome> => {
      try {
        await process.close();
      } catch (error) {
        return { released: false, error: error ?? new Error(`Failed to unload resident ${agentPath}`) };
      }
      if (this.processes.get(agentPath) === process) this.processes.delete(agentPath);
      this.residentRecency.delete(agentPath);
      const record = this.registry.resolve(agentPath);
      if (record.status === "unloaded" || record.status === "closed") return { released: true };
      this.registry.transition(agentPath, "unloaded");
      try {
        await this.persist({
          version: SUBAGENT_RUNTIME_ENTRY_VERSION,
          event: "unloaded",
          agentPath,
          agentId: record.agentId,
        });
        return { released: true };
      } catch (error) {
        return { released: true, error: error ?? new Error(`Failed to persist unloaded resident ${agentPath}`) };
      }
    });
    this.unloading.set(agentPath, settled);
    void settled
      .finally(() => {
        if (this.unloading.get(agentPath) === settled) this.unloading.delete(agentPath);
      })
      .catch(() => {});
    return { agentPath, settled };
  }

  private markResidentIdle(agentPath: string, sequence: number): void {
    if (!this.processes.has(agentPath)) return;
    const record = this.registry.resolve(agentPath);
    if (isResumableStatus(record.status) && record.status !== "unloaded") {
      this.residentRecency.set(agentPath, sequence);
    }
  }

  private async markUnexpectedlyExitedResidentUnloaded(agentPath: string): Promise<void> {
    if (this.stopping || this.unloading.has(agentPath) || this.processes.has(agentPath)) return;
    let record: AgentRecord;
    try {
      record = this.registry.resolve(agentPath);
    } catch {
      return;
    }
    const hasUnsettled = record.assignments.some((assignment) => assignment.phase !== "settled");
    if (hasUnsettled || !isResumableStatus(record.status) || record.status === "unloaded") return;
    this.registry.transition(agentPath, "unloaded");
    await this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "unloaded",
      agentPath,
      agentId: record.agentId,
    }).catch(() => {});
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
        start: async (schedulerSignal, residencyReady) =>
          await this.startAssignment(
            record.agentPath,
            assignment,
            message,
            execution,
            session,
            schedulerSignal,
            residencyReady,
          ),
      },
      signal,
    );
    this.tickets.set(assignment.id, ticket);
    void ticket.done.finally(() => this.tickets.delete(assignment.id)).catch(() => {});
    if (ticket.queued) this.beginQueuedAgentActivity(record, assignment, execution);
    return ticket;
  }

  private async startAssignment(
    agentPath: string,
    assignment: AssignmentRecord,
    message: string,
    execution: ResolvedAgentExecution,
    session: SupervisorProcessSession,
    signal: AbortSignal,
    residencyReady: Promise<void>,
  ): Promise<{ settled: Promise<void> }> {
    let process: SupervisorAgentProcess | undefined;
    let created = false;
    try {
      this.registry.startAssignment(agentPath, assignment.id);
      this.queuedActivities.delete(assignment.id);
      const record = this.registry.resolve(agentPath);
      this.beginAgentActivity(agentPath, record.agentType, execution);
      await abortable(residencyReady, signal);
      this.requireOpen();
      throwIfAborted(signal);
      process = this.processes.get(agentPath);
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
          this.reportRuntimeActivity(agentPath, event);
          if (event.type !== "exit" || this.processes.get(agentPath) !== process) return;
          this.processes.delete(agentPath);
          this.residentRecency.delete(agentPath);
          if (this.unloading.has(agentPath)) return;
          if (this.scheduler.isResident(agentPath)) this.scheduler.releaseResident(agentPath);
          void this.markUnexpectedlyExitedResidentUnloaded(agentPath);
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
          await this.persist({
            version: SUBAGENT_RUNTIME_ENTRY_VERSION,
            event: "assignment_queued",
            agentPath,
            agentId: record.agentId,
            generation: assignment.generation,
            assignmentKind: assignment.kind,
          });
        }
      }
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "assignment_phase_changed",
        agentPath,
        agentId: record.agentId,
        generation: assignment.generation,
        phase: "starting",
      });
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
      this.updateAgentActivity(agentPath, "working");
      await this.persist({
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "assignment_phase_changed",
        agentPath,
        agentId: record.agentId,
        generation: assignment.generation,
        phase: "running",
      });
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
      let finishedAt: number | undefined;
      let idleSequence: number | undefined;
      const observedSettlement = submission.settlement.finally(() => {
        finishedAt = Date.now();
        idleSequence = ++this.residentUseSequence;
        this.updateAgentActivity(agentPath, "finalizing");
      });
      const finalization = this.finalizeAssignment(agentPath, assignment.id, observedSettlement).finally(() => {
        const outcome = this.registry.assignmentById(agentPath, assignment.id).outcome;
        this.finishAgentActivity(agentPath, outcome, finishedAt ?? Date.now());
        this.markResidentIdle(agentPath, idleSequence ?? ++this.residentUseSequence);
        this.notifySettlement();
      });
      void this.deliverMail(agentPath, process, signal).catch(() => {});
      return { settled: finalization };
    } catch (error) {
      if (created) {
        await process?.close().catch(() => {});
        this.processes.delete(agentPath);
        this.residentRecency.delete(agentPath);
      }
      const finishedAt = Date.now();
      const interrupted = this.interruptAcknowledged.delete(assignment.id);
      this.interruptRequested.delete(assignment.id);
      try {
        if (interrupted) {
          await this.finalizeRejectedInterrupt(this.registry.resolve(agentPath), assignment.id);
        } else {
          await this.failStartingAssignment(agentPath, assignment.id, startupFailureKind(error));
        }
      } finally {
        const outcome = this.registry.assignmentById(agentPath, assignment.id).outcome;
        this.finishAgentActivity(agentPath, outcome, finishedAt);
      }
      throw error;
    }
  }

  private beginQueuedAgentActivity(
    record: AgentRecord,
    assignment: AssignmentRecord,
    execution: ResolvedAgentExecution,
  ): void {
    const activity: AgentActivity = {
      state: "queued",
      startedAt: Date.now(),
      agentType: record.agentType,
      execution: copyExecution(execution),
    };
    this.queuedActivities.set(assignment.id, { agentPath: record.agentPath, activity });
    const queuedCount = this.queuedActivityCount(record.agentPath);
    const current = this.activities.get(record.agentPath);
    if (current && !isSettledAgentActivity(current)) {
      const updated: AgentActivity = { ...current, queuedCount };
      this.activities.set(record.agentPath, updated);
      this.runtime.reportAgentActivity?.(record.agentPath, updated);
      return;
    }
    const queuedActivity: AgentActivity = {
      ...activity,
      ...(queuedCount > 1 ? { queuedCount: queuedCount - 1 } : {}),
    };
    this.activities.set(record.agentPath, queuedActivity);
    this.runtime.reportAgentActivity?.(record.agentPath, queuedActivity);
  }

  private beginAgentActivity(agentPath: string, agentType: string, execution: ResolvedAgentExecution): void {
    this.activeToolCalls.delete(agentPath);
    const queuedCount = this.queuedActivityCount(agentPath);
    const activity: AgentActivity = {
      state: "starting",
      startedAt: Date.now(),
      agentType,
      execution: copyExecution(execution),
      ...(queuedCount > 0 ? { queuedCount } : {}),
    };
    this.activities.set(agentPath, activity);
    this.runtime.reportAgentActivity?.(agentPath, activity);
  }

  private updateAgentActivity(
    agentPath: string,
    state: "starting" | "working" | "compacting" | "retrying" | "finalizing" | "tool",
    toolName?: string,
  ): void {
    const current = this.activities.get(agentPath);
    if (!current || isSettledAgentActivity(current)) return;
    const activity: AgentActivity =
      state === "tool" && toolName
        ? { ...current, state, toolName }
        : { ...current, state: state === "tool" ? "working" : state };
    this.activities.set(agentPath, activity);
    this.runtime.reportAgentActivity?.(agentPath, activity);
  }

  private endQueuedAgentActivity(agentPath: string): void {
    const current = this.activities.get(agentPath);
    if (!current) return;
    if (current.state === "queued") {
      const next = this.nextQueuedActivity(agentPath);
      if (next) {
        this.activities.set(agentPath, next);
        this.runtime.reportAgentActivity?.(agentPath, next);
      } else {
        this.removeAgentActivity(agentPath);
      }
      return;
    }
    if (isSettledAgentActivity(current)) return;
    const queuedCount = this.queuedActivityCount(agentPath);
    const updated: AgentActivity = { ...current, queuedCount: queuedCount || undefined };
    this.activities.set(agentPath, updated);
    this.runtime.reportAgentActivity?.(agentPath, updated);
  }

  private finishAgentActivity(agentPath: string, outcome: AssignmentOutcome | undefined, finishedAt: number): void {
    this.activeToolCalls.delete(agentPath);
    const current = this.activities.get(agentPath);
    if (!current) return;
    if (this.stopping || this.closingOperations.has(agentPath)) {
      this.removeAgentActivity(agentPath);
      return;
    }
    const queued = this.nextQueuedActivity(agentPath);
    if (queued) {
      this.activities.set(agentPath, queued);
      this.runtime.reportAgentActivity?.(agentPath, queued);
      return;
    }
    if (!outcome) {
      this.removeAgentActivity(agentPath);
      return;
    }
    const activity: AgentActivity = {
      state: outcome,
      startedAt: current.startedAt,
      finishedAt,
      agentType: current.agentType,
      execution: current.execution,
    };
    this.activities.set(agentPath, activity);
    this.runtime.reportAgentActivity?.(agentPath, activity);
  }

  private nextQueuedActivity(agentPath: string): AgentActivity | undefined {
    const record = this.registry.resolve(agentPath);
    const queuedAssignments = record.assignments.filter((assignment) => assignment.phase === "queued");
    for (const assignment of queuedAssignments) {
      const queued = this.queuedActivities.get(assignment.id);
      if (queued?.agentPath !== agentPath) continue;
      return {
        ...queued.activity,
        ...(queuedAssignments.length > 1 ? { queuedCount: queuedAssignments.length - 1 } : {}),
      };
    }
    return undefined;
  }

  private queuedActivityCount(agentPath: string): number {
    let count = 0;
    for (const queued of this.queuedActivities.values()) {
      if (queued.agentPath === agentPath) count += 1;
    }
    return count;
  }

  private removeAgentActivity(agentPath: string): void {
    this.activeToolCalls.delete(agentPath);
    if (!this.activities.delete(agentPath)) return;
    this.runtime.reportAgentActivity?.(agentPath, undefined);
  }

  private reportRuntimeActivity(agentPath: string, event: AgentProcessEvent): void {
    if (event.type === "exit") return;
    const current = this.activities.get(agentPath);
    if (!current || isSettledAgentActivity(current)) return;
    if (event.name === "tool_execution_start") {
      const toolName = event.payload.toolName;
      const toolCallId = event.payload.toolCallId;
      if (typeof toolName === "string" && toolName && typeof toolCallId === "string" && toolCallId) {
        const calls = this.activeToolCalls.get(agentPath) ?? new Map<string, string>();
        calls.set(toolCallId, toolName);
        this.activeToolCalls.set(agentPath, calls);
        this.updateAgentActivity(agentPath, "tool", toolName);
      }
      return;
    }
    if (event.name === "tool_execution_end") {
      const toolCallId = event.payload.toolCallId;
      const calls = this.activeToolCalls.get(agentPath);
      if (calls && typeof toolCallId === "string") calls.delete(toolCallId);
      const remaining = calls ? [...calls.values()].at(-1) : undefined;
      if (remaining) this.updateAgentActivity(agentPath, "tool", remaining);
      else this.updateAgentActivity(agentPath, "working");
      return;
    }
    if (event.name === "compaction_start") this.updateAgentActivity(agentPath, "compacting");
    else if (event.name === "compaction_end") this.updateAgentActivity(agentPath, "working");
    else if (event.name === "auto_retry_start") this.updateAgentActivity(agentPath, "retrying");
    else if (event.name === "auto_retry_end" || event.name === "agent_start") {
      this.updateAgentActivity(agentPath, "working");
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
    } catch (error) {
      const interrupted = this.interruptAcknowledged.delete(assignmentId);
      this.interruptRequested.delete(assignmentId);
      if (interrupted) {
        await this.finalizeRejectedInterrupt(record, assignmentId);
      } else {
        await this.finalizeFailure(
          record,
          assignmentId,
          runtimeFailureKind(error),
          true,
          undefined,
          errorMessage(error),
        );
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
            artifactReference: artifact.reference,
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
      ...(artifact ? { artifactReference: artifact.reference } : {}),
    });
    await this.notifyCompletion(record, settled.assignment);
  }

  private async finalizeFailure(
    record: AgentRecord,
    assignmentId: string,
    errorKind: string,
    writeArtifact: boolean,
    outputPreview?: string,
    diagnostic?: string,
  ): Promise<void> {
    const generation = this.registry.assignmentById(record.agentPath, assignmentId).generation;
    const artifact = writeArtifact ? await this.writeFailureArtifact(record, errorKind, diagnostic) : undefined;
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

    const notification = finalAnswerNotification(record, assignment);
    const delivery = this.persist({
      version: SUBAGENT_RUNTIME_ENTRY_VERSION,
      event: "notification_updated",
      agentPath: record.agentPath,
      agentId: record.agentId,
      generation: assignment.generation,
      notification: { status: "pending" },
    })
      .then(async () => await this.deliverCompletion(notification))
      .catch(() => notificationFailure("parent_mailbox_failed", notification.parentPath, true, notification))
      .then(async (result) => {
        await this.persist({
          version: SUBAGENT_RUNTIME_ENTRY_VERSION,
          event: "notification_updated",
          agentPath: record.agentPath,
          agentId: record.agentId,
          generation: assignment.generation,
          notification: runtimeNotificationState(result),
        });
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
    if (parent.status === "closed" || this.closingOperations.has(parent.agentPath)) {
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
      if (currentParent.status === "closed" || this.closingOperations.has(parent.agentPath) || this.stopping) {
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
    if (record.status === "closed" || this.closingOperations.has(record.agentPath)) {
      throw new SupervisorError("closed", `Agent is closed: ${record.agentPath}`);
    }
  }

  private persist(entry: SubagentRuntimeEntry): Promise<void> {
    const sanitized = redactStringValues(entry, this.redact);
    const write = this.journalTail.catch(() => undefined).then(() => this.runtime.journal.append(sanitized));
    this.journalTail = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  private async writeFailureArtifact(
    record: AgentRecord,
    errorKind: string,
    diagnostic?: string,
  ): Promise<{ reference: string } | undefined> {
    try {
      const detail = diagnostic ? `\n${this.redact(diagnostic).slice(0, 2_048)}` : "";
      return await this.runtime.artifacts.write({
        agentPath: record.agentPath,
        agentId: record.agentId,
        kind: "failure",
        content: `Agent assignment failed (${errorKind}).${detail}`,
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

function finalAnswerNotification(record: AgentRecord, assignment: AssignmentRecord): FinalAnswerNotification {
  if (!assignment.outcome) throw new Error(`Settled completion notification lacks an outcome: ${assignment.id}`);
  return {
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
}

function runtimeNotificationState(result: CompletionNotificationDelivery): RuntimeNotificationState {
  if (result.status === "delivered") {
    return {
      status: "delivered",
      delivery: result.delivery,
      ...(result.mailId ? { mailId: result.mailId } : {}),
    };
  }
  return {
    status: "failed",
    failure: {
      kind: result.failure.kind,
      targetPath: result.failure.targetPath,
      retryable: result.failure.retryable,
    },
  };
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
      void promise.finally(() => signal.removeEventListener("abort", listener)).catch(() => {});
    }),
  ]);
}

function isSettledAgentActivity(
  activity: AgentActivity,
): activity is AgentActivity & { state: AssignmentOutcome; finishedAt: number } {
  return activity.state === "completed" || activity.state === "failed" || activity.state === "interrupted";
}

function startupFailureKind(error: unknown): string {
  const kind = runtimeFailureKind(error);
  return kind === "runtime_failure" ? "start_failed" : kind;
}

function runtimeFailureKind(error: unknown): string {
  if (error instanceof RpcRequestTimeoutError) return "rpc_request_timeout";
  if (error instanceof RpcProtocolViolationError) return "rpc_protocol_violation";
  if (error instanceof RpcRequestError) return "rpc_request_failed";
  if (error instanceof RpcClientClosedError) return "rpc_transport_closed";
  if (error instanceof AgentProcessError) return error.kind === "process_exited" ? "child_exited" : error.kind;
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  return "runtime_failure";
}

function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

export function registryErrorKind(error: unknown): RegistryError["kind"] | undefined {
  return error instanceof RegistryError ? error.kind : undefined;
}
