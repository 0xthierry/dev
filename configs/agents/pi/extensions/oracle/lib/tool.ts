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
      "Obtain an independent second opinion from a separate reasoning model. The Oracle is an exceptional escalation tool, not a normal step in implementation, debugging, code review, refactoring, test-failure investigation, or design. Use it only when the user explicitly requests the Oracle or a second opinion, or after your own concrete investigation leaves a consequential decision unresolved and a wrong answer would carry substantial security, data-loss, concurrency, or costly long-lived architectural risk. Uncertainty alone does not qualify.\n\n" +
      "Before calling, arrive at a concrete position — a proposed fix, a leading root-cause hypothesis, or a chosen design with its trade-offs — and ask the Oracle to challenge that position. Do not hand it an open-ended problem to solve from scratch. If you can proceed confidently using repository evidence, tests, documentation, or ordinary engineering judgment, proceed without the Oracle.\n\n" +
      "The Oracle cannot see your repository, files, terminal, diffs, or this conversation; it knows only what you put in the prompt. Make the prompt self-contained with the relevant code, exact errors, constraints, environment, evidence, attempted fixes, your proposed solution and reasoning, the success criteria, and the precise review you want. Do not ask it to think step by step. Never send secrets, credentials, tokens, or sensitive data.\n\n" +
      'The Oracle is slow and its answer is advice to verify, not ground truth. Calls resume the current Oracle thread by default; use context="fresh" only for an unrelated problem.',
    promptSnippet: "Optional escalation for an explicitly requested or high-consequence unresolved second opinion.",
    promptGuidelines: [
      "oracle: Do not invoke oracle by default. Use it only when the user explicitly requests the Oracle or a second opinion, or after concrete investigation leaves a consequential decision unresolved and a wrong answer would carry substantial security, data-loss, concurrency, or costly long-lived architectural risk. Ordinary implementation, debugging, code review, refactoring, test failures, and design choices do not qualify; uncertainty alone does not qualify.",
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
