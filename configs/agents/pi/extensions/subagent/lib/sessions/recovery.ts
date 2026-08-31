import { type RuntimeEventName, type RuntimeExecutionProfile, runtimeEntryFromSessionEntry } from "./entries";

export type RecoveredAgentStatus = "unloaded" | "closed";

export interface RecoveredAgentMetadata {
  agentPath: string;
  agentId: string;
  agentType: string;
  sessionFile: string;
  execution: RuntimeExecutionProfile;
  status: RecoveredAgentStatus;
  lastEvent: RuntimeEventName;
  assignmentGeneration: number;
  artifactReference?: string;
  failure?: { kind: string };
  queuedMailIds: string[];
}

/** Replays only version-2 custom entries from Pi's current session branch. */
export function recoverRuntimeMetadata(branchEntries: readonly unknown[]): RecoveredAgentMetadata[] {
  const agents = new Map<string, MutableRecoveredAgent>();

  for (const branchEntry of branchEntries) {
    const entry = runtimeEntryFromSessionEntry(branchEntry);
    if (!entry) continue;

    if (entry.event === "spawned") {
      agents.set(entry.agentPath, {
        agentPath: entry.agentPath,
        agentId: entry.agentId,
        agentType: entry.agentType,
        sessionFile: entry.sessionFile,
        execution: entry.execution,
        status: "unloaded",
        lastEvent: entry.event,
        assignmentGeneration: 0,
        assignmentSettled: false,
        queuedMailIds: new Set(),
      });
      continue;
    }

    const agent = agents.get(entry.agentPath);
    if (!agent || agent.agentId !== entry.agentId) continue;

    if (isAssignmentEntry(entry)) {
      if (entry.generation < agent.assignmentGeneration) continue;
      if (entry.generation === agent.assignmentGeneration && agent.assignmentSettled) continue;
      if (entry.generation > agent.assignmentGeneration) {
        agent.assignmentGeneration = entry.generation;
        agent.assignmentSettled = false;
        agent.artifactReference = undefined;
        agent.failure = undefined;
      }
    }

    agent.lastEvent = entry.event;
    if (entry.event === "closed") agent.status = "closed";
    if (entry.event === "execution_changed") agent.execution = entry.execution;
    if (entry.event === "completed") {
      agent.assignmentSettled = true;
      agent.artifactReference = entry.artifactReference;
      agent.failure = undefined;
    }
    if (entry.event === "interrupted") agent.assignmentSettled = true;
    if (entry.event === "failed") {
      agent.assignmentSettled = true;
      agent.failure = { kind: entry.errorKind };
      agent.artifactReference = entry.artifactReference;
    }
    if (entry.event === "mail_queued") agent.queuedMailIds.add(entry.mailId);
    if (entry.event === "mail_delivered") agent.queuedMailIds.delete(entry.mailId);
  }

  return [...agents.values()].map(freezeMetadata).sort((left, right) => left.agentPath.localeCompare(right.agentPath));
}

type AssignmentEntry = Extract<
  NonNullable<ReturnType<typeof runtimeEntryFromSessionEntry>>,
  { event: "started" | "completed" | "interrupted" | "failed" }
>;

interface MutableRecoveredAgent extends Omit<RecoveredAgentMetadata, "queuedMailIds"> {
  assignmentSettled: boolean;
  queuedMailIds: Set<string>;
}

function isAssignmentEntry(
  entry: NonNullable<ReturnType<typeof runtimeEntryFromSessionEntry>>,
): entry is AssignmentEntry {
  return (
    entry.event === "started" ||
    entry.event === "completed" ||
    entry.event === "interrupted" ||
    entry.event === "failed"
  );
}

function freezeMetadata(agent: MutableRecoveredAgent): RecoveredAgentMetadata {
  return {
    agentPath: agent.agentPath,
    agentId: agent.agentId,
    agentType: agent.agentType,
    sessionFile: agent.sessionFile,
    execution: {
      profile: { ...agent.execution.profile },
      source: { ...agent.execution.source },
    },
    status: agent.status,
    lastEvent: agent.lastEvent,
    assignmentGeneration: agent.assignmentGeneration,
    ...(agent.artifactReference ? { artifactReference: agent.artifactReference } : {}),
    ...(agent.failure ? { failure: { ...agent.failure } } : {}),
    queuedMailIds: [...agent.queuedMailIds].sort(),
  };
}
