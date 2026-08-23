import { z } from "zod";
import type { DirectBrokerElicitationRequest, DirectBrokerElicitationResponse } from "../broker/direct-broker";

const jsonObjectSchema = z.record(z.string(), z.json());

export interface PiElicitationContext {
  hasUI: boolean;
  ui: {
    select(title: string, options: string[]): Promise<string | undefined>;
    editor(title: string, prefill?: string): Promise<string | undefined>;
    notify(message: string, type?: "info" | "warning" | "error"): void;
  };
}

export async function handleOfficialElicitation(
  request: DirectBrokerElicitationRequest,
  ctx: PiElicitationContext,
  openUrl: (url: string) => Promise<boolean>,
): Promise<DirectBrokerElicitationResponse> {
  if (!ctx.hasUI) return { action: "cancel" };
  const message = request.message ?? "Official Computer Use requests input";

  if (request.mode === "url") {
    if (!request.url) return { action: "cancel" };
    const choice = await ctx.ui.select(`${message}\n${request.url}`, ["Open URL", "Decline", "Cancel"]);
    if (choice === "Decline") return { action: "decline" };
    if (choice !== "Open URL") return { action: "cancel" };
    if (!(await openUrl(request.url))) {
      ctx.ui.notify("Could not open the official Computer Use URL.", "error");
      return { action: "cancel" };
    }
    return { action: "accept" };
  }

  if (request.mode !== undefined && request.mode !== "form" && request.mode !== "openai/form") {
    ctx.ui.notify(`Official Computer Use sent an unsupported elicitation mode: ${request.mode}`, "warning");
    return { action: "cancel" };
  }
  const openAiForm = request.mode === "openai/form";
  if (
    request.requestedSchema === undefined ||
    (!openAiForm && !jsonObjectSchema.safeParse(request.requestedSchema).success)
  ) {
    return { action: "cancel" };
  }
  const choice = await ctx.ui.select(message, ["Respond", "Decline", "Cancel"]);
  if (choice === "Decline") return { action: "decline" };
  if (choice !== "Respond") return { action: "cancel" };
  const title = `${message}\nSchema: ${JSON.stringify(request.requestedSchema)}`;
  let prefill = "{}";
  while (true) {
    const edited = await ctx.ui.editor(title, prefill);
    if (edited === undefined) return { action: "cancel" };
    prefill = edited;
    try {
      const parsed = z.json().parse(JSON.parse(edited));
      const content = openAiForm ? parsed : jsonObjectSchema.parse(parsed);
      return { action: "accept", content };
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : "Response must be valid JSON", "error");
    }
  }
}
