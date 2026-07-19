import type { ChildAgentEventState } from "./json-events";

const STDERR_TAIL_CHARS = 2_000;

export interface SynthesizeCrashHandoffInput {
  agentName: string;
  state: ChildAgentEventState;
  exitCode: number;
  stderr: string;
  sessionFile?: string;
}

/**
 * Reconstructs a handoff report from the streamed child transcript when the
 * child exited without producing a final message. This is what makes
 * defensive mid-run report writing by the child unnecessary.
 */
export function synthesizeCrashHandoff(input: SynthesizeCrashHandoffInput): string {
  const { agentName, state, exitCode, stderr, sessionFile } = input;
  const lines: string[] = [
    `# Synthesized handoff: ${agentName} exited without a final report`,
    "",
    "The child agent ended before producing a final message. The harness reconstructed this handoff from the streamed transcript.",
    "",
    `- Exit code: ${exitCode}`,
  ];
  if (state.stopReason) lines.push(`- Stop reason: ${state.stopReason}`);
  if (state.errorMessage) lines.push(`- Error: ${state.errorMessage}`);
  lines.push(`- Turns: ${state.usage.turns}`);
  if (sessionFile) lines.push(`- Child session (resumable): ${sessionFile}`);
  lines.push("- Full transcript: the .jsonl file saved alongside this artifact.");

  if (state.currentAssistantText.trim()) {
    lines.push("", "## Last assistant text (in progress)", "", state.currentAssistantText.trim());
  }

  if (state.activity.length > 0) {
    lines.push("", `## Recent activity (last ${state.activity.length} items)`, "");
    for (const item of state.activity) {
      if (item.kind === "assistant") {
        lines.push(`- assistant [${item.status}]: ${item.text}`);
      } else {
        const output = item.outputPreview ? ` → ${item.outputPreview}` : "";
        lines.push(`- ${item.toolName} [${item.status}] ${item.argsPreview}${output}`);
      }
    }
  }

  const stderrTail = stderr.trim().slice(-STDERR_TAIL_CHARS);
  if (stderrTail) {
    lines.push("", "## Stderr (tail)", "", "```", stderrTail, "```");
  }

  return `${lines.join("\n")}\n`;
}
