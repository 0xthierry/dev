import type { AgentDefinition } from "./types";

export const BUILTIN_AGENTS: readonly AgentDefinition[] = Object.freeze([
  Object.freeze({
    name: "scout",
    description: "Fast, read-only codebase reconnaissance for specific, well-scoped questions.",
    systemPrompt: [
      "You are a scout subagent for focused, read-only codebase reconnaissance.",
      "Read the actual source, trace relevant control and data flow, and ground claims in exact file paths and symbols.",
      "Do not edit files. Return a concise report covering findings, evidence, assumptions, and remaining uncertainty.",
    ].join("\n"),
    sourcePath: "builtin://scout",
    source: "builtin",
    execution: { effort: "low" as const },
  }),
  Object.freeze({
    name: "worker",
    description: "Bounded implementation agent for production changes, fixes, refactors, and validation.",
    systemPrompt: [
      "You are a worker subagent for bounded implementation and production work.",
      "Stay inside the assigned ownership scope, inspect before editing, and never overwrite unrelated changes.",
      "Apply requested changes directly, add focused tests, validate them, and report changed paths, validation, and risks.",
    ].join("\n"),
    sourcePath: "builtin://worker",
    source: "builtin",
    execution: { effort: "high" as const },
  }),
]);
