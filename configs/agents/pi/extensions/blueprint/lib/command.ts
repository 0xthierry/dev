import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseBlueprintCommandArgs } from "./args";
import {
  formatBlueprintList,
  formatBlueprintRunSummary,
  formatBlueprintWorkflow,
  resolveBlueprintSelection,
} from "./format";
import { publishBlueprintProgressMessage } from "./progress-message";
import type { BlueprintRuntime } from "./runtime";
import type { PiThinkingLevel } from "./thinking";

export async function handleBlueprintCommand(
  pi: ExtensionAPI,
  runtime: BlueprintRuntime,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parsed = parseBlueprintCommandArgs(args);
  if (parsed.mode === "error") {
    ctx.ui.notify(parsed.message, "error");
    return;
  }

  const discovery = await runtime.discoverBlueprints(ctx.cwd);
  if (parsed.mode === "list") {
    ctx.ui.notify(formatBlueprintList(discovery), "info");
    return;
  }

  const selection = resolveBlueprintSelection(discovery, parsed.selection);
  if (!selection.ok) {
    ctx.ui.notify(selection.message, "error");
    return;
  }

  await ctx.waitForIdle();
  ctx.ui.setStatus("blueprint", `blueprint: ${selection.blueprint.name}`);
  ctx.ui.setWidget(
    "blueprint",
    formatBlueprintWorkflow(
      {
        runId: "pending",
        runDir: "(pending)",
        status: "running",
        currentNodeId: selection.blueprint.definition.start,
        message: `Starting blueprint ${selection.blueprint.id}.`,
        results: [],
      },
      selection.blueprint,
      parsed.task,
    ),
    { placement: "belowEditor" },
  );

  try {
    const result = await runtime.runBlueprint(
      {
        blueprint: selection.blueprint,
        task: parsed.task,
        cwd: ctx.cwd,
        signal: ctx.signal,
        modelRef: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
        thinking: pi.getThinkingLevel?.() as PiThinkingLevel | undefined,
      },
      (progress) => {
        const current = progress.currentNodeId ? ` · ${progress.currentNodeId}` : "";
        ctx.ui.setStatus("blueprint", `blueprint: ${progress.status}${current}`);
        ctx.ui.setWidget("blueprint", formatBlueprintWorkflow(progress, selection.blueprint, parsed.task), {
          placement: "belowEditor",
        });
        publishBlueprintProgressMessage(pi, selection.blueprint, parsed.task, progress);
      },
    );

    const summary = formatBlueprintRunSummary(result);
    ctx.ui.setStatus("blueprint", result.status === "succeeded" ? "blueprint: done" : "blueprint: failed");
    ctx.ui.setWidget("blueprint", formatBlueprintWorkflow(result, selection.blueprint, parsed.task), {
      placement: "belowEditor",
    });
    ctx.ui.notify(summary, result.status === "succeeded" ? "info" : "error");
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
    ctx.ui.setStatus("blueprint", "blueprint: failed");
    ctx.ui.setWidget("blueprint", [`Blueprint failed: ${message}`], { placement: "belowEditor" });
    ctx.ui.notify(`Blueprint failed: ${message}`, "error");
  }
}
