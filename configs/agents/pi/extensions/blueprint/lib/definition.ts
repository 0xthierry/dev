import { parsePiThinkingLevel } from "./thinking";
import type {
  BlueprintDefinition,
  BlueprintEdges,
  BlueprintNode,
  CommandBlueprintNode,
  FinalBlueprintNode,
  HydrateBlueprintNode,
  PiBlueprintNode,
} from "./types";

export type BlueprintDefinitionResult = { ok: true; definition: BlueprintDefinition } | { ok: false; errors: string[] };

export function normalizeBlueprintDefinition(input: unknown): BlueprintDefinitionResult {
  if (!isRecord(input)) return { ok: false, errors: ["Blueprint must be a JSON object."] };

  const errors: string[] = [];
  const name = readRequiredString(input.name, "name", errors);
  const description = readOptionalString(input.description) ?? "";
  const rawNodes = isRecord(input.nodes) ? input.nodes : undefined;
  if (!rawNodes) errors.push("Blueprint must define a nodes object.");

  const nodes: Record<string, BlueprintNode> = {};
  if (rawNodes) {
    for (const [nodeId, rawNode] of Object.entries(rawNodes)) {
      const node = normalizeNode(nodeId, rawNode, errors);
      if (node) nodes[nodeId] = node;
    }
  }

  const start = readOptionalString(input.start) ?? Object.keys(nodes)[0] ?? "";
  if (!start) errors.push("Blueprint must define a start node or at least one node.");
  else if (rawNodes && !nodes[start]) errors.push(`Start node '${start}' does not exist.`);

  validateEdges(nodes, errors);

  if (errors.length > 0 || !name || !start) return { ok: false, errors };
  return { ok: true, definition: { name, description, start, nodes } };
}

function normalizeNode(nodeId: string, input: unknown, errors: string[]): BlueprintNode | undefined {
  if (!isRecord(input)) {
    errors.push(`Node '${nodeId}' must be an object.`);
    return undefined;
  }

  const type = readRequiredString(input.type, `nodes.${nodeId}.type`, errors);
  if (!type) return undefined;

  const base = {
    description: readOptionalString(input.description),
    next: readOptionalString(input.next),
    on: normalizeEdges(input.on, `nodes.${nodeId}.on`, errors),
    maxAttempts: readPositiveInteger(input.maxAttempts, `nodes.${nodeId}.maxAttempts`, errors),
  };

  switch (type) {
    case "hydrate":
      return stripUndefined({ ...base, type: "hydrate" }) as HydrateBlueprintNode;
    case "pi":
      return normalizePiNode(nodeId, input, base, errors);
    case "command":
      return normalizeCommandNode(nodeId, input, base, errors);
    case "final":
      return stripUndefined({
        ...base,
        type: "final",
        message: readOptionalString(input.message),
      }) as FinalBlueprintNode;
    default:
      errors.push(`Node '${nodeId}' has unsupported type '${type}'.`);
      return undefined;
  }
}

function normalizePiNode(
  nodeId: string,
  input: Record<string, unknown>,
  base: Omit<BlueprintNode, "type">,
  errors: string[],
): PiBlueprintNode | undefined {
  const prompt = readOptionalString(input.prompt) ?? "";
  const promptFile = readOptionalString(input.promptFile);
  if (!prompt && !promptFile) errors.push(`Node '${nodeId}' must define prompt or promptFile.`);

  const thinking = parsePiThinkingLevel(input.thinking);
  if (input.thinking !== undefined && !thinking) errors.push(`Node '${nodeId}' has unsupported thinking level.`);

  const tools = readStringArray(input.tools, `nodes.${nodeId}.tools`, errors);
  const node = stripUndefined({
    ...base,
    type: "pi",
    prompt,
    promptFile,
    systemPrompt: readOptionalString(input.systemPrompt),
    systemPromptFile: readOptionalString(input.systemPromptFile),
    tools,
    model: readOptionalString(input.model),
    thinking,
  }) as PiBlueprintNode;

  return prompt || promptFile ? node : undefined;
}

function normalizeCommandNode(
  nodeId: string,
  input: Record<string, unknown>,
  base: Omit<BlueprintNode, "type">,
  errors: string[],
): CommandBlueprintNode | undefined {
  const run = readRequiredString(input.run, `nodes.${nodeId}.run`, errors);
  if (!run) return undefined;

  return stripUndefined({
    ...base,
    type: "command",
    run,
    timeoutMs: readPositiveInteger(input.timeoutMs, `nodes.${nodeId}.timeoutMs`, errors),
  }) as CommandBlueprintNode;
}

function normalizeEdges(input: unknown, path: string, errors: string[]): BlueprintEdges | undefined {
  if (input === undefined) return undefined;
  if (!isRecord(input)) {
    errors.push(`${path} must be an object.`);
    return undefined;
  }

  const edges = stripUndefined({
    success: readOptionalString(input.success),
    failure: readOptionalString(input.failure),
  }) as BlueprintEdges;
  return edges.success || edges.failure ? edges : undefined;
}

function validateEdges(nodes: Record<string, BlueprintNode>, errors: string[]): void {
  const nodeIds = new Set(Object.keys(nodes));
  for (const [nodeId, node] of Object.entries(nodes)) {
    for (const target of [node.next, node.on?.success, node.on?.failure]) {
      if (target && !nodeIds.has(target)) errors.push(`Node '${nodeId}' references missing node '${target}'.`);
    }
  }
}

function readRequiredString(input: unknown, path: string, errors: string[]): string | undefined {
  const value = readOptionalString(input);
  if (value) return value;
  errors.push(`${path} must be a non-empty string.`);
  return undefined;
}

function readOptionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function readPositiveInteger(input: unknown, path: string, errors: string[]): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input === "number" && Number.isInteger(input) && input > 0) return input;
  errors.push(`${path} must be a positive integer.`);
  return undefined;
}

function readStringArray(input: unknown, path: string, errors: string[]): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    errors.push(`${path} must be an array of strings.`);
    return undefined;
  }

  const values: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !item.trim()) {
      errors.push(`${path} must contain only non-empty strings.`);
      return undefined;
    }
    values.push(item.trim());
  }
  return values;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === "object" && !Array.isArray(input);
}

function stripUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
