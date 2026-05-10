import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseBlueprintCommandArgs } from "./args";
import { formatBlueprintList, formatBlueprintRunSummary, resolveBlueprintSelection } from "./format";
import {
  type BlueprintProgressMessageHandle,
  createBlueprintProgressMessageHandle,
  publishBlueprintProgressMessage,
} from "./progress-message";
import type { BlueprintRuntime } from "./runtime";
import type { PiThinkingLevel } from "./thinking";
import type { BlueprintRunProgress } from "./types";

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

  let progressHandle: BlueprintProgressMessageHandle | undefined;
  let lastProgress: BlueprintRunProgress | undefined;
  const publishOrUpdateProgress = (progress: BlueprintRunProgress) => {
    lastProgress = progress;
    if (!progressHandle) {
      progressHandle = createBlueprintProgressMessageHandle(pi, selection.blueprint, parsed.task, progress);
      progressHandle.publish();
    } else {
      progressHandle.update(progress);
    }

    // Custom command messages are immutable transcript entries, so the live renderer reads the
    // mutated details object and this no-op status clear asks the TUI to repaint without adding
    // footer chrome or a new chat card for every progress event.
    ctx.ui.setStatus("blueprint", undefined);
  };

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
      publishOrUpdateProgress,
    );

    const summary = formatBlueprintRunSummary(result);
    if (progressHandle) progressHandle.finish(result);
    publishBlueprintProgressMessage(pi, selection.blueprint, parsed.task, result);
    ctx.ui.setStatus("blueprint", undefined);
    if (result.status !== "succeeded") ctx.ui.notify(summary, "error");
  } catch (error) {
    const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
    if (progressHandle && lastProgress) {
      const failedProgress: BlueprintRunProgress = {
        ...lastProgress,
        status: "failed",
        message: `Blueprint failed: ${message}`,
        activeNode: undefined,
      };
      progressHandle.finish(failedProgress);
      publishBlueprintProgressMessage(pi, selection.blueprint, parsed.task, failedProgress);
    }
    ctx.ui.setStatus("blueprint", undefined);
    ctx.ui.notify(`Blueprint failed: ${message}`, "error");
  }
}
