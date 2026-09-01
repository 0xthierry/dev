import { type ExecutionSource, parseReasoningEffort, type ResolvedAgentExecution } from "../execution/profile";

export const SUBAGENT_RUNTIME_ENTRY_TYPE = "subagent-runtime";
export const SUBAGENT_RUNTIME_ENTRY_VERSION = 2 as const;

export type RuntimeEventName =
  | "spawned"
  | "assignment_queued"
  | "assignment_phase_changed"
  | "started"
  | "completed"
  | "interrupted"
  | "failed"
  | "notification_updated"
  | "unloaded"
  | "closed"
  | "execution_changed"
  | "mail_queued"
  | "mail_delivered";

export type RuntimeExecutionProfile = ResolvedAgentExecution;
export type RuntimeAssignmentKind = "spawn" | "followup";
export type RuntimeAssignmentPhase = "queued" | "starting" | "running" | "settled";
export type RuntimeAssignmentOutcome = "completed" | "interrupted" | "failed";

export type RuntimeNotificationState =
  | { status: "pending" }
  | { status: "delivered"; delivery: "root" | "steered" | "queued"; mailId?: string }
  | {
      status: "failed";
      failure: {
        kind: "root_callback_failed" | "parent_unavailable" | "parent_mailbox_failed" | "shutting_down";
        targetPath: string;
        retryable: boolean;
      };
    };

interface RuntimeEntryBase {
  version: typeof SUBAGENT_RUNTIME_ENTRY_VERSION;
  event: RuntimeEventName;
  agentPath: string;
  agentId: string;
}

export type SubagentRuntimeEntry =
  | (RuntimeEntryBase & {
      event: "spawned";
      agentType: string;
      sessionFile: string;
      execution: RuntimeExecutionProfile;
    })
  | (RuntimeEntryBase & { event: "assignment_queued"; generation: number; assignmentKind: RuntimeAssignmentKind })
  | (RuntimeEntryBase & {
      event: "assignment_phase_changed";
      generation: number;
      phase: "starting" | "running";
    })
  | (RuntimeEntryBase & { event: "started"; generation: number })
  | (RuntimeEntryBase & {
      event: "completed";
      generation: number;
      artifactReference: string;
    })
  | (RuntimeEntryBase & { event: "interrupted"; generation: number; artifactReference?: string })
  | (RuntimeEntryBase & { event: "failed"; generation: number; errorKind: string; artifactReference?: string })
  | (RuntimeEntryBase & { event: "notification_updated"; generation: number; notification: RuntimeNotificationState })
  | (RuntimeEntryBase & { event: "unloaded" })
  | (RuntimeEntryBase & { event: "closed" })
  | (RuntimeEntryBase & { event: "execution_changed"; execution: RuntimeExecutionProfile })
  | (RuntimeEntryBase & { event: "mail_queued" | "mail_delivered"; mailId: string });

export interface PiCustomEntry {
  type: "custom";
  customType: typeof SUBAGENT_RUNTIME_ENTRY_TYPE;
  data: SubagentRuntimeEntry;
}

const EVENTS = new Set<RuntimeEventName>([
  "spawned",
  "assignment_queued",
  "assignment_phase_changed",
  "started",
  "completed",
  "interrupted",
  "failed",
  "notification_updated",
  "unloaded",
  "closed",
  "execution_changed",
  "mail_queued",
  "mail_delivered",
]);

export function createRuntimeEntry(entry: SubagentRuntimeEntry): SubagentRuntimeEntry {
  const parsed = parseRuntimeEntry(entry);
  if (!parsed) throw new Error("Invalid subagent runtime journal entry");
  return parsed;
}

export function parseRuntimeEntry(value: unknown): SubagentRuntimeEntry | undefined {
  const data = recordValue(value);
  if (!data || data.version !== SUBAGENT_RUNTIME_ENTRY_VERSION || !EVENTS.has(data.event as RuntimeEventName)) {
    return undefined;
  }

  const base = baseFrom(data);
  if (!base) return undefined;

  switch (base.event) {
    case "spawned": {
      const agentType = nonemptyString(data.agentType);
      const sessionFile = nonemptyString(data.sessionFile);
      const execution = executionFrom(data.execution);
      return agentType && sessionFile && execution
        ? { ...base, event: "spawned", agentType, sessionFile, execution }
        : undefined;
    }
    case "assignment_queued": {
      const generation = positiveInteger(data.generation);
      const assignmentKind = assignmentKindFrom(data.assignmentKind);
      return generation && assignmentKind
        ? { ...base, event: "assignment_queued", generation, assignmentKind }
        : undefined;
    }
    case "assignment_phase_changed": {
      const generation = positiveInteger(data.generation);
      const phase = assignmentActivePhaseFrom(data.phase);
      return generation && phase ? { ...base, event: "assignment_phase_changed", generation, phase } : undefined;
    }
    case "started": {
      const generation = positiveInteger(data.generation);
      return generation ? { ...base, event: "started", generation } : undefined;
    }
    case "unloaded":
    case "closed":
      return { ...base, event: base.event };
    case "completed": {
      const generation = positiveInteger(data.generation);
      const artifactReference = nonemptyString(data.artifactReference);
      if (!generation || !artifactReference) return undefined;
      return { ...base, event: "completed", generation, artifactReference };
    }
    case "interrupted": {
      const generation = positiveInteger(data.generation);
      const artifactReference = nonemptyOptionalString(data.artifactReference);
      if (!generation || artifactReference === null) return undefined;
      return {
        ...base,
        event: "interrupted",
        generation,
        ...(artifactReference ? { artifactReference } : {}),
      };
    }
    case "failed": {
      const generation = positiveInteger(data.generation);
      const errorKind = nonemptyString(data.errorKind);
      const artifactReference = nonemptyOptionalString(data.artifactReference);
      if (!generation || !errorKind || artifactReference === null) return undefined;
      return {
        ...base,
        event: "failed",
        generation,
        errorKind,
        ...(artifactReference ? { artifactReference } : {}),
      };
    }
    case "notification_updated": {
      const generation = positiveInteger(data.generation);
      const notification = notificationStateFrom(data.notification);
      return generation && notification
        ? { ...base, event: "notification_updated", generation, notification }
        : undefined;
    }
    case "execution_changed": {
      const execution = executionFrom(data.execution);
      return execution ? { ...base, event: "execution_changed", execution } : undefined;
    }
    case "mail_queued":
    case "mail_delivered": {
      const mailId = nonemptyString(data.mailId);
      return mailId ? { ...base, event: base.event, mailId } : undefined;
    }
  }
}

export function runtimeEntryFromSessionEntry(value: unknown): SubagentRuntimeEntry | undefined {
  const entry = recordValue(value);
  if (!entry || entry.type !== "custom" || entry.customType !== SUBAGENT_RUNTIME_ENTRY_TYPE) return undefined;
  return parseRuntimeEntry(entry.data);
}

function baseFrom(data: Record<string, unknown>): RuntimeEntryBase | undefined {
  const event = data.event as RuntimeEventName;
  const agentPath = nonemptyString(data.agentPath);
  const agentId = nonemptyString(data.agentId);
  return agentPath && agentId ? { version: SUBAGENT_RUNTIME_ENTRY_VERSION, event, agentPath, agentId } : undefined;
}

function executionFrom(value: unknown): RuntimeExecutionProfile | undefined {
  const execution = recordValue(value);
  const profile = recordValue(execution?.profile);
  const source = recordValue(execution?.source);
  if (!profile || !source) return undefined;

  const provider = exactNonemptyString(profile.provider);
  const model = exactNonemptyString(profile.model);
  const effort = parseReasoningEffort(profile.effort);
  const modelSource = executionSource(source.model);
  const effortSource = executionSource(source.effort);
  return provider && model && effort && modelSource && effortSource
    ? {
        profile: { provider, model, effort },
        source: { model: modelSource, effort: effortSource },
      }
    : undefined;
}

function executionSource(value: unknown): ExecutionSource | undefined {
  return value === "invocation" || value === "repository" || value === "agent" || value === "parent"
    ? value
    : undefined;
}

function assignmentKindFrom(value: unknown): RuntimeAssignmentKind | undefined {
  return value === "spawn" || value === "followup" ? value : undefined;
}

function assignmentActivePhaseFrom(value: unknown): "starting" | "running" | undefined {
  return value === "starting" || value === "running" ? value : undefined;
}

function notificationStateFrom(value: unknown): RuntimeNotificationState | undefined {
  const notification = recordValue(value);
  if (!notification) return undefined;
  if (notification.status === "pending") return { status: "pending" };
  if (notification.status === "delivered") {
    const delivery = notificationDeliveryFrom(notification.delivery);
    const mailId = nonemptyOptionalString(notification.mailId);
    if (!delivery || mailId === null || (delivery === "queued" && !mailId)) return undefined;
    return {
      status: "delivered",
      delivery,
      ...(mailId ? { mailId } : {}),
    };
  }
  if (notification.status !== "failed") return undefined;

  const failure = recordValue(notification.failure);
  const kind = notificationFailureKindFrom(failure?.kind);
  const targetPath = nonemptyString(failure?.targetPath);
  const retryable = failure?.retryable;
  return kind && targetPath && typeof retryable === "boolean"
    ? { status: "failed", failure: { kind, targetPath, retryable } }
    : undefined;
}

function notificationDeliveryFrom(value: unknown): "root" | "steered" | "queued" | undefined {
  return value === "root" || value === "steered" || value === "queued" ? value : undefined;
}

function notificationFailureKindFrom(
  value: unknown,
): "root_callback_failed" | "parent_unavailable" | "parent_mailbox_failed" | "shutting_down" | undefined {
  return value === "root_callback_failed" ||
    value === "parent_unavailable" ||
    value === "parent_mailbox_failed" ||
    value === "shutting_down"
    ? value
    : undefined;
}

function exactNonemptyString(value: unknown): string | undefined {
  const parsed = nonemptyString(value);
  return parsed === value ? parsed : undefined;
}

function nonemptyOptionalString(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return nonemptyString(value) ?? null;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
