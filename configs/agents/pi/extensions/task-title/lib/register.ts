import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatTaskTitle } from "./title";

function setTaskTitle(ctx: ExtensionContext, title: string | undefined): void {
  if (ctx.hasUI && title) ctx.ui.setTitle(title);
}

export function registerTaskTitleExtension(pi: ExtensionAPI): void {
  const queuedTitles: string[] = [];

  pi.on("input", (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const title = formatTaskTitle(event.text);
    if (event.streamingBehavior === "followUp") {
      if (title) queuedTitles.push(title);
      return { action: "continue" };
    }

    setTaskTitle(ctx, title);
    return { action: "continue" };
  });

  pi.on("before_agent_start", (_event, ctx) => {
    setTaskTitle(ctx, queuedTitles.shift());
  });
}
