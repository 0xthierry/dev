import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { parseReasoningEffort, REASONING_EFFORTS } from "../execution/profile";
import { type AgentDefinition, AgentDefinitionError, type AgentSource } from "./types";

const ALLOWED_FRONTMATTER_FIELDS = new Set(["name", "description", "provider", "model", "effort"]);

export function parseDiscoveredAgentMarkdown(
  markdown: string,
  sourcePath: string,
  source: AgentSource,
): AgentDefinition | undefined {
  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseFrontmatter<Record<string, unknown>>(markdown).frontmatter;
  } catch {
    return parseAgentMarkdown(markdown, sourcePath, source);
  }
  if (frontmatter.name === undefined && frontmatter.description === undefined) return undefined;
  return parseAgentMarkdown(markdown, sourcePath, source);
}

export function parseAgentMarkdown(markdown: string, sourcePath: string, source: AgentSource): AgentDefinition {
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try {
    parsed = parseFrontmatter<Record<string, unknown>>(markdown);
  } catch (error) {
    throw malformed(sourcePath, `invalid frontmatter: ${message(error)}`);
  }
  const unknownFields = Object.keys(parsed.frontmatter)
    .filter((field) => !ALLOWED_FRONTMATTER_FIELDS.has(field))
    .sort();
  if (unknownFields.length) {
    throw malformed(sourcePath, `frontmatter contains unknown fields: ${unknownFields.join(", ")}`);
  }
  const name = requiredString(parsed.frontmatter.name, sourcePath, "name");
  const description = requiredString(parsed.frontmatter.description, sourcePath, "description", name, true);
  const systemPrompt = parsed.body.trim();
  if (!systemPrompt) throw malformed(sourcePath, "agent instructions must not be empty", name);

  const hasProvider = parsed.frontmatter.provider !== undefined;
  const hasModel = parsed.frontmatter.model !== undefined;
  if (hasProvider !== hasModel) throw malformed(sourcePath, "provider and model must be specified together", name);
  const provider = hasProvider ? requiredString(parsed.frontmatter.provider, sourcePath, "provider", name) : undefined;
  const model = hasModel ? requiredString(parsed.frontmatter.model, sourcePath, "model", name) : undefined;
  const effort = parsed.frontmatter.effort === undefined ? undefined : parseReasoningEffort(parsed.frontmatter.effort);
  if (parsed.frontmatter.effort !== undefined && !effort) {
    throw malformed(sourcePath, `effort must be one of: ${REASONING_EFFORTS.join(", ")}`, name);
  }
  const execution =
    provider || effort ? { ...(provider ? { provider, model } : {}), ...(effort ? { effort } : {}) } : undefined;

  return { name, description, systemPrompt, sourcePath, source, ...(execution ? { execution } : {}) };
}

function requiredString(
  value: unknown,
  sourcePath: string,
  field: string,
  agentName?: string,
  normalizeWhitespace = false,
): string {
  if (typeof value !== "string") throw malformed(sourcePath, `${field} must be a non-empty string`, agentName);
  const normalized = value.trim();
  if (!normalized || (!normalizeWhitespace && value !== normalized)) {
    throw malformed(
      sourcePath,
      normalizeWhitespace
        ? `${field} must contain non-whitespace text`
        : `${field} must be a non-empty string without surrounding whitespace`,
      agentName,
    );
  }
  return normalizeWhitespace ? normalized : value;
}

function malformed(sourcePath: string, detail: string, agentName?: string): AgentDefinitionError {
  return new AgentDefinitionError("malformed_agent", sourcePath, `${sourcePath}: ${detail}`, agentName);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
