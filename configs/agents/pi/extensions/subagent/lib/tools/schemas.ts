import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "typebox";

export const AgentContextSchema = StringEnum(["fresh", "fork"] as const, {
  description:
    'Context mode. "fresh" starts an isolated child session. "fork" inherits the current Pi session when a saved parent session is available.',
  default: "fresh",
});

export const AgentTaskSchema = Type.Object({
  subagent_type: Type.String({ description: "Name of the subagent to run." }),
  description: Type.Optional(Type.String({ description: "Short human-readable task summary." })),
  prompt: Type.String({ description: "Task prompt for the subagent." }),
  context: Type.Optional(AgentContextSchema),
});

export const AgentParamsSchema = Type.Object({
  subagent_type: Type.Optional(Type.String({ description: "Name of the subagent to run for single-agent mode." })),
  description: Type.Optional(Type.String({ description: "Short human-readable task summary for single-agent mode." })),
  prompt: Type.Optional(Type.String({ description: "Task prompt for single-agent mode." })),
  context: Type.Optional(AgentContextSchema),
  tasks: Type.Optional(Type.Array(AgentTaskSchema, { description: "Independent subagent tasks to run in parallel." })),
});

export type AgentContextMode = Static<typeof AgentContextSchema>;
export type AgentTaskInput = Static<typeof AgentTaskSchema>;
export type AgentParams = Static<typeof AgentParamsSchema>;
