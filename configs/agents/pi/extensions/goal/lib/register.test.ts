import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { STALL_REFLECT_TURNS } from "./policy";
import { type GoalRuntime, registerGoalExtension } from "./register";
import type { GoalAuditorRunInput, GoalAuditorRunResult } from "./types";

function fakeRuntime(
  auditorResult: GoalAuditorRunResult = { approved: true, disapproved: false, output: "Looks complete.\n<approved/>" },
): GoalRuntime {
  return {
    setTimeout: mock((callback: () => void, delayMs: number) => setTimeout(callback, delayMs)),
    clearTimeout: mock((timer: ReturnType<typeof setTimeout>) => clearTimeout(timer)),
    runAuditor: mock(async (_ctx: ExtensionContext, _input: GoalAuditorRunInput) => auditorResult),
  };
}

describe("registerGoalExtension", () => {
  afterEach(() => {
    setSystemTime();
  });

  test("creates a goal through the slash command and queues continuation", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());

    // Act
    await fakePi.runCommand("goal", "finish migration until tests pass");
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Assert
    expect(fakePi.appendedEntries.at(-1)?.customType).toBe("pi-goal-state");
    const continuation = fakePi.sentMessages.find((message) =>
      JSON.stringify(message).includes("Continue concrete work"),
    );
    expect(continuation).toBeDefined();
    expect(JSON.stringify(continuation)).not.toContain("finish migration until tests pass");
  });

  test("rejects slash-created vague goals", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi({ ctx: { hasUI: true } });
    registerGoalExtension(fakePi.pi, fakeRuntime());

    // Act
    await fakePi.runCommand("goal", "fix it");

    // Assert
    expect(fakePi.appendedEntries).toHaveLength(0);
    expect(fakePi.uiNotifications.at(-1)?.message).toContain("Goal rejected");
  });

  test("rejects model-created vague goals", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());

    // Act
    const result = await fakePi.runTool("create_goal", {
      objective: "fix it",
      successCriteria: ["done"],
      verificationPlan: ["check"],
      constraints: ["none"],
      evidenceSurface: ["files"],
      autoContinue: true,
    });

    // Assert
    expect(JSON.stringify(result)).toContain("create_goal rejected");
  });

  test("requires auditor approval before completion", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const runtime = fakeRuntime({ approved: false, disapproved: true, output: "Missing tests.\n<disapproved/>" });
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, runtime);
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    const result = await fakePi.runTool("update_goal", {
      status: "complete",
      summary: "done",
      evidenceRefs: ["tests passed"],
    });

    // Assert
    expect(runtime.runAuditor).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).toContain("Goal audit rejected");
    expect(JSON.stringify(fakePi.appendedEntries.at(-1))).toContain("disapproved");
    expect(fakePi.sentMessages.some((message) => JSON.stringify(message).includes("pi-goal-audit"))).toBe(false);
  });

  test("blocks mutating tool calls after update_goal appears in a turn", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.emit("turn_start");
    await fakePi.emit("tool_call", { toolName: "update_goal", input: { status: "complete" } });

    // Act
    const result = await fakePi.emit("tool_call", { toolName: "write", input: { path: "x", content: "y" } });

    // Assert
    expect(result).toEqual([
      {
        block: true,
        reason:
          "A goal lifecycle tool was already called in this turn. Do not perform more mutating work; yield after the lifecycle update.",
      },
    ]);
  });

  test("updates turn limit through the slash command", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    await fakePi.runCommand("goal", "turns 512");

    // Assert
    expect(JSON.stringify(fakePi.appendedEntries.at(-1))).toContain('"turnBudget":512');
  });

  test("shows real auditor status through the slash command", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi({ ctx: { hasUI: true, model: { provider: "openai", id: "gpt-5.1" } } });
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    await fakePi.runCommand("goal", "auditor");

    // Assert
    expect(fakePi.uiNotifications.at(-1)?.message).toContain("Goal auditor: mandatory");
    expect(fakePi.uiNotifications.at(-1)?.message).toContain("Model: openai/gpt-5.1");
    expect(fakePi.uiNotifications.at(-1)?.message).toContain("Audit attempts: 0");
  });

  test("describes get_goal as the authoritative source of truth", () => {
    // Arrange
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());

    // Act
    const tool = fakePi.tools.get("get_goal");

    // Assert
    expect(tool?.description).toContain("source of truth");
    expect(JSON.stringify(tool?.promptGuidelines)).toContain("Never answer from memory");
    expect(JSON.stringify(tool?.promptGuidelines)).toContain("when the user asks about the goal");
  });

  test("tells create_goal to ground in the repo and write a falsifiable verifier", () => {
    // Arrange
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());

    // Act
    const tool = fakePi.tools.get("create_goal");
    const guidelines = JSON.stringify(tool?.promptGuidelines);

    // Assert
    expect(guidelines).toContain("call get_goal to confirm the live state");
    expect(guidelines).toContain("inspect the relevant source, tests, and docs first");
    expect(guidelines).toContain("a verifier that can actually fail");
    expect(guidelines).toContain("Leave turnBudget unset unless the user explicitly asks");
  });

  test("amends the goal contract through update_goal", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    const result = await fakePi.runTool("update_goal", {
      status: "amend",
      summary: "user lowered coverage to 70%",
      successCriteria: ["Coverage threshold is 70% and the test command passes."],
    });

    // Assert
    expect(JSON.stringify(result)).toContain("Goal amended");
    const amended = JSON.stringify(fakePi.appendedEntries.at(-1));
    expect(amended).toContain("Coverage threshold is 70%");
    expect(amended).toContain('"status":"active"');
  });

  test("pauses the goal to ask the user through update_goal", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    const result = await fakePi.runTool("update_goal", {
      status: "paused",
      summary: "Which database should I target, SQLite or Postgres?",
    });

    // Assert
    expect(JSON.stringify(result)).toContain("Which database should I target");
    const paused = JSON.stringify(fakePi.appendedEntries.at(-1));
    expect(paused).toContain('"status":"paused"');
    expect(paused).toContain('"autoContinue":false');
  });

  test("tells the model to stop when get_goal reveals a paused goal", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");
    await fakePi.runTool("update_goal", {
      status: "paused",
      summary: "Which database should I target, SQLite or Postgres?",
    });

    // Act
    const result = await fakePi.runTool("get_goal");

    // Assert
    expect(JSON.stringify(result)).toContain("PAUSED GOAL STOP");
    expect(JSON.stringify(result)).toContain("If the user explicitly asked you to update the paused goal state itself");
    expect(JSON.stringify(result)).toContain("do real introspection");
    expect(JSON.stringify(result)).toContain("reconstruct the causal chain from concrete session events");
    expect(JSON.stringify(result)).toContain("separate known causes from guesses");
    expect(JSON.stringify(result)).toContain("suggest the next task only as a proposal");
  });

  test("blocks mutating work while the goal is paused", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");
    await fakePi.runTool("update_goal", {
      status: "paused",
      summary: "Which database should I target, SQLite or Postgres?",
    });

    // Act
    const result = await fakePi.emit("tool_call", { toolName: "bash", input: { command: "docker compose up" } });

    // Assert
    expect(result).toEqual([
      {
        block: true,
        reason:
          "The current goal is paused. Stop goal work now: do not run more tools or commands. Report the pause reason honestly, explain what led to it, ask the user for direction, and wait for /goal resume.",
      },
    ]);
  });

  test("allows goal lifecycle updates while the goal is paused", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");
    await fakePi.runTool("update_goal", {
      status: "paused",
      summary: "Which database should I target, SQLite or Postgres?",
    });

    // Act
    const result = await fakePi.emit("tool_call", { toolName: "update_goal", input: { status: "complete" } });

    // Assert
    expect(result).toEqual([]);
  });

  test("auto-pauses the goal after a run of turns with no file change", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi({ ctx: { hasUI: true } });
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    for (let turn = 0; turn < 20; turn += 1) {
      await fakePi.emit("turn_end", { message: {} });
    }

    // Assert
    expect(JSON.stringify(fakePi.appendedEntries)).toContain('"status":"paused"');
    expect(fakePi.uiNotifications.some((n) => n.message.includes("auto-paused"))).toBe(true);
  });

  test("resets the stall counter when a file is edited", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");
    await fakePi.emit("turn_start");
    await fakePi.emit("tool_call", { toolName: "edit", input: { path: "src/index.ts" } });

    // Act
    await fakePi.emit("turn_end", { message: {} });

    // Assert
    expect(JSON.stringify(fakePi.appendedEntries.at(-1))).toContain('"stallTurns":0');
  });

  test("injects a stall reflection into context once the goal stalls", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    const beforeStall = await fakePi.emit("context", { messages: [] });
    for (let turn = 0; turn < STALL_REFLECT_TURNS; turn += 1) {
      await fakePi.emit("turn_end", { message: {} });
    }
    const afterStall = await fakePi.emit("context", { messages: [] });

    // Assert
    expect(JSON.stringify(beforeStall)).not.toContain("STALL CHECK");
    expect(JSON.stringify(afterStall)).toContain("STALL CHECK");
    expect(JSON.stringify(afterStall)).toContain("pi-goal-stall");
  });

  test("injects goal context on model context events", async () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const fakePi = createFakePi();
    registerGoalExtension(fakePi.pi, fakeRuntime());
    await fakePi.runCommand("goal", "finish migration until tests pass");

    // Act
    const result = await fakePi.emit("context", { messages: [] });

    // Assert
    expect(JSON.stringify(result)).toContain("PI GOAL ACTIVE");
  });
});
