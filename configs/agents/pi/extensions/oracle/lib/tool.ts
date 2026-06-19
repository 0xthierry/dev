import {
  type AgentToolResult,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  type ExtensionContext,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { OracleAnswer } from "./providers/chatgpt/direct";
import type { OracleRuntime } from "./runtime";
import { type OracleParams, OracleParamsSchema } from "./schema";
import { restoreOracleSessionState } from "./session";

export const ORACLE_TOOL_NAME = "oracle";

export type OracleToolError =
  | { code: "EMPTY_PROMPT"; message: string }
  | { code: "ABORTED"; message: string }
  | { code: "REQUEST_FAILED"; message: string };

export class OracleRequestError extends Error {
  readonly oracleError: OracleToolError;

  constructor(error: OracleToolError) {
    super(`oracle failed: ${error.message}`);
    this.name = "OracleRequestError";
    this.oracleError = error;
  }
}

function failOracle(error: OracleToolError): never {
  throw new OracleRequestError(error);
}

export interface OracleToolDetails {
  ok: boolean;
  providerId?: string;
  providerLabel?: string;
  model?: string;
  conversationId?: string;
  currentNode?: string;
  messageId?: string;
  projectId?: string;
  status?: string;
  finished?: boolean;
  context?: "resume" | "fresh";
  resumed?: boolean;
  answerBytes?: number;
  answerLines?: number;
  truncated?: boolean;
}

export function registerOracleTool(pi: ExtensionAPI, runtime: OracleRuntime): void {
  pi.registerTool<typeof OracleParamsSchema, OracleToolDetails>({
    name: ORACLE_TOOL_NAME,
    label: "oracle",
    description:
      "Consult the Oracle — a separate, state-of-the-art intelligence — for problems that exceed your own confidence: hard debugging, architecture and design decisions, subtle algorithmic or concurrency bugs, security-sensitive logic, or an independent second opinion on a risky change. Also consult it whenever the user explicitly asks for the Oracle or a second opinion.\n\n" +
      "Do your own reasoning first and arrive at a concrete position — a proposed fix, a leading root-cause hypothesis, a chosen design with its trade-offs — then bring that to the Oracle to challenge, refine, or confirm. The Oracle is a reviewer of your thinking, not a replacement for it: hand it your best answer and ask it to find what is wrong, rather than handing it an open-ended problem to solve from scratch. The only exception is genuinely unfamiliar territory where you cannot form a credible first attempt. Reaching for the Oracle the moment something looks tricky, before you have proposed your own solution, is the wrong reflex.\n\n" +
      "The Oracle is blind and stateless: it cannot see your repository, files, terminal, diffs, or this conversation. It knows ONLY what you put in the prompt. Make every prompt self-contained — paste the actual code (full functions or files, not summaries), the exact error messages and stack traces, the relevant constraints (performance, compatibility, style, what must not change), versions and environment, and what you have already tried and why it failed. Include your own proposed solution and reasoning, state the goal and the success criteria explicitly, and say precisely what you want back (a critique of your fix, a root-cause analysis, a design with trade-offs, a reviewed diff, a step-by-step plan). Do not tell it to think step by step — its reasoning is internal.\n\n" +
      "The Oracle is slow (answers can take minutes) and deliberate, so consult it for hard problems, not routine work. By default each call continues the current Oracle thread, so you can iterate and discuss: follow up with new findings or code in the same thread, and start fresh only for an unrelated problem. Treat its answer as expert advice to verify against the real code, not as ground truth. Never send secrets, credentials, tokens, or sensitive data.",
    promptSnippet:
      "Consult the Oracle, a separate state-of-the-art intelligence, to pressure-test your own proposed solution on hard problems — always with complete, self-contained context.",
    promptGuidelines: [
      "oracle: The Oracle is a separate, state-of-the-art intelligence. Consult it for hard reasoning, debugging, architecture, or review — or whenever the user asks for the Oracle or a second opinion. First do your own reasoning and propose a concrete fix or decision, then bring that to the Oracle to challenge or confirm; do not offload the decision the moment something looks tricky.",
      'oracle: The Oracle cannot see your repo, files, terminal, or this conversation; it knows only what you send. Give it complete, self-contained context — real code, exact errors, constraints, what you tried, and your own proposed solution — and state the exact output you want. Calls continue the current Oracle thread by default so you can iterate; pass context="fresh" only for an unrelated problem.',
      "oracle: The Oracle is slow and deliberate — don't use it for routine work you can do confidently, and never send it secrets, credentials, tokens, or sensitive data.",
    ],
    parameters: OracleParamsSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return executeOracleTool(runtime, params, signal, ctx);
    },

    renderCall(args, theme) {
      const suffix = args?.prompt ? ` ${truncatePrompt(args.prompt)}` : "";
      return new Text(`${theme.fg("toolTitle", theme.bold(ORACLE_TOOL_NAME))}${theme.fg("muted", suffix)}`, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details;
      if (!details?.ok) {
        const message = textContent(result) ?? "Oracle request failed.";
        const expandedText = expanded ? `\n\n${message}` : "";
        return new Text(`${theme.fg("error", "✗")} oracle unavailable${expandedText}`, 0, 0);
      }

      const model = details.model ? ` ${theme.fg("dim", details.model)}` : "";
      const resumed = details.resumed ? theme.fg("muted", " resumed") : theme.fg("muted", " fresh");
      const truncated = details.truncated ? theme.fg("warning", " truncated") : "";
      let text = `${theme.fg("success", "✓")} oracle answered${model}${resumed}${truncated}`;
      if (expanded && details.conversationId) text += `\n\nconversation: ${details.conversationId}`;
      return new Text(text, 0, 0);
    },
  });
}

export async function executeOracleTool(
  runtime: OracleRuntime,
  params: OracleParams,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
): Promise<AgentToolResult<OracleToolDetails>> {
  if (signal?.aborted) {
    failOracle({ code: "ABORTED", message: "oracle was aborted before the request was sent." });
  }

  const prompt = params.prompt.trim();
  if (!prompt) failOracle({ code: "EMPTY_PROMPT", message: "oracle.prompt must be a non-empty string." });

  const context = params.context ?? "resume";
  const state = context === "resume" ? restoreOracleSessionState(ctx.sessionManager.getBranch()) : undefined;

  try {
    const answer = await runtime.ask({ prompt, signal, ...(state ? { state } : {}) });
    return successResult(answer, context);
  } catch (error) {
    if (error instanceof OracleRequestError) throw error;
    failOracle({ code: "REQUEST_FAILED", message: oracleErrorMessage(error) });
  }
}

function successResult(answer: OracleAnswer, context: "resume" | "fresh"): AgentToolResult<OracleToolDetails> {
  const truncation = truncateHead(answer.text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  let text = `The Oracle answered:\n\n${truncation.content}`;
  if (truncation.truncated) {
    text += `\n\n[Oracle answer truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines, ${formatSize(
      truncation.outputBytes,
    )} of ${formatSize(truncation.totalBytes)}.]`;
  }
  if (!answer.finished)
    text += "\n\n[Oracle answer may be partial; the Oracle did not report a finished status before timeout.]";

  return {
    content: [{ type: "text", text }],
    details: {
      ok: true,
      providerId: answer.providerId,
      providerLabel: answer.providerLabel,
      model: answer.model,
      conversationId: answer.conversationId,
      currentNode: answer.currentNode,
      messageId: answer.messageId,
      projectId: answer.projectId,
      status: answer.status,
      finished: answer.finished,
      context,
      resumed: answer.resumed,
      answerBytes: truncation.totalBytes,
      answerLines: truncation.totalLines,
      truncated: truncation.truncated,
    },
  };
}

function truncatePrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 60 ? `${normalized.slice(0, 57)}…` : normalized;
}

function textContent(result: AgentToolResult<OracleToolDetails>): string | null {
  for (const item of result.content) {
    if (item.type === "text") return item.text;
  }
  return null;
}

function oracleErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "unknown oracle request error";
}
