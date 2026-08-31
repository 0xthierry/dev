import { describe, expect, test } from "bun:test";
import type { ResolvedAgentExecution } from "../execution/profile";
import { AgentRegistry, RegistryError } from "./registry";

const execution: ResolvedAgentExecution = {
  profile: { provider: "test", model: "model", effort: "high" },
  source: { model: "parent", effort: "parent" },
};

function register(registry: AgentRegistry, path = "/root/a", id = "agent-a"): void {
  registry.register({
    agentPath: path,
    agentId: id,
    parentPath: "/root",
    taskName: "a",
    agentType: "worker",
    depth: 1,
    execution,
  });
}

describe("AgentRegistry", () => {
  test("uses exact paths and IDs and rejects duplicates", () => {
    // Arrange
    const registry = new AgentRegistry();
    register(registry);

    // Act
    const byPath = registry.resolve("/root/a");
    const byId = registry.resolve("agent-a");
    const duplicate = () => register(registry, "/root/a", "other");

    // Assert
    expect(byPath.agentId).toBe("agent-a");
    expect(byId.agentPath).toBe("/root/a");
    expect(duplicate).toThrow(RegistryError);
    expect(() => registry.resolve("agent")).toThrow();
  });

  test("owns assignment generations and ignores duplicate settlement", () => {
    // Arrange
    const registry = new AgentRegistry();
    register(registry);
    const first = registry.queueAssignment("/root/a", "spawn");

    // Act
    registry.startAssignment("/root/a", first.id);
    registry.markRunning("/root/a", first.id, "/sessions/a.jsonl");
    const applied = registry.settleAssignment("/root/a", first.id, {
      outcome: "completed",
      artifactReference: "subagent-artifact:one",
    });
    const duplicate = registry.settleAssignment("/root/a", first.id, { outcome: "failed" });
    const second = registry.queueAssignment("/root/a", "followup");

    // Assert
    expect(applied.applied).toBe(true);
    expect(duplicate.applied).toBe(false);
    expect(second).toMatchObject({ id: "agent-a:2", generation: 2, phase: "queued" });
    expect(registry.resolve("/root/a").status).toBe("queued");
  });

  test("queues follow-ups behind the active generation", () => {
    // Arrange
    const registry = new AgentRegistry();
    register(registry);
    const first = registry.queueAssignment("agent-a", "spawn");
    registry.startAssignment("agent-a", first.id);
    registry.markRunning("agent-a", first.id, "/sessions/a.jsonl");

    // Act
    const second = registry.queueAssignment("agent-a", "followup");
    registry.settleAssignment("agent-a", first.id, { outcome: "completed" });
    registry.startAssignment("agent-a", second.id);

    // Assert
    expect(registry.assignmentById("agent-a", first.id).phase).toBe("settled");
    expect(registry.assignmentById("agent-a", second.id).phase).toBe("starting");
    expect(registry.resolve("agent-a").status).toBe("starting");
  });

  test("continues a recovered durable assignment generation", () => {
    // Arrange
    const registry = new AgentRegistry();
    registry.register({
      agentPath: "/root/a",
      agentId: "agent-a",
      parentPath: "/root",
      taskName: "a",
      agentType: "worker",
      depth: 1,
      status: "unloaded",
      execution,
      sessionFile: "/sessions/a.jsonl",
      assignmentGeneration: 7,
    });

    // Act
    const assignment = registry.queueAssignment("agent-a", "followup");

    // Assert
    expect(assignment).toMatchObject({ id: "agent-a:8", generation: 8 });
  });

  test("rejects exhausted restored generations instead of producing ambiguous IDs", () => {
    // Arrange
    const registry = new AgentRegistry();
    registry.register({
      agentPath: "/root/a",
      agentId: "agent-a",
      parentPath: "/root",
      taskName: "a",
      agentType: "worker",
      depth: 1,
      status: "unloaded",
      execution,
      sessionFile: "/sessions/a.jsonl",
      assignmentGeneration: Number.MAX_SAFE_INTEGER,
    });

    // Act
    const queue = () => registry.queueAssignment("agent-a", "followup");

    // Assert
    expect(queue).toThrow(RegistryError);
    try {
      queue();
    } catch (error) {
      expect(error).toMatchObject({ kind: "assignment_generation_exhausted" });
    }
  });

  test("makes close terminal and rejects illegal transitions", () => {
    // Arrange
    const registry = new AgentRegistry();
    register(registry);

    // Act
    registry.transition("agent-a", "closed");

    // Assert
    expect(() => registry.transition("agent-a", "unloaded")).toThrow(RegistryError);
    expect(() => registry.queueAssignment("agent-a", "followup")).toThrow(RegistryError);
  });
});
