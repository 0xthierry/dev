import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";
import { FEEDBACK_CATEGORIES } from "./categories";

export const AgentFeedbackParamsSchema = Type.Object(
  {
    category: StringEnum([...FEEDBACK_CATEGORIES], {
      description:
        "Feedback category: verification blocker, tooling friction, instruction/docs/environment gap, repeated workaround, or other.",
    }),
    summary: Type.String({
      description: "Concise description of the workflow friction or verification blocker.",
    }),
    impact: Type.String({
      description: "Why this mattered: what could not be verified, slowed down, or became riskier.",
    }),
    attempted: Type.Optional(
      Type.String({
        description: "What was attempted before recording this feedback. Keep it concise.",
      }),
    ),
    blocker: Type.Optional(
      Type.String({
        description: "Concrete blocker or repeated failure mode, especially for validation gaps.",
      }),
    ),
    suggestedFix: Type.Optional(
      Type.String({
        description: "Suggested automation, documentation, environment, or instruction change.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type AgentFeedbackParams = Static<typeof AgentFeedbackParamsSchema>;
