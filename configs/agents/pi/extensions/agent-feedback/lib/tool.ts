import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { FeedbackCategory } from "./categories";
import {
  type FeedbackValidationError,
  formatFeedbackEntry,
  formatLocalTimestamp,
  type NormalizedFeedback,
  normalizeFeedbackInput,
} from "./feedback";
import type { AgentFeedbackRuntime } from "./runtime";
import { type AgentFeedbackParams, AgentFeedbackParamsSchema } from "./schema";

export const AGENT_FEEDBACK_TOOL_NAME = "agent_feedback";

export type AgentFeedbackToolError =
  | FeedbackValidationError
  | { code: "ABORTED"; message: string }
  | { code: "WRITE_FAILED"; message: string };

export interface AgentFeedbackToolDetails {
  ok: boolean;
  path?: string;
  timestamp?: string;
  category?: FeedbackCategory;
  feedback?: NormalizedFeedback;
  error?: AgentFeedbackToolError;
}

export function registerAgentFeedbackTool(pi: ExtensionAPI, runtime: AgentFeedbackRuntime): void {
  pi.registerTool<typeof AgentFeedbackParamsSchema, AgentFeedbackToolDetails>({
    name: AGENT_FEEDBACK_TOOL_NAME,
    label: "agent feedback",
    description:
      "Append structured agent workflow feedback and verification blockers to agent_feedback.md in the current working directory.",
    promptSnippet:
      "Record repeated workflow friction, validation blockers, environment gaps, or instruction/docs gaps as durable agent feedback.",
    promptGuidelines: [
      "agent_feedback: Use after attempting the task or validation when a concrete blocker or repeated/systemic workflow friction should become future automation, docs, environment setup, or instructions.",
      "agent_feedback: Use for verification blockers such as missing credentials, unavailable services, unsupported local environment, flaky checks, or insufficient setup instructions.",
      "agent_feedback: Use for repeated manual workarounds, project instructions that cause avoidable backtracking, or tooling output that forces the same retry sequence.",
      "agent_feedback: Do not use for one-off lint/type errors, ordinary coding mistakes, or as a substitute for finishing the task and running available validation.",
      "agent_feedback: Never include secrets, tokens, raw credential values, private keys, raw environment dumps, or sensitive user data; describe config names generically instead.",
      "agent_feedback: Call near the end of the turn and batch related feedback into one concise entry.",
      "agent_feedback: Still report blockers in the final response; this tool is durable feedback, not a replacement for the handoff.",
    ],
    parameters: AgentFeedbackParamsSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeAgentFeedbackTool(runtime, params, signal, ctx);
    },

    renderCall(args, theme) {
      const category = renderableCategory(args);
      const suffix = category ? ` ${category}` : "";
      return new Text(
        `${theme.fg("toolTitle", theme.bold(AGENT_FEEDBACK_TOOL_NAME))}${theme.fg("muted", suffix)}`,
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (!details?.ok) {
        const message = details?.error?.message ?? textContent(result) ?? "Feedback was not saved.";
        const expandedText = expanded ? `\n\n${message}` : "";
        return new Text(`${theme.fg("error", "✗")} feedback not saved${expandedText}`, 0, 0);
      }

      const timestamp = details.timestamp ? ` ${theme.fg("dim", details.timestamp)}` : "";
      let text = `${theme.fg("success", "✓")} saved ${theme.fg("accent", "agent_feedback.md")}${timestamp}`;
      if (expanded && details.path) text += `\n\n${details.path}`;
      return new Text(text, 0, 0);
    },
  });
}

export async function executeAgentFeedbackTool(
  runtime: AgentFeedbackRuntime,
  params: AgentFeedbackParams,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<AgentFeedbackToolDetails>> {
  if (signal?.aborted) {
    return errorResult({ code: "ABORTED", message: "agent_feedback was aborted before writing feedback." });
  }

  const normalized = normalizeFeedbackInput(params);
  if (!normalized.ok) return errorResult(normalized.error);

  const timestamp = formatLocalTimestamp(new Date());
  const entry = formatFeedbackEntry(normalized.feedback, timestamp);
  const path = runtime.buildPath(ctx.cwd);

  try {
    await runtime.appendEntry({ filePath: path.filePath, entry });
  } catch (error) {
    return errorResult({
      code: "WRITE_FAILED",
      message: `Could not write agent feedback: ${writeErrorMessage(error)}.`,
    });
  }

  return {
    content: [{ type: "text", text: `Saved agent feedback to ${path.displayPath} (${timestamp}).` }],
    details: {
      ok: true,
      path: path.displayPath,
      timestamp,
      category: normalized.feedback.category,
      feedback: normalized.feedback,
    },
  };
}

function errorResult(error: AgentFeedbackToolError): AgentToolResult<AgentFeedbackToolDetails> {
  return {
    content: [{ type: "text", text: `agent_feedback failed: ${error.message}` }],
    details: { ok: false, error },
  };
}

function renderableCategory(args: AgentFeedbackParams | undefined): FeedbackCategory | null {
  return args && typeof args.category === "string" ? (args.category as FeedbackCategory) : null;
}

function textContent(result: AgentToolResult<AgentFeedbackToolDetails>): string | null {
  for (const item of result.content) {
    if (item.type === "text") return item.text;
  }
  return null;
}

function writeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "unknown write error";
}
