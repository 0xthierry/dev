export interface LimitEvidence {
  resource: string;
  unit: string;
  default: number;
  minimum: number;
  hardMaximum?: number;
  rationale: string;
}

/**
 * Supervisor-owned limits. Each one protects a concrete in-memory, process,
 * provider-cost, or latency resource; reaching a cap is an explicit error/queue.
 */
export const SUPERVISOR_LIMIT_EVIDENCE = {
  activeAgents: {
    resource: "simultaneous provider turns and provider spend",
    unit: "child assignments",
    default: 8,
    minimum: 1,
    rationale:
      "Eight parallel child assignments support wider orchestration fan-out; additional assignments queue explicitly.",
  },
  residentAgents: {
    resource: "resident Pi/Node process memory and file descriptors",
    unit: "child processes",
    default: 16,
    minimum: 1,
    rationale:
      "Twice the active budget leaves room for idle resumable children while new queued assignments consume released active slots.",
  },
  depth: {
    resource: "multiplicative orchestration fan-out",
    unit: "path edges below /root",
    default: 1,
    minimum: 1,
    rationale:
      "One permits direct subagents but disables nested delegation by default; trusted local configuration may choose a deeper topology without an arbitrary ceiling.",
  },
  waitTimeoutMs: {
    resource: "pending timer/listener lifetime",
    unit: "milliseconds",
    default: 30_000,
    minimum: 0,
    hardMaximum: 3_600_000,
    rationale: "Codex uses a 30s default and permits hour-long waits for genuinely long model turns.",
  },
  mailMessages: {
    resource: "queued mailbox object count",
    unit: "messages per target",
    default: 32,
    minimum: 1,
    hardMaximum: 128,
    rationale: "Supports bursty steering without allowing an idle child to accumulate an unbounded queue.",
  },
  mailMessageBytes: {
    resource: "single steer/follow-up RPC and model context",
    unit: "UTF-8 bytes",
    default: 16 * 1024,
    minimum: 256,
    hardMaximum: 64 * 1024,
    rationale: "A mailbox item should be bounded communication, not an artifact transport.",
  },
  mailTargetBytes: {
    resource: "retained mailbox memory",
    unit: "UTF-8 bytes per target",
    default: 64 * 1024,
    minimum: 1024,
    hardMaximum: 1024 * 1024,
    rationale: "Four full default-size messages fit, while larger bursts require smaller messages or artifacts.",
  },
} as const satisfies Record<string, LimitEvidence>;

export const DEFAULT_ACTIVE_AGENTS = SUPERVISOR_LIMIT_EVIDENCE.activeAgents.default;
export const DEFAULT_RESIDENT_AGENTS = SUPERVISOR_LIMIT_EVIDENCE.residentAgents.default;
export const DEFAULT_MAX_DEPTH = SUPERVISOR_LIMIT_EVIDENCE.depth.default;
export const DEFAULT_WAIT_TIMEOUT_MS = SUPERVISOR_LIMIT_EVIDENCE.waitTimeoutMs.default;
export const MAX_WAIT_TIMEOUT_MS = SUPERVISOR_LIMIT_EVIDENCE.waitTimeoutMs.hardMaximum;

export function assertConfigurableLimit(name: "activeAgents" | "residentAgents" | "depth", value: number): void {
  const evidence = SUPERVISOR_LIMIT_EVIDENCE[name];
  if (!Number.isSafeInteger(value) || value < evidence.minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${evidence.minimum}`);
  }
}
