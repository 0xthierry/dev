import {
  type RuntimeAssignmentKind,
  type RuntimeAssignmentOutcome,
  type RuntimeAssignmentPhase,
  type RuntimeEventName,
  type RuntimeExecutionProfile,
  type RuntimeNotificationState,
  runtimeEntryFromSessionEntry,
} from "./entries";

export type RecoveredAgentStatus = "unloaded" | "closed";

export interface RecoveredAssignmentMetadata {
  generation: number;
  kind: RuntimeAssignmentKind;
  phase: RuntimeAssignmentPhase;
  outcome?: RuntimeAssignmentOutcome;
  artifactReference?: string;
  errorKind?: string;
  notification?: RuntimeNotificationState;
}

export interface RecoveredAgentMetadata {
  agentPath: string;
  agentId: string;
  agentType: string;
  sessionFile: string;
  execution: RuntimeExecutionProfile;
  status: RecoveredAgentStatus;
  lastEvent: RuntimeEventName;
  assignmentGeneration: number;
  assignments: RecoveredAssignmentMetadata[];
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
        assignments: new Map(),
        queuedMailIds: new Set(),
      });
      continue;
    }

    const agent = agents.get(entry.agentPath);
    if (!agent || agent.agentId !== entry.agentId) continue;

    if (entry.event === "assignment_queued") {
      const assignment = assignmentFor(agent, entry.generation, "queued");
      if (assignment.phase !== "queued") continue;
      assignment.kind = entry.assignmentKind;
    } else if (entry.event === "assignment_phase_changed") {
      const assignment = assignmentFor(agent, entry.generation, entry.phase);
      if (assignment.phase === "settled" || phaseOrder(entry.phase) < phaseOrder(assignment.phase)) continue;
      assignment.phase = entry.phase;
    } else if (entry.event === "started") {
      const assignment = assignmentFor(agent, entry.generation, "starting");
      if (assignment.phase === "settled") continue;
      if (phaseOrder(assignment.phase) < phaseOrder("starting")) assignment.phase = "starting";
    } else if (entry.event === "completed") {
      if (!settleAssignment(agent, entry.generation, "completed")) continue;
      const assignment = agent.assignments.get(entry.generation);
      if (assignment) assignment.artifactReference = entry.artifactReference;
    } else if (entry.event === "interrupted") {
      if (!settleAssignment(agent, entry.generation, "interrupted")) continue;
      const assignment = agent.assignments.get(entry.generation);
      if (assignment && entry.artifactReference) assignment.artifactReference = entry.artifactReference;
    } else if (entry.event === "failed") {
      if (!settleAssignment(agent, entry.generation, "failed")) continue;
      const assignment = agent.assignments.get(entry.generation);
      if (assignment) {
        assignment.errorKind = entry.errorKind;
        if (entry.artifactReference) assignment.artifactReference = entry.artifactReference;
      }
    } else if (entry.event === "notification_updated") {
      const assignment = agent.assignments.get(entry.generation);
      if (!assignment || assignment.phase !== "settled") continue;
      assignment.notification = copyNotification(entry.notification);
    } else if (entry.event === "closed") {
      agent.status = "closed";
    } else if (entry.event === "execution_changed") {
      agent.execution = entry.execution;
    } else if (entry.event === "mail_queued") {
      agent.queuedMailIds.add(entry.mailId);
    } else if (entry.event === "mail_delivered") {
      agent.queuedMailIds.delete(entry.mailId);
    }

    agent.lastEvent = entry.event;
  }

  return [...agents.values()].map(freezeMetadata).sort((left, right) => left.agentPath.localeCompare(right.agentPath));
}

type MutableRecoveredAssignment = RecoveredAssignmentMetadata;

interface MutableRecoveredAgent extends Omit<RecoveredAgentMetadata, "assignments" | "queuedMailIds"> {
  assignments: Map<number, MutableRecoveredAssignment>;
  queuedMailIds: Set<string>;
}

function assignmentFor(
  agent: MutableRecoveredAgent,
  generation: number,
  initialPhase: RuntimeAssignmentPhase,
): MutableRecoveredAssignment {
  agent.assignmentGeneration = Math.max(agent.assignmentGeneration, generation);
  const existing = agent.assignments.get(generation);
  if (existing) return existing;
  const assignment: MutableRecoveredAssignment = {
    generation,
    kind: generation === 1 ? "spawn" : "followup",
    phase: initialPhase,
  };
  agent.assignments.set(generation, assignment);
  return assignment;
}

function settleAssignment(
  agent: MutableRecoveredAgent,
  generation: number,
  outcome: RuntimeAssignmentOutcome,
): boolean {
  const assignment = assignmentFor(agent, generation, "settled");
  if (assignment.phase === "settled" && assignment.outcome) return false;
  assignment.phase = "settled";
  assignment.outcome = outcome;
  assignment.artifactReference = undefined;
  assignment.errorKind = undefined;
  assignment.notification = undefined;
  return true;
}

function phaseOrder(phase: RuntimeAssignmentPhase): number {
  switch (phase) {
    case "queued":
      return 0;
    case "starting":
      return 1;
    case "running":
      return 2;
    case "settled":
      return 3;
  }
}

function freezeMetadata(agent: MutableRecoveredAgent): RecoveredAgentMetadata {
  const assignments = [...agent.assignments.values()]
    .sort((left, right) => left.generation - right.generation)
    .map(copyAssignment);
  const latest = assignments[assignments.length - 1];
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
    assignments,
    ...(latest?.artifactReference ? { artifactReference: latest.artifactReference } : {}),
    ...(latest?.errorKind ? { failure: { kind: latest.errorKind } } : {}),
    queuedMailIds: [...agent.queuedMailIds].sort(),
  };
}

function copyAssignment(assignment: MutableRecoveredAssignment): RecoveredAssignmentMetadata {
  return {
    generation: assignment.generation,
    kind: assignment.kind,
    phase: assignment.phase,
    ...(assignment.outcome ? { outcome: assignment.outcome } : {}),
    ...(assignment.artifactReference ? { artifactReference: assignment.artifactReference } : {}),
    ...(assignment.errorKind ? { errorKind: assignment.errorKind } : {}),
    ...(assignment.notification ? { notification: copyNotification(assignment.notification) } : {}),
  };
}

function copyNotification(notification: RuntimeNotificationState): RuntimeNotificationState {
  if (notification.status === "pending") return { status: "pending" };
  if (notification.status === "delivered") {
    return {
      status: "delivered",
      delivery: notification.delivery,
      ...(notification.mailId ? { mailId: notification.mailId } : {}),
    };
  }
  return { status: "failed", failure: { ...notification.failure } };
}
