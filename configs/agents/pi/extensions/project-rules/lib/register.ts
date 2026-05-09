import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { findRuleReadActivation, planPathActivations, planPromptActivations } from "./activation";
import {
  formatActivationMessage,
  formatProjectRulesSystemPrompt,
  formatRuleActivationContext,
  formatRulesCommand,
} from "./format";
import { normalizeRulePath } from "./glob";
import { createProjectRulesRuntime, type ProjectRulesRuntime } from "./runtime";
import type { ProjectRule, RuleActivation, RuleActivationReason } from "./types";

const MESSAGE_TYPE = "project-rules";

export function registerProjectRulesExtension(pi: ExtensionAPI): void {
  registerProjectRulesHandlers(pi, createProjectRulesRuntime());
}

export function registerProjectRulesHandlers(pi: ExtensionAPI, runtime: ProjectRulesRuntime): void {
  let projectRoot: string | undefined;
  let rules: ProjectRule[] = [];
  let diagnostics: string[] = [];
  let loadedCwd: string | undefined;
  let loadingCwd: string | undefined;
  let loadingToken: object | undefined;
  let loading: Promise<void> | undefined;
  const activeRuleKeys = new Set<string>();
  const deliveredRuleKeys = new Set<string>();
  const pendingReadRuleKeys = new Set<string>();
  const pendingReadActivationsByToolCall = new Map<string, RuleActivation[]>();
  const activationReasons = new Map<string, RuleActivationReason>();
  const activationOrder: string[] = [];
  const seenPaths = new Set<string>();

  async function loadRules(cwd: string): Promise<void> {
    while (true) {
      if (loadedCwd === cwd && !loading) return;
      if (loadingCwd === cwd && loading) {
        await loading;
        continue;
      }
      if (loading) {
        const inFlight = loading;
        const inFlightCwd = loadingCwd;
        try {
          await inFlight;
        } catch (error) {
          if (inFlightCwd === cwd) throw error;
        }
        continue;
      }

      const token = {};
      loadedCwd = cwd;
      loadingCwd = cwd;
      loadingToken = token;
      loading = Promise.resolve()
        .then(() => runtime.discover(cwd))
        .then((result) => {
          if (loadingToken !== token || loadedCwd !== cwd) return;
          projectRoot = result.projectRoot;
          rules = result.rules;
          diagnostics = result.diagnostics;
          activeRuleKeys.clear();
          deliveredRuleKeys.clear();
          pendingReadRuleKeys.clear();
          pendingReadActivationsByToolCall.clear();
          activationReasons.clear();
          activationOrder.length = 0;
          seenPaths.clear();
        })
        .catch((error) => {
          if (loadingToken === token) {
            loadedCwd = undefined;
            throw error;
          }
        })
        .finally(() => {
          if (loadingToken === token) {
            loading = undefined;
            loadingCwd = undefined;
            loadingToken = undefined;
          }
        });
      await loading;
    }
  }

  function projectRelativePath(cwd: string, path: string): string {
    const normalized = normalizeRulePath(path);
    if (!normalized || normalized.startsWith("http")) return normalized;

    const absolutePath = isAbsolute(path) ? path : resolve(cwd, normalized);
    const root = projectRoot ?? cwd;
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) return relativePath;
    return normalized;
  }

  function withProjectRelativeReason(activation: RuleActivation, cwd: string): RuleActivation {
    const reason = activation.reason;
    if (reason.kind === "path") {
      return { ...activation, reason: { ...reason, path: projectRelativePath(cwd, reason.path) } };
    }
    if (reason.kind === "read") {
      return { ...activation, reason: { ...reason, path: projectRelativePath(cwd, reason.path) } };
    }
    return activation;
  }

  function recordActivations(activations: RuleActivation[], options: { delivered?: boolean } = {}): void {
    for (const activation of activations) {
      if (!activeRuleKeys.has(activation.rule.key)) {
        activationOrder.push(activation.rule.key);
      }
      activeRuleKeys.add(activation.rule.key);
      if (!activationReasons.has(activation.rule.key)) {
        activationReasons.set(activation.rule.key, activation.reason);
      }
      if (options.delivered) {
        deliveredRuleKeys.add(activation.rule.key);
      }
    }
  }

  function collectUndeliveredActiveRuleActivations(): RuleActivation[] {
    const rulesByKey = new Map(rules.map((rule) => [rule.key, rule]));
    const activations: RuleActivation[] = [];
    for (const key of activationOrder) {
      if (!activeRuleKeys.has(key) || deliveredRuleKeys.has(key) || pendingReadRuleKeys.has(key)) continue;
      const rule = rulesByKey.get(key);
      const reason = activationReasons.get(key);
      // Always rule bodies live in the stable system prompt so they stay before dynamic user prompts for caching.
      if (!rule || !reason || rule.mode === "always") continue;
      activations.push({ rule, reason });
    }
    return activations;
  }

  function markRuleContextDelivered(activations: RuleActivation[]): void {
    for (const activation of activations) {
      deliveredRuleKeys.add(activation.rule.key);
    }
  }

  function releasePendingReadActivations(): void {
    for (const activations of pendingReadActivationsByToolCall.values()) {
      for (const activation of activations) {
        pendingReadRuleKeys.delete(activation.rule.key);
      }
    }
    pendingReadActivationsByToolCall.clear();
  }

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    await loadRules(ctx.cwd);
    if (ctx.hasUI && rules.length > 0) {
      ctx.ui?.notify?.(`Discovered ${rules.length} project rule(s).`, "info");
    }
    if (ctx.hasUI) {
      for (const diagnostic of diagnostics) {
        ctx.ui?.notify?.(diagnostic, "warning");
      }
    }
  });

  pi.on("session_compact", async () => {
    deliveredRuleKeys.clear();
  });

  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
    await loadRules(ctx.cwd);
    releasePendingReadActivations();

    const prompt = event.prompt;
    const plan = planPromptActivations(rules, prompt, seenPaths, activeRuleKeys, (path) =>
      projectRelativePath(ctx.cwd, path),
    );
    const promptActivations = plan.newActivations.map((activation) => withProjectRelativeReason(activation, ctx.cwd));
    recordActivations(promptActivations);
    notifyActivation(ctx, promptActivations);

    const contextActivations = collectUndeliveredActiveRuleActivations();
    markRuleContextDelivered(contextActivations);

    const catalog = formatProjectRulesSystemPrompt(rules);
    if (!catalog && contextActivations.length === 0) return undefined;

    const result: BeforeAgentStartEventResult = {};

    if (catalog) {
      result.systemPrompt = `${event.systemPrompt}\n\n${catalog}`;
    }

    if (contextActivations.length > 0) {
      result.message = ruleContextMessage(contextActivations);
    }

    return result;
  });

  pi.on("turn_end", async () => {
    releasePendingReadActivations();
  });

  pi.on("agent_end", async () => {
    releasePendingReadActivations();
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    await loadRules(ctx.cwd);

    const newlyActivated: RuleActivation[] = [];

    for (const rawPath of extractToolPaths(event.input)) {
      const rulePath = projectRelativePath(ctx.cwd, rawPath);
      seenPaths.add(rulePath);

      if (event.toolName === "read") {
        const readActivation = findRuleReadActivation(rules, ctx.cwd, rawPath, new Set(), projectRoot);
        if (readActivation) {
          const displayActivation = withProjectRelativeReason(readActivation, ctx.cwd);
          const wasActive = activeRuleKeys.has(displayActivation.rule.key);
          if (!wasActive) {
            recordActivations([displayActivation]);
            newlyActivated.push(displayActivation);
          }
          if (typeof event.toolCallId === "string" && !deliveredRuleKeys.has(displayActivation.rule.key)) {
            pendingReadActivationsByToolCall.set(event.toolCallId, [displayActivation]);
            pendingReadRuleKeys.add(displayActivation.rule.key);
          }
          continue;
        }
      }

      const plan = planPathActivations(rules, rulePath, activeRuleKeys);
      const activations = plan.newActivations.map((activation) => withProjectRelativeReason(activation, ctx.cwd));
      recordActivations(activations);
      newlyActivated.push(...activations);
    }

    if (newlyActivated.length > 0) {
      notifyActivation(ctx, newlyActivated);
    }

    const contextActivations = collectUndeliveredActiveRuleActivations();
    if (contextActivations.length === 0) return;
    markRuleContextDelivered(contextActivations);
    pi.sendMessage(ruleContextMessage(contextActivations), { deliverAs: "steer" });
  });

  pi.on("tool_result", async (event: ToolResultEvent) => {
    if (event.toolName !== "read") return;
    const pendingActivations = pendingReadActivationsByToolCall.get(event.toolCallId);
    if (!pendingActivations) return;

    pendingReadActivationsByToolCall.delete(event.toolCallId);
    for (const activation of pendingActivations) {
      pendingReadRuleKeys.delete(activation.rule.key);
    }

    if (!event.isError) {
      markRuleContextDelivered(pendingActivations);
      return;
    }

    const undeliveredActivations = pendingActivations.filter(
      (activation) => !deliveredRuleKeys.has(activation.rule.key),
    );
    if (undeliveredActivations.length === 0) return;
    markRuleContextDelivered(undeliveredActivations);
    pi.sendMessage(ruleContextMessage(undeliveredActivations), { deliverAs: "steer" });
  });

  pi.registerCommand("rules", {
    description: "Show discovered project rules and activation status",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await loadRules(ctx.cwd);
      const content = formatRulesCommand(rules, activeRuleKeys);
      if (ctx.hasUI) {
        ctx.ui?.notify?.(content, "info");
        return;
      }
      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content,
        display: true,
        details: { activeRules: [...activeRuleKeys] },
      });
    },
  });
}

function ruleContextMessage(activations: RuleActivation[]) {
  return {
    customType: MESSAGE_TYPE,
    content: formatRuleActivationContext(activations),
    display: false,
    details: {
      rules: activations.map((activation) => activation.rule.relativePath),
      reasons: activations.map((activation) => activation.reason),
    },
  };
}

function notifyActivation(ctx: ExtensionContext, activations: RuleActivation[]): void {
  if (!ctx.hasUI || activations.length === 0) return;
  ctx.ui?.notify?.(formatActivationMessage(activations), "info");
}

function extractToolPaths(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];

  const value = input as Record<string, unknown>;
  return ["path", "file_path", "cwd", "directory"]
    .flatMap((key) => stringValues(value[key]))
    .filter((path) => path.trim().length > 0);
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
