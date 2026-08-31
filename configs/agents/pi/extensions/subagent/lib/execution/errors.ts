import type { ReasoningEffort } from "./profile";

export type ExecutionResolutionError =
  | { kind: "incomplete_model_reference" }
  | { kind: "unknown_provider"; provider: string }
  | { kind: "unknown_model"; provider: string; model: string }
  | { kind: "authentication_unavailable"; provider: string }
  | {
      kind: "unsupported_effort";
      provider: string;
      model: string;
      requested: ReasoningEffort;
      supported: ReasoningEffort[];
    }
  | {
      kind: "override_locked";
      field: "model" | "effort";
      requested: string;
      configured: string;
    };

export type ExecutionResult<T> = { ok: true; value: T } | { ok: false; error: ExecutionResolutionError };
