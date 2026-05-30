import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

export const WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV = "PI_DYNAMIC_WORKFLOW_STRUCTURED_SCHEMA_FILE";

export default function registerDynamicWorkflowStructuredOutputRuntime(pi: ExtensionAPI): void {
  const schema = readStructuredOutputSchema(process.env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV]);
  if (!schema) return;

  pi.registerTool({
    name: "structured_output",
    label: "Structured Output",
    description: "Return the final machine-readable result for this workflow subagent task.",
    promptSnippet: "Return final machine-readable workflow subagent output",
    promptGuidelines: [
      "structured_output is the final answer channel for this workflow subagent task; call structured_output exactly once when done.",
      "Do not write a prose final answer after calling structured_output.",
    ],
    parameters: schema,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Structured output received." }],
        details: params,
        terminate: true,
      };
    },
  });
}

function readStructuredOutputSchema(path: string | undefined): TSchema | undefined {
  if (!path) return undefined;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Workflow structured output schema must be an object");
  return parsed as TSchema;
}
