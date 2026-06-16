import { describe, expect, test } from "bun:test";
import { createGoalState, userObjectiveToCreationInput } from "./goal-state";
import { activeGoalContextPrompt, buildAuditorPrompt, continuationPrompt, pausedGoalToolNotice } from "./prompts";

describe("goal prompts", () => {
  test("injects active goal as user-provided data", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = activeGoalContextPrompt(goal);

    // Assert
    expect(result).toContain("user-provided task data");
    expect(result).toContain("<untrusted_goal_contract>");
    expect(result).toContain("independent auditor");
  });

  test("warns that goal state is a snapshot and must be verified with get_goal", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = activeGoalContextPrompt(goal);

    // Assert
    expect(result).toContain("point-in-time snapshot");
    expect(result).toContain("call get_goal");
  });

  test("post-compaction reminder tells the model to re-confirm with get_goal", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = activeGoalContextPrompt(goal, { postCompactionReminder: true });

    // Assert
    expect(result).toContain("POST-COMPACTION GOAL REMINDER");
    expect(result).toContain("call get_goal to confirm the goal is still active");
  });

  test("tells the model to stop and report honestly when the goal is paused", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1"),
      status: "paused" as const,
      lastUpdate: "Auto-paused after 16 turns without substantive state change.",
      stallTurns: 16,
    };

    // Act
    const context = activeGoalContextPrompt(goal);
    const notice = pausedGoalToolNotice(goal);

    // Assert
    expect(context).toContain("This is a stop signal");
    expect(context).toContain(
      "Exception: if the current user instruction explicitly asks you to update the paused goal state",
    );
    expect(context).toContain("Automatic pause mechanism");
    expect(context).toContain("The stall guard triggers after repeated turns without substantive state change");
    expect(context).toContain("your task now is to reflect and report");
    expect(context).toContain("Do real introspection, not a checklist apology");
    expect(context).toContain("Reconstruct the causal chain from concrete events in this session");
    expect(context).toContain("what evidence you already had, what uncertainty remained, what decision you avoided");
    expect(context).toContain("Infer what context influenced you from the actual events");
    expect(context).toContain("Separate what you know from what you are guessing");
    expect(context).not.toContain("conversation history, audit feedback");
    expect(context).not.toContain("project complexity");
    expect(context).not.toContain("mixed deliverable-vs-workflow requirements");
    expect(context).not.toContain("goal/prompt overfitting toward validation");
    expect(context).toContain("16 stalled turn(s)");
    expect(context).toContain("what you should have done differently");
    expect(context).toContain("Suggest the next concrete task");
    expect(context).not.toContain("continue concrete work toward");
    expect(notice).toContain("Stop now");
    expect(notice).toContain("If the user explicitly asked you to update the paused goal state itself");
    expect(notice).toContain("do real introspection");
    expect(notice).toContain("reconstruct the causal chain from concrete session events");
    expect(notice).toContain("separate known causes from guesses");
    expect(notice).toContain("suggest the next task only as a proposal");
    expect(notice).toContain("stallTurns=16");
  });

  test("builds a compact continuation prompt without duplicating the contract", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = continuationPrompt(goal);

    // Assert
    expect(result).toContain("Continue concrete work");
    expect(result).toContain("pi-goal-context");
    expect(result).not.toContain("<untrusted_goal_contract>");
    expect(result).not.toContain("finish migration until tests pass");
  });

  test("copies skeptical auditor marker requirements", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = buildAuditorPrompt({
      goal,
      completionClaim: { summary: "done", evidenceRefs: ["bun test"], claimedAt: "2026-01-01T00:00:00.000Z" },
      detailedSummary: "summary",
    });

    // Assert
    expect(result).toContain("<approved/>");
    expect(result).toContain("<disapproved/>");
    expect(result).toContain("primary session intent");
    expect(result).toContain("deliverable requirements, workflow/process instructions, or evidence expectations");
    expect(result).toContain("Treat workflow/process evidence gaps proportionally");
    expect(result).toContain("Disapprove if any deliverable requirement is missing");
  });
});
