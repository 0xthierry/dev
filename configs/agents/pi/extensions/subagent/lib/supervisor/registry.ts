import type { ResolvedAgentExecution } from "../execution/profile";
import type { AgentStatus } from "./status";

export type AssignmentKind = "spawn" | "followup";
export type AssignmentOutcome = "completed" | "interrupted" | "failed";
export type AssignmentPhase = "queued" | "starting" | "running" | "settled";

export interface AssignmentRecord {
  id: string;
  generation: number;
  kind: AssignmentKind;
  phase: AssignmentPhase;
  outcome?: AssignmentOutcome;
  artifactReference?: string;
  outputPreview?: string;
  errorKind?: string;
}

export interface AgentRecord {
  agentPath: string;
  agentId: string;
  parentPath: string;
  taskName: string;
  agentType: string;
  depth: number;
  status: AgentStatus;
  execution: ResolvedAgentExecution;
  sessionFile?: string;
  assignmentGeneration: number;
  assignments: AssignmentRecord[];
}

export interface RegisterAgentInput {
  agentPath: string;
  agentId: string;
  parentPath: string;
  taskName: string;
  agentType: string;
  depth: number;
  status?: "queued" | "unloaded" | "closed";
  execution: ResolvedAgentExecution;
  sessionFile?: string;
  assignmentGeneration?: number;
}

export type RegistryErrorKind =
  | "duplicate_path"
  | "duplicate_id"
  | "unknown_agent"
  | "invalid_transition"
  | "stale_assignment"
  | "assignment_generation_exhausted"
  | "closed";

export class RegistryError extends Error {
  constructor(
    readonly kind: RegistryErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

const TRANSITIONS: Readonly<Record<AgentStatus, ReadonlySet<AgentStatus>>> = {
  queued: new Set(["starting", "interrupted", "failed", "closed"]),
  starting: new Set(["running", "interrupted", "failed", "unloaded", "closed"]),
  running: new Set(["queued", "idle", "interrupted", "failed", "unloaded", "closed"]),
  idle: new Set(["queued", "starting", "unloaded", "closed"]),
  interrupted: new Set(["queued", "starting", "unloaded", "closed"]),
  failed: new Set(["queued", "starting", "unloaded", "closed"]),
  unloaded: new Set(["queued", "starting", "closed"]),
  closed: new Set(),
};

/** The sole owner of agent state transitions and assignment generations. */
export class AgentRegistry {
  private readonly byPath = new Map<string, AgentRecord>();
  private readonly pathById = new Map<string, string>();

  register(input: RegisterAgentInput): AgentRecord {
    if (this.byPath.has(input.agentPath)) {
      throw new RegistryError("duplicate_path", `Agent path already exists: ${input.agentPath}`);
    }
    if (this.pathById.has(input.agentId)) {
      throw new RegistryError("duplicate_id", `Agent id already exists: ${input.agentId}`);
    }
    if (
      input.assignmentGeneration !== undefined &&
      (!Number.isSafeInteger(input.assignmentGeneration) || input.assignmentGeneration < 0)
    ) {
      throw new RegistryError("invalid_transition", "Assignment generation must be a non-negative integer");
    }
    const record: AgentRecord = {
      agentPath: input.agentPath,
      agentId: input.agentId,
      parentPath: input.parentPath,
      taskName: input.taskName,
      agentType: input.agentType,
      depth: input.depth,
      status: input.status ?? "queued",
      execution: copyExecution(input.execution),
      ...(input.sessionFile ? { sessionFile: input.sessionFile } : {}),
      assignmentGeneration: input.assignmentGeneration ?? 0,
      assignments: [],
    };
    this.byPath.set(record.agentPath, record);
    this.pathById.set(record.agentId, record.agentPath);
    return snapshot(record);
  }

  resolve(target: string): AgentRecord {
    const path = this.byPath.has(target) ? target : this.pathById.get(target);
    if (!path) throw new RegistryError("unknown_agent", `Unknown agent target: ${target}`);
    const record = this.byPath.get(path);
    if (!record) throw new RegistryError("unknown_agent", `Unknown agent target: ${target}`);
    return snapshot(record);
  }

  list(): AgentRecord[] {
    return [...this.byPath.values()].sort((left, right) => left.agentPath.localeCompare(right.agentPath)).map(snapshot);
  }

  transition(target: string, next: AgentStatus): AgentRecord {
    const record = this.mutable(target);
    if (record.status === next) return snapshot(record);
    if (!TRANSITIONS[record.status].has(next)) {
      throw new RegistryError("invalid_transition", `Illegal agent transition: ${record.status} -> ${next}`);
    }
    record.status = next;
    return snapshot(record);
  }

  queueAssignment(target: string, kind: AssignmentKind): AssignmentRecord {
    const record = this.mutable(target);
    if (record.status === "closed") throw new RegistryError("closed", `Agent is closed: ${record.agentPath}`);
    if (record.assignmentGeneration >= Number.MAX_SAFE_INTEGER) {
      throw new RegistryError(
        "assignment_generation_exhausted",
        `Assignment generation exhausted: ${record.agentPath}`,
      );
    }
    const generation = record.assignmentGeneration + 1;
    record.assignmentGeneration = generation;
    const assignment: AssignmentRecord = {
      id: `${record.agentId}:${generation}`,
      generation,
      kind,
      phase: "queued",
    };
    record.assignments.push(assignment);
    if (!this.activeAssignment(record)) {
      if (record.status !== "queued") this.transition(record.agentPath, "queued");
    }
    return { ...assignment };
  }

  startAssignment(target: string, assignmentId: string): AssignmentRecord {
    const record = this.mutable(target);
    const assignment = this.assignment(record, assignmentId);
    if (assignment.phase !== "queued") {
      throw new RegistryError("stale_assignment", `Assignment is not queued: ${assignmentId}`);
    }
    if (this.activeAssignment(record)) {
      throw new RegistryError("invalid_transition", `Agent already has an active assignment: ${record.agentPath}`);
    }
    assignment.phase = "starting";
    this.transition(record.agentPath, "starting");
    return { ...assignment };
  }

  markRunning(target: string, assignmentId: string, sessionFile: string): AssignmentRecord {
    const record = this.mutable(target);
    const assignment = this.assignment(record, assignmentId);
    if (assignment.phase !== "starting") {
      throw new RegistryError("stale_assignment", `Assignment is not starting: ${assignmentId}`);
    }
    assignment.phase = "running";
    record.sessionFile = sessionFile;
    this.transition(record.agentPath, "running");
    return { ...assignment };
  }

  settleQueuedAssignment(
    target: string,
    assignmentId: string,
    outcome: "interrupted" | "failed",
    errorKind?: string,
  ): AssignmentRecord {
    const record = this.mutable(target);
    const assignment = this.assignment(record, assignmentId);
    if (assignment.phase === "settled") return { ...assignment };
    if (assignment.phase !== "queued") {
      throw new RegistryError("stale_assignment", `Assignment is not queued: ${assignmentId}`);
    }
    assignment.phase = "settled";
    assignment.outcome = outcome;
    if (errorKind) assignment.errorKind = errorKind;
    if (!this.activeAssignment(record) && !record.assignments.some((candidate) => candidate.phase === "queued")) {
      this.transition(record.agentPath, outcome);
    }
    return { ...assignment };
  }

  settleAssignment(
    target: string,
    assignmentId: string,
    result: {
      outcome: AssignmentOutcome;
      artifactReference?: string;
      outputPreview?: string;
      errorKind?: string;
    },
  ): { applied: boolean; assignment: AssignmentRecord } {
    const record = this.mutable(target);
    const assignment = this.assignment(record, assignmentId);
    if (assignment.phase === "settled") return { applied: false, assignment: { ...assignment } };
    const current = this.activeAssignment(record);
    if (!current || current.id !== assignmentId) return { applied: false, assignment: { ...assignment } };

    assignment.phase = "settled";
    assignment.outcome = result.outcome;
    if (result.artifactReference) assignment.artifactReference = result.artifactReference;
    if (result.outputPreview) assignment.outputPreview = result.outputPreview;
    if (result.errorKind) assignment.errorKind = result.errorKind;
    const hasQueued = record.assignments.some((candidate) => candidate.phase === "queued");
    const next: AgentStatus = hasQueued ? "queued" : result.outcome === "completed" ? "idle" : result.outcome;
    this.transition(record.agentPath, next);
    return { applied: true, assignment: { ...assignment } };
  }

  latestAssignment(target: string): AssignmentRecord | undefined {
    const assignment = this.mutable(target).assignments.at(-1);
    return assignment ? { ...assignment } : undefined;
  }

  assignmentById(target: string, assignmentId: string): AssignmentRecord {
    return { ...this.assignment(this.mutable(target), assignmentId) };
  }

  updateExecution(target: string, execution: ResolvedAgentExecution): AgentRecord {
    const record = this.mutable(target);
    if (record.status === "closed") throw new RegistryError("closed", `Agent is closed: ${record.agentPath}`);
    record.execution = copyExecution(execution);
    return snapshot(record);
  }

  private activeAssignment(record: AgentRecord): AssignmentRecord | undefined {
    return record.assignments.find((assignment) => assignment.phase === "starting" || assignment.phase === "running");
  }

  private assignment(record: AgentRecord, assignmentId: string): AssignmentRecord {
    const assignment = record.assignments.find((candidate) => candidate.id === assignmentId);
    if (!assignment) throw new RegistryError("stale_assignment", `Unknown assignment: ${assignmentId}`);
    return assignment;
  }

  private mutable(target: string): AgentRecord {
    const path = this.byPath.has(target) ? target : this.pathById.get(target);
    const record = path ? this.byPath.get(path) : undefined;
    if (!record) throw new RegistryError("unknown_agent", `Unknown agent target: ${target}`);
    return record;
  }
}

function snapshot(record: AgentRecord): AgentRecord {
  return {
    ...record,
    execution: copyExecution(record.execution),
    assignments: record.assignments.map((assignment) => ({ ...assignment })),
  };
}

function copyExecution(execution: ResolvedAgentExecution): ResolvedAgentExecution {
  return { profile: { ...execution.profile }, source: { ...execution.source } };
}
