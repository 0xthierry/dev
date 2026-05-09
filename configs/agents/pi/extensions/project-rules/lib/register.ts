import type {
  BeforeAgentStartEvent,
  BeforeAgentStartEventResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { findRuleReadActivation, markActivations, planPathActivations, planPromptActivations } from "./activation";
import {
  formatActivationMessage,
  formatProjectRulesSystemPrompt,
  formatRuleActivationContext,
  formatRulesCommand,
} from "./format";
import { createProjectRulesRuntime, type ProjectRulesRuntime } from "./runtime";
import type { ProjectRule, RuleActivation } from "./types";

const MESSAGE_TYPE = "project-rules";

export function registerProjectRulesExtension(pi: ExtensionAPI): void {
  registerProjectRulesHandlers(pi, createProjectRulesRuntime());
}

export function registerProjectRulesHandlers(pi: ExtensionAPI, runtime: ProjectRulesRuntime): void {
  let rules: ProjectRule[] = [];
  let diagnostics: string[] = [];
  let loadedCwd: string | undefined;
  let loading: Promise<void> | undefined;
  const activeRuleKeys = new Set<string>();
  const seenPaths = new Set<string>();

  async function loadRules(cwd: string): Promise<void> {
    if (loadedCwd === cwd && !loading) return;
    if (loadedCwd === cwd && loading) return loading;

    loadedCwd = cwd;
    loading = runtime.discover(cwd).then((result) => {
      rules = result.rules;
      diagnostics = result.diagnostics;
      activeRuleKeys.clear();
      seenPaths.clear();
      loading = undefined;
    });
    return loading;
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

  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
    await loadRules(ctx.cwd);

    const prompt = event.prompt;
    const plan = planPromptActivations(rules, prompt, seenPaths, activeRuleKeys);
    markActivations(activeRuleKeys, plan.newActivations);

    const systemPromptAddition = formatProjectRulesSystemPrompt(rules, activeRuleKeys);
    if (!systemPromptAddition && plan.newActivations.length === 0) return undefined;

    const result: BeforeAgentStartEventResult = {};

    if (systemPromptAddition) {
      result.systemPrompt = `${event.systemPrompt}\n\n${systemPromptAddition}`;
    }

    if (plan.newActivations.length > 0) {
      result.message = activationMessage(plan.newActivations);
    }

    return result;
  });

  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    await loadRules(ctx.cwd);

    for (const path of extractToolPaths(event.input)) {
      seenPaths.add(path);

      if (event.toolName === "read") {
        const readActivation = findRuleReadActivation(rules, ctx.cwd, path, activeRuleKeys);
        if (readActivation) {
          markActivations(activeRuleKeys, [readActivation]);
          notifyActivation(ctx, [readActivation]);
          continue;
        }
      }

      const plan = planPathActivations(rules, path, activeRuleKeys);
      if (plan.newActivations.length === 0) continue;
      markActivations(activeRuleKeys, plan.newActivations);
      notifyActivation(ctx, plan.newActivations);
      pi.sendMessage(activationMessageWithContext(plan.newActivations), { deliverAs: "steer" });
    }
  });

  pi.registerCommand("rules", {
    description: "Show discovered project rules and activation status",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await loadRules(ctx.cwd);
      pi.sendMessage({
        customType: MESSAGE_TYPE,
        content: formatRulesCommand(rules, activeRuleKeys),
        display: true,
        details: { activeRules: [...activeRuleKeys] },
      });
    },
  });
}

function activationMessage(activations: RuleActivation[]) {
  return {
    customType: MESSAGE_TYPE,
    content: formatActivationMessage(activations),
    display: true,
    details: { rules: activations.map((activation) => activation.rule.relativePath) },
  };
}

function activationMessageWithContext(activations: RuleActivation[]) {
  return {
    customType: MESSAGE_TYPE,
    content: formatRuleActivationContext(activations),
    display: true,
    details: { rules: activations.map((activation) => activation.rule.relativePath) },
  };
}

function notifyActivation(ctx: ExtensionContext, activations: RuleActivation[]): void {
  if (!ctx.hasUI) return;
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
