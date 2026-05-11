import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

export const AgentContextSchema = StringEnum(["fresh", "fork"] as const, {
  description:
    'Context mode for new child sessions. "fresh" starts an isolated saved child session. "fork" inherits the current Pi session when a saved parent session is available.',
  default: "fresh",
});

export const AgentTaskSchema = Type.Object({
  subagent_type: Type.Optional(Type.String({ description: "Name of the configured or built-in subagent to start." })),
  agent_id: Type.Optional(Type.String({ description: "Existing child agent/session id to resume." })),
  description: Type.Optional(Type.String({ description: "Short human-readable task summary." })),
  prompt: Type.String({ description: "Task prompt for the subagent." }),
  context: Type.Optional(AgentContextSchema),
});

export const AgentParamsSchema = Type.Object({
  subagent_type: Type.Optional(
    Type.String({ description: "Name of the configured or built-in subagent to start for single-agent mode." }),
  ),
  agent_id: Type.Optional(
    Type.String({ description: "Existing child agent/session id to resume in single-agent mode." }),
  ),
  description: Type.Optional(Type.String({ description: "Short human-readable task summary for single-agent mode." })),
  prompt: Type.Optional(Type.String({ description: "Task prompt for single-agent mode." })),
  context: Type.Optional(AgentContextSchema),
  tasks: Type.Optional(Type.Array(AgentTaskSchema, { description: "Independent subagent tasks to run in parallel." })),
});

export type AgentContextMode = Static<typeof AgentContextSchema>;
export type AgentTaskInput = Static<typeof AgentTaskSchema>;
export type AgentParams = Static<typeof AgentParamsSchema>;
