import type { AgentDefinition } from "./types";

export const BUILTIN_AGENTS: readonly AgentDefinition[] = Object.freeze([
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
