import { mock } from "bun:test";
import type { ResolvedAgentExecution } from "../execution/profile";
import type { AgentSupervisor } from "../supervisor/supervisor";
import type { AgentToolsRuntime } from "./shared";

export const EXECUTION: ResolvedAgentExecution = {
  profile: { provider: "test", model: "model", effort: "medium" },
  source: { model: "parent", effort: "parent" },
};

export function createFakeToolsRuntime(): AgentToolsRuntime {
  const supervisor: AgentSupervisor = {
    spawn: mock(async (request) => ({
      agentPath: `/root/${request.taskName}`,
      agentId: "agent-1",
      assignmentId: "a-1",
      status: "running" as const,
      execution: request.execution,
    })),
    send: mock(async (request) => ({
      agentPath: request.target,
      agentId: "agent-1",
      delivery: "steered" as const,
    })),
    followup: mock(async (request) => ({
      agentPath: request.target,
      agentId: "agent-1",
      assignmentId: "a-2",
      status: "running" as const,
      execution: request.execution ?? EXECUTION,
    })),
    wait: mock(async (request) => ({
      condition: request.condition ?? "all",
      timedOut: false,
      completed: [],
      pending: [],
    })),
    interrupt: mock(async (target) => listEntry(target)),
    list: mock(async () => [listEntry("/root/task")]),
    close: mock(async (target) => ({ ...listEntry(target), status: "closed" as const })),
    clearSettledActivities: mock(() => undefined),
    restore: mock(async () => undefined),
    shutdown: mock(async () => undefined),
  };
  return {
    supervisor,
    readArtifactPage: mock(async (reference, options) => ({
      ok: true as const,
      page: {
        reference,
        cursor: options.cursor ?? 0,
        content: "artifact page",
        bytes: 13,
        lines: 1,
        eof: true,
      },
    })),
    resolveExecution: mock(async () => EXECUTION),
  };
}

function listEntry(agentPath: string) {
  return { agentPath, agentId: "agent-1", agentType: "worker", status: "idle" as const, execution: EXECUTION };
}
