import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseBlueprintCommandArgs } from "./args";
import {
  formatBlueprintList,
  formatBlueprintProgress,
  formatBlueprintRunSummary,
  resolveBlueprintSelection,
} from "./format";
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
  ctx.ui.setWidget("blueprint", [`Starting blueprint ${selection.blueprint.id}...`], { placement: "belowEditor" });

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
        ctx.ui.setStatus("blueprint", `blueprint: ${progress.status}`);
        ctx.ui.setWidget("blueprint", formatBlueprintProgress(progress), { placement: "belowEditor" });
      },
    );

    const summary = formatBlueprintRunSummary(result);
    ctx.ui.setStatus("blueprint", result.status === "succeeded" ? "blueprint: done" : "blueprint: failed");
    ctx.ui.setWidget("blueprint", summary.split("\n"), { placement: "belowEditor" });
    ctx.ui.notify(summary, result.status === "succeeded" ? "info" : "error");
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
    ctx.ui.setStatus("blueprint", "blueprint: failed");
    ctx.ui.setWidget("blueprint", [`Blueprint failed: ${message}`], { placement: "belowEditor" });
    ctx.ui.notify(`Blueprint failed: ${message}`, "error");
  }
}
