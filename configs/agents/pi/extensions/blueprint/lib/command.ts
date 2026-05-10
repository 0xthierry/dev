import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseBlueprintCommandArgs } from "./args";
import { formatBlueprintList, formatBlueprintRunSummary, resolveBlueprintSelection } from "./format";
import { publishBlueprintProgressMessage } from "./progress-message";
import type { BlueprintRuntime } from "./runtime";
import type { PiThinkingLevel } from "./thinking";

export async function handleBlueprintCommand(
  pi: ExtensionAPI,
  runtime: BlueprintRuntime,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  ctx.ui.setWidget("blueprint", undefined);
  ctx.ui.setStatus("blueprint", undefined);

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
      undefined,
    );

    const summary = formatBlueprintRunSummary(result);
    publishBlueprintProgressMessage(pi, selection.blueprint, parsed.task, result);
    if (result.status !== "succeeded") ctx.ui.notify(summary, "error");
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
    ctx.ui.setStatus("blueprint", undefined);
    ctx.ui.notify(`Blueprint failed: ${message}`, "error");
  }
}
