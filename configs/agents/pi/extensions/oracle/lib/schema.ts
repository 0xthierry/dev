import { StringEnum } from "@earendil-works/pi-ai";
import { type Static, Type } from "typebox";

export const OracleParamsSchema = Type.Object(
  {
    prompt: Type.String({
      description:
        "Self-contained prompt for the Oracle, which cannot see your repo, files, terminal, or this conversation. Paste the actual code, exact errors, constraints, what you have already tried, and the specific output you want back.",
    }),
    context: Type.Optional(
      StringEnum(["resume", "fresh"] as const, {
        description:
          "Conversation mode. Default resume continues the current Oracle thread in this Pi session branch so you can iterate and discuss; fresh starts a new, independent Oracle conversation for an unrelated problem.",
      }),
    ),
  },
  { additionalProperties: false },
);

export type OracleParams = Static<typeof OracleParamsSchema>;
