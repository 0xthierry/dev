import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { tokenDeltaFromUsage } from "./accounting";
import { runGoalCompletionAuditor } from "./auditor";
import { GOAL_COMMAND_COMPLETIONS, parseGoalCommand } from "./command";
import { createGoalState, goalSummary, userObjectiveToCreationInput } from "./goal-state";
import {
  applyTurnLimit,
  isRunnable,
  validateGoalCreation,
  validateUpdateGoalBlocked,
  validateUpdateGoalComplete,
} from "./policy";
import { isMeaningfulProgressToolCall, shouldBlockAfterStop } from "./progress";
import { activeGoalContextPrompt, continuationPrompt } from "./prompts";
import { latestGoalFromEntries, stateEntry } from "./store";
import {
  type CompletionClaim,
  GOAL_AUDIT_MESSAGE,
  GOAL_CONTEXT_MESSAGE,
  GOAL_EVENT_MESSAGE,
  GOAL_STATE_ENTRY,
  type GoalAuditorRunInput,
  type GoalAuditorRunResult,
  type GoalCreationInput,
  type GoalState,
} from "./types";
import { formatGoalAuditorStatus, formatGoalDetails, formatGoalStatus } from "./ui";

export interface GoalRuntime {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
  runAuditor: (ctx: ExtensionContext, input: GoalAuditorRunInput) => Promise<GoalAuditorRunResult>;
}

export function createGoalRuntime(): GoalRuntime {
  return {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (timer) => clearTimeout(timer),
    runAuditor: runGoalCompletionAuditor,
  };
}

export function registerGoalExtension(pi: ExtensionAPI, runtime: GoalRuntime = createGoalRuntime()): void {
  let goal: GoalState | null = null;
  let meaningfulProgressThisTurn = false;
  let meaningfulProgressSinceAgentStart = false;
  let lifecycleToolSeenThisTurn = false;
  let continuationQueued = false;
  let continuationTimer: ReturnType<typeof setTimeout> | null = null;
  let forceNextContinuation = false;
  let postCompactionReminderPending = false;

  const persist = (ctx: ExtensionContext, next: GoalState | null): void => {
    goal = next;
    pi.appendEntry(GOAL_STATE_ENTRY, stateEntry(goal));
    updateUi(ctx);
  };

  const updateUi = (ctx: ExtensionContext): void => {
    if (!ctx.hasUI) return;
    ctx.ui.setStatus("goal", formatGoalStatus(goal));
    ctx.ui.setWidget("goal", undefined);
  };

  const clearContinuationTimer = (): void => {
    if (!continuationTimer) return;
    runtime.clearTimeout(continuationTimer);
    continuationTimer = null;
  };

  const queueContinuation = (ctx: ExtensionContext, force = false): void => {
    if (!goal || !isRunnable(goal)) return;
    if (!force && continuationQueued) return;
    if (!force && !forceNextContinuation && !meaningfulProgressSinceAgentStart) return;
    forceNextContinuation = false;
    continuationQueued = true;
    clearContinuationTimer();

    const trySend = (): void => {
      continuationTimer = null;
      if (!goal || !isRunnable(goal)) {
        continuationQueued = false;
        return;
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        continuationTimer = runtime.setTimeout(trySend, 50);
        return;
      }
      const now = new Date().toISOString();
      const next = { ...goal, lastContinuationAt: now, updatedAt: now };
      persist(ctx, next);
      pi.sendMessage(
        {
          customType: GOAL_EVENT_MESSAGE,
          content: continuationPrompt(next),
          display: false,
          details: { kind: "continuation", goalId: next.id, status: next.status },
        },
        { triggerTurn: true, deliverAs: "followUp" },
      );
      continuationQueued = false;
    };

    continuationTimer = runtime.setTimeout(trySend, 0);
  };

  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description:
      "Read the authoritative current Pi goal state. The user can create, pause, resume, clear, or replace the goal at any time, and those changes never appear in the conversation, so this tool — not your memory or an earlier turn — is the source of truth for whether a goal exists and what its status is.",
    promptSnippet: "Read the authoritative current Pi goal state",
    promptGuidelines: [
      "Call get_goal before stating whether a goal exists or is active, paused, blocked, or complete. Never answer from memory or from the fact that you created one earlier.",
      "Always call get_goal when the user asks about the goal, and when resuming, after compaction, or after any interruption.",
      "The injected goal contract is a point-in-time snapshot. If the current turn has no injected goal context, do not assume the goal is still active — verify with get_goal.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      return { content: [{ type: "text", text: JSON.stringify({ goal }, null, 2) }], details: { goal } };
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description:
      "Create an active persistent Pi goal. Use only when explicitly requested by user/system/developer instructions for autonomous persistent work; do not infer goals from ordinary tasks.",
    promptSnippet: "Create a persistent autonomous Pi goal when explicitly requested",
    promptGuidelines: [
      "Use create_goal only when the user explicitly asks for autonomous, persistent, long-running, multi-turn work, or system/developer instructions explicitly authorize goal creation.",
      "Do not create goals for normal one-shot questions or ordinary code edits.",
      "Before creating, call get_goal to confirm the live state. Only one unfinished goal can exist at a time, and the current state — not your memory of a goal you may have created earlier — decides whether creation is allowed.",
      "Before creating a goal for work in this codebase, inspect the relevant source, tests, and docs first so the objective and verifier name the real file paths and the exact verification command, not generic 'locate the implementation' placeholders.",
      "create_goal requires concrete success criteria, a verification plan, constraints, and expected evidence. Write a verifier that can actually fail and is observable outside this conversation — name the exact command, test, file, or artifact; criteria satisfied by stopping, intent, or partial/scaffold work are not acceptable.",
      "Leave turnBudget unset unless the user explicitly asks for a turn limit. Do not invent a budget on your own.",
    ],
    parameters: Type.Object(
      {
        objective: Type.String({ description: "Concise but complete canonical objective." }),
        successCriteria: Type.Array(Type.String(), { description: "Explicit verifiable completion criteria." }),
        verificationPlan: Type.Array(Type.String(), {
          description: "How completion should be verified against real current state.",
        }),
        constraints: Type.Array(Type.String(), { description: "Hard constraints and boundaries." }),
        evidenceSurface: Type.Array(Type.String(), {
          description: "Artifacts, commands, files, test results, or other evidence expected.",
        }),
        autoContinue: Type.Optional(
          Type.Boolean({ description: "Whether Pi should continue automatically. Defaults to true." }),
        ),
        turnBudget: Type.Optional(
          Type.Number({
            description: "Positive turn limit. Leave unset unless the user explicitly asks for one; defaults to 512.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input: GoalCreationInput = {
        objective: params.objective,
        successCriteria: params.successCriteria,
        verificationPlan: params.verificationPlan,
        constraints: params.constraints,
        evidenceSurface: params.evidenceSurface,
        autoContinue: params.autoContinue ?? true,
        turnBudget: params.turnBudget,
      };
      const validation = validateGoalCreation(input, goal);
      if (!validation.ok)
        return { content: [{ type: "text", text: `create_goal rejected: ${validation.message}` }], details: { goal } };
      const next = createGoalState(input);
      persist(ctx, next);
      forceNextContinuation = true;
      queueContinuation(ctx, true);
      return { content: [{ type: "text", text: `Goal created.\n\n${goalSummary(next)}` }], details: { goal: next } };
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description:
      "Submit a completion claim for mandatory audit, or mark the current goal genuinely blocked. Only complete and blocked are accepted.",
    promptSnippet: "Update a Pi goal as complete or blocked",
    promptGuidelines: [
      "Use update_goal with status=complete only when the current goal is actually achieved and evidence is ready for independent audit.",
      "Completion is not terminal until the independent auditor returns exactly <approved/>.",
      "Use update_goal with status=blocked only for a genuine impasse, not because work is hard, slow, uncertain, or incomplete.",
    ],
    parameters: Type.Object(
      {
        status: StringEnum(["complete", "blocked"] as const),
        summary: Type.String({ description: "Completion claim summary, or blocked summary." }),
        evidenceRefs: Type.Optional(
          Type.Array(Type.String(), { description: "Concrete evidence references inspected or blocker evidence." }),
        ),
        blockedReason: Type.Optional(Type.String({ description: "Required when status=blocked." })),
        suggestedUserAction: Type.Optional(Type.String({ description: "Required when status=blocked." })),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (params.status === "blocked") {
        const validation = validateUpdateGoalBlocked({
          goal,
          reason: params.blockedReason ?? params.summary,
          evidenceRefs: params.evidenceRefs,
          suggestedUserAction: params.suggestedUserAction,
        });
        if (!validation.ok)
          return {
            content: [{ type: "text", text: `update_goal blocked rejected: ${validation.message}` }],
            details: { goal },
          };
        if (!goal) throw new Error("Goal disappeared during blocked validation.");
        const now = new Date().toISOString();
        const next: GoalState = {
          ...goal,
          status: "blocked",
          autoContinue: false,
          updatedAt: now,
          lastUpdate: params.summary.trim(),
          blockedReason: (params.blockedReason ?? params.summary).trim(),
          suggestedUserAction: params.suggestedUserAction?.trim() ?? null,
          evidenceRefs: params.evidenceRefs?.map((ref) => ref.trim()).filter(Boolean) ?? goal.evidenceRefs,
        };
        persist(ctx, next);
        lifecycleToolSeenThisTurn = true;
        return {
          content: [{ type: "text", text: `Goal blocked.\n\n${goalSummary(next)}` }],
          details: { goal: next },
          terminate: true,
        };
      }

      const validation = validateUpdateGoalComplete(goal, params.summary);
      if (!validation.ok)
        return {
          content: [{ type: "text", text: `update_goal complete rejected: ${validation.message}` }],
          details: { goal },
        };
      if (!goal) throw new Error("Goal disappeared during completion validation.");
      const claim: CompletionClaim = {
        summary: params.summary.trim(),
        evidenceRefs: params.evidenceRefs?.map((ref) => ref.trim()).filter(Boolean) ?? [],
        claimedAt: new Date().toISOString(),
      };
      const auditTarget: GoalState = {
        ...goal,
        completionClaim: claim,
        auditAttempts: goal.auditAttempts + 1,
        updatedAt: claim.claimedAt,
        lastUpdate: "Completion claim submitted for audit.",
        evidenceRefs: claim.evidenceRefs,
      };
      persist(ctx, auditTarget);
      pi.sendMessage({
        customType: GOAL_AUDIT_MESSAGE,
        content: `Starting independent goal audit for ${auditTarget.id}.`,
        display: true,
        details: { phase: "started", goalId: auditTarget.id },
      });
      const auditor = await runtime.runAuditor(ctx, {
        goal: auditTarget,
        completionClaim: claim,
        detailedSummary: goalSummary(auditTarget),
        signal,
      });
      const verdict = auditor.approved ? "approved" : auditor.error ? "error" : "disapproved";
      const now = new Date().toISOString();
      const auditResult = {
        verdict,
        report: auditor.output || "Auditor produced no output.",
        at: now,
        model: auditor.model,
        error: auditor.error,
      } as const;
      const auditedCurrent = goal?.id === auditTarget.id ? goal : auditTarget;
      if (!auditor.approved) {
        const next: GoalState = {
          ...auditedCurrent,
          status: auditedCurrent.auditAttempts >= 3 ? "paused_for_failed_audit" : "active",
          autoContinue: auditedCurrent.auditAttempts >= 3 ? false : auditedCurrent.autoContinue,
          updatedAt: now,
          lastUpdate: "Independent auditor rejected the completion claim.",
          completionClaim: claim,
          auditAttempts: auditTarget.auditAttempts,
          auditResults: [...auditedCurrent.auditResults, auditResult],
        };
        persist(ctx, next);
        pi.sendMessage({
          customType: GOAL_AUDIT_MESSAGE,
          content: auditResult.report,
          display: true,
          details: { phase: "rejected", goalId: next.id, verdict },
        });
        lifecycleToolSeenThisTurn = true;
        return {
          content: [{ type: "text", text: `Goal audit rejected. Goal remains unfinished.\n\n${auditResult.report}` }],
          details: { goal: next },
          terminate: true,
        };
      }

      const next: GoalState = {
        ...auditedCurrent,
        status: "complete",
        autoContinue: false,
        updatedAt: now,
        lastUpdate: "Independent auditor approved completion.",
        completionClaim: claim,
        auditAttempts: auditTarget.auditAttempts,
        auditResults: [...auditedCurrent.auditResults, auditResult],
      };
      persist(ctx, next);
      pi.sendMessage({
        customType: GOAL_AUDIT_MESSAGE,
        content: auditResult.report,
        display: true,
        details: { phase: "approved", goalId: next.id, verdict },
      });
      lifecycleToolSeenThisTurn = true;
      return {
        content: [{ type: "text", text: `Goal complete after auditor approval.\n\n${goalSummary(next)}` }],
        details: { goal: next },
        terminate: true,
      };
    },
  });

  const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void => {
    if (ctx.hasUI) ctx.ui.notify(message, type);
  };

  pi.registerCommand("goal", {
    description: "Create, show, pause, resume, clear, or set turns for a persistent autonomous goal",
    getArgumentCompletions: (prefix) => {
      const matches = GOAL_COMMAND_COMPLETIONS.filter((value) => value.startsWith(prefix));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const command = parseGoalCommand(args);
      if (command.kind === "invalid") {
        notify(ctx, command.message, "warning");
        return;
      }

      if (command.kind === "status") {
        notify(ctx, formatGoalDetails(goal), "info");
        return;
      }
      if (command.kind === "auditor") {
        notify(ctx, formatGoalAuditorStatus(goal, ctx.model), "info");
        return;
      }
      if (command.kind === "clear") {
        if (!goal) {
          notify(ctx, "No goal is set.", "info");
          return;
        }
        persist(ctx, null);
        clearContinuationTimer();
        notify(ctx, "Goal cleared.", "info");
        return;
      }
      if (!goal && command.kind !== "create") {
        notify(ctx, "No goal is set.", "warning");
        return;
      }
      if (goal && command.kind === "pause") {
        const next: GoalState = {
          ...goal,
          status: "paused",
          autoContinue: false,
          updatedAt: new Date().toISOString(),
          lastUpdate: "Paused by user.",
        };
        persist(ctx, next);
        clearContinuationTimer();
        notify(ctx, `Goal paused.\n\n${formatGoalDetails(next)}`, "info");
        return;
      }
      if (goal && command.kind === "resume") {
        const next: GoalState = {
          ...goal,
          status: "active",
          autoContinue: true,
          updatedAt: new Date().toISOString(),
          lastUpdate: "Resumed by user.",
          consecutiveBlockedTurns: 0,
        };
        persist(ctx, next);
        notify(ctx, `Goal resumed.\n\n${formatGoalDetails(next)}`, "info");
        forceNextContinuation = true;
        queueContinuation(ctx, true);
        return;
      }
      if (goal && command.kind === "turns") {
        const next: GoalState = {
          ...goal,
          turnBudget: command.turns,
          updatedAt: new Date().toISOString(),
          lastUpdate: `Turn limit set to ${command.turns}.`,
        };
        persist(ctx, next);
        notify(ctx, `Goal turn limit set to ${command.turns}.`, "info");
        return;
      }
      if (command.kind === "create") {
        const input = userObjectiveToCreationInput(command.objective);
        const next = createGoalState(input);
        persist(ctx, next);
        notify(ctx, `Goal created.\n\n${formatGoalDetails(next)}`, "info");
        forceNextContinuation = true;
        queueContinuation(ctx, true);
      }
    },
  });

  pi.on("session_start", (event, ctx) => {
    goal = latestGoalFromEntries(ctx.sessionManager.getBranch());
    clearContinuationTimer();
    continuationQueued = false;
    meaningfulProgressThisTurn = false;
    meaningfulProgressSinceAgentStart = false;
    lifecycleToolSeenThisTurn = false;
    if (goal?.status === "active") {
      const next = {
        ...goal,
        status: "paused" as const,
        autoContinue: false,
        updatedAt: new Date().toISOString(),
        lastUpdate: `Paused safely after session ${event.reason}.`,
      };
      persist(ctx, next);
      notify(ctx, `Goal restored paused: ${next.objective}\nUse /goal resume to continue.`, "info");
      return;
    }
    updateUi(ctx);
  });

  pi.on("context", (event) => {
    if (!goal || goal.status === "complete") return;
    const prompt = activeGoalContextPrompt(goal, { postCompactionReminder: postCompactionReminderPending });
    postCompactionReminderPending = false;
    return {
      messages: [
        ...event.messages,
        {
          role: "custom",
          customType: GOAL_CONTEXT_MESSAGE,
          content: prompt,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });

  pi.on("agent_start", () => {
    meaningfulProgressSinceAgentStart = false;
  });

  pi.on("turn_start", () => {
    meaningfulProgressThisTurn = false;
    lifecycleToolSeenThisTurn = false;
  });

  pi.on("tool_call", (event) => {
    if (
      (lifecycleToolSeenThisTurn || event.toolName === "update_goal") &&
      event.toolName !== "update_goal" &&
      shouldBlockAfterStop(event.toolName)
    ) {
      return {
        block: true,
        reason:
          "A goal lifecycle tool was already called in this turn. Do not perform more mutating work; yield after the lifecycle update.",
      };
    }
    if (event.toolName === "update_goal") lifecycleToolSeenThisTurn = true;
    if (isMeaningfulProgressToolCall(event.toolName, event.input)) {
      meaningfulProgressThisTurn = true;
      meaningfulProgressSinceAgentStart = true;
    }
  });

  pi.on("turn_end", (event, ctx) => {
    if (!goal || goal.status !== "active") return;
    const now = new Date().toISOString();
    const messageWithUsage = event.message as { usage?: Parameters<typeof tokenDeltaFromUsage>[0] };
    const tokens = tokenDeltaFromUsage(messageWithUsage.usage);
    const blockedCount = meaningfulProgressThisTurn ? 0 : goal.consecutiveBlockedTurns + 1;
    const progressedAt = meaningfulProgressThisTurn ? now : goal.lastProgressAt;
    const accounted = applyTurnLimit(
      {
        ...goal,
        tokensUsed: goal.tokensUsed + tokens,
        turnsUsed: goal.turnsUsed + 1,
        consecutiveBlockedTurns: blockedCount,
        lastProgressAt: progressedAt,
        updatedAt: now,
      },
      now,
    );
    persist(ctx, accounted);
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!goal || goal.status !== "active" || !goal.autoContinue || ctx.hasPendingMessages()) return;
    queueContinuation(ctx);
  });

  pi.on("session_before_compact", (_event, ctx) => {
    if (goal) persist(ctx, goal);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (!goal || goal.status !== "active") return;
    postCompactionReminderPending = true;
    forceNextContinuation = true;
    queueContinuation(ctx, true);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (goal) persist(ctx, goal);
    clearContinuationTimer();
  });
}
