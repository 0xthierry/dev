import type { BlueprintNodeResult, BlueprintRunInput, LoadedBlueprint } from "./types";

export interface BlueprintTemplateState {
  blueprint: LoadedBlueprint;
  input: BlueprintRunInput;
  contextFile: string;
  context: string;
  nodes: Record<string, BlueprintNodeResult>;
}

export function renderBlueprintTemplate(template: string, state: BlueprintTemplateState): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, path: string) =>
    stringifyTemplateValue(resolvePath(path, state)),
  );
}

function resolvePath(path: string, state: BlueprintTemplateState): unknown {
  const parts = path
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return undefined;

  switch (parts[0]) {
    case "input":
      return resolveObjectPath(state.input, parts.slice(1));
    case "blueprint":
      return resolveObjectPath(
        { name: state.blueprint.name, id: state.blueprint.id, scope: state.blueprint.scope },
        parts.slice(1),
      );
    case "context":
      if (parts[1] === "file") return state.contextFile;
      if (parts[1] === "content") return state.context;
      return undefined;
    case "nodes":
      return resolveObjectPath(state.nodes, parts.slice(1));
    default:
      return undefined;
  }
}

function resolveObjectPath(input: unknown, parts: string[]): unknown {
  let current = input;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function stringifyTemplateValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}
