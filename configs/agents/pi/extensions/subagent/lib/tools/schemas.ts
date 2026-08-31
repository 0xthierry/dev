import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import {
  DEFAULT_ARTIFACT_PAGE_BYTES,
  DEFAULT_ARTIFACT_PAGE_LINES,
  MAX_ARTIFACT_PAGE_BYTES,
  MAX_ARTIFACT_PAGE_LINES,
} from "../artifacts/artifacts";
import { REASONING_EFFORTS } from "../execution/profile";
import { DEFAULT_WAIT_TIMEOUT_MS, MAX_WAIT_TIMEOUT_MS } from "../supervisor/limits";

const EffortSchema = StringEnum(REASONING_EFFORTS, {
  description:
    "Independent assignment effort override. Resolution precedence is invocation > trusted repository > agent > parent; a conflicting locked override fails.",
});
export const ExecutionSchema = Type.Union(
  [
    Type.Object({ effort: Type.Optional(EffortSchema) }, { additionalProperties: false }),
    Type.Object(
      {
        provider: Type.String({ description: "Pi provider ID; provider and model must be supplied as a pair." }),
        model: Type.String({ description: "Pi model ID; provider and model must be supplied as a pair." }),
        effort: Type.Optional(EffortSchema),
      },
      { additionalProperties: false },
    ),
  ],
  {
    description:
      "Optional execution overrides. Provider and model are atomic; effort resolves independently by invocation > trusted repository > agent > parent, and locked conflicts fail.",
  },
);
export const ForkTurnsSchema = StringEnum(["none", "all"] as const, {
  description: '"none" starts isolated; "all" forks the saved parent session.',
  default: "none",
});
export const WaitConditionSchema = StringEnum(["all", "any"] as const, {
  description: "Return when all targets settle or when any target settles.",
  default: "all",
});
const WaitOperationSchema = StringEnum(["wait"] as const, { default: "wait" });
const ArtifactReadOperationSchema = StringEnum(["read_artifact"] as const);

export const SpawnParamsSchema = Type.Object({
  task_name: Type.String({
    description: "Path-safe task name, unique below the caller for the parent-session lifetime.",
  }),
  subagent_type: Type.String({ description: "Configured or built-in persistent subagent type." }),
  prompt: Type.String({
    description: "Self-contained assignment contract with goal, context, constraints, validation, and expected output.",
  }),
  context: Type.Optional(Type.Object({ fork_turns: Type.Optional(ForkTurnsSchema) })),
  execution: Type.Optional(ExecutionSchema),
});
export const SendParamsSchema = Type.Object({
  target: Type.String({ description: "Exact agent ID or canonical agent path." }),
  message: Type.String({
    description: "Communication of at most 16 KiB; steers running work or enters the durable resumable mailbox.",
  }),
});
export const FollowupParamsSchema = Type.Object({
  target: Type.String({ description: "Exact agent ID or canonical agent path." }),
  message: Type.String({ description: "Self-contained next assignment." }),
  execution: Type.Optional(ExecutionSchema),
});
export const WaitParamsSchema = Type.Object(
  {
    operation: Type.Optional(WaitOperationSchema),
    targets: Type.Array(Type.String(), {
      minItems: 1,
      description: "Exact agent IDs or canonical paths.",
    }),
    condition: Type.Optional(WaitConditionSchema),
    timeout_seconds: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: MAX_WAIT_TIMEOUT_MS / 1000,
        default: DEFAULT_WAIT_TIMEOUT_MS / 1000,
        description: "Wait timeout in whole seconds; timeout never interrupts agents.",
      }),
    ),
  },
  { additionalProperties: false },
);
export const AgentWaitParamsSchema = Type.Union([
  WaitParamsSchema,
  Type.Object(
    {
      operation: ArtifactReadOperationSchema,
      artifact_ref: Type.String({
        description: "Opaque subagent-artifact reference returned by a completion; host paths are rejected.",
      }),
      cursor: Type.Optional(
        Type.Integer({ minimum: 0, description: "UTF-8 byte cursor returned as nextCursor by the previous page." }),
      ),
      page_bytes: Type.Optional(
        Type.Integer({
          minimum: 4,
          maximum: MAX_ARTIFACT_PAGE_BYTES,
          default: DEFAULT_ARTIFACT_PAGE_BYTES,
          description: "Page byte bound.",
        }),
      ),
      page_lines: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_ARTIFACT_PAGE_LINES,
          default: DEFAULT_ARTIFACT_PAGE_LINES,
          description: "Page line bound.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
]);
export const TargetParamsSchema = Type.Object({
  target: Type.String({ description: "Exact agent ID or canonical agent path." }),
});
export const ListParamsSchema = Type.Object({});

export type ExecutionInput = Static<typeof ExecutionSchema>;
export type SpawnParams = Static<typeof SpawnParamsSchema>;
export type SendParams = Static<typeof SendParamsSchema>;
export type FollowupParams = Static<typeof FollowupParamsSchema>;
export type WaitParams = Static<typeof WaitParamsSchema>;
export type AgentWaitParams = Static<typeof AgentWaitParamsSchema>;
export type TargetParams = Static<typeof TargetParamsSchema>;
export type ListParams = Static<typeof ListParamsSchema>;
