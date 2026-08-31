import {
  ARTIFACT_DIRECTORY_ALLOCATION_ATTEMPTS,
  ARTIFACT_ID_BYTES,
  DEFAULT_ARTIFACT_PAGE_BYTES,
  DEFAULT_ARTIFACT_PAGE_LINES,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_METADATA_BYTES,
  MAX_ARTIFACT_PAGE_BYTES,
  MAX_ARTIFACT_PAGE_LINES,
  MAX_MODEL_ARTIFACT_SOURCE_BYTES,
} from "../artifacts/artifacts";
import { CAPABILITY_TOKEN_BYTES } from "../ipc/authentication";
import { IPC_ERROR_MESSAGE_MAX_BYTES, IPC_RECORD_LIMIT_BYTES } from "../ipc/protocol";
import { MAX_INBOUND_JSONL_RECORD_BYTES, MAX_OUTBOUND_JSONL_BYTES, MAX_RPC_ERROR_PREVIEW_CHARS } from "../rpc/jsonl";
import {
  DEFAULT_STDERR_LIMIT_BYTES,
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_STDERR_LIMIT_BYTES,
  MAX_TERMINATION_GRACE_MS,
  MIN_TERMINATION_GRACE_MS,
} from "../runner/process";

export interface BoundaryLimitEvidence {
  resource: string;
  unit: string;
  default?: number;
  minimum: number;
  hardMaximum: number;
  rationale: string;
}

/** Machine-auditable resource limits at artifact, RPC, IPC, and process boundaries. */
export const BOUNDARY_LIMIT_EVIDENCE = {
  artifactBytes: {
    resource: "persisted completion output and artifact validation work",
    unit: "raw UTF-8 bytes per artifact",
    minimum: 0,
    hardMaximum: MAX_ARTIFACT_BYTES,
    rationale:
      "Two MiB comfortably exceeds normal model output and remains below the 16 MiB inbound RPC cap after worst-case 6x JSON escaping plus the response envelope.",
  },
  artifactMetadataBytes: {
    resource: "authorization metadata decode allocation",
    unit: "bytes per metadata record",
    minimum: 1,
    hardMaximum: MAX_ARTIFACT_METADATA_BYTES,
    rationale: "The fixed six-field schema needs far less than four KiB and is decoded only after this bound.",
  },
  artifactPageBytes: {
    resource: "requested artifact source page before the model-envelope safety reduction",
    unit: "raw UTF-8 source bytes per requested page",
    default: DEFAULT_ARTIFACT_PAGE_BYTES,
    minimum: 4,
    hardMaximum: MAX_ARTIFACT_PAGE_BYTES,
    rationale:
      "Callers may request 32 KiB, while authorized model reads return at most 3 KiB source pages so 6x JSON escaping or 10x one-byte exact redaction cannot trigger generic aggregate truncation.",
  },
  artifactModelSourceBytes: {
    resource: "authorized artifact source represented by one model-visible result",
    unit: "raw UTF-8 source bytes per returned page",
    minimum: 4,
    hardMaximum: MAX_MODEL_ARTIFACT_SOURCE_BYTES,
    rationale:
      "Three KiB remains below the 40 KiB aggregate envelope after either worst-case 6x JSON escaping or one-pass 10x expansion from exact one-byte secret redaction.",
  },
  artifactPageLines: {
    resource: "single model-visible artifact page structure",
    unit: "lines per page",
    default: DEFAULT_ARTIFACT_PAGE_LINES,
    minimum: 1,
    hardMaximum: MAX_ARTIFACT_PAGE_LINES,
    rationale: "A line cap prevents dense transcripts from bypassing the byte-oriented pagination contract.",
  },
  rpcInboundRecordBytes: {
    resource: "incremental child RPC decoder accumulation",
    unit: "encoded UTF-8 bytes before LF per record",
    minimum: 1,
    hardMaximum: MAX_INBOUND_JSONL_RECORD_BYTES,
    rationale:
      "Sixteen MiB carries a maximum storable 2 MiB assistant response after worst-case 6x JSON escaping plus its response envelope, and fails split oversize input before append.",
  },
  rpcOutboundCommandBytes: {
    resource: "single child RPC stdin write",
    unit: "encoded UTF-8 bytes including LF",
    minimum: 1,
    hardMaximum: MAX_OUTBOUND_JSONL_BYTES,
    rationale:
      "Two MiB bounds transport allocation without imposing a separate raw assignment policy cap; representable source size depends on JSON escaping.",
  },
  rpcErrorPreviewChars: {
    resource: "malformed RPC diagnostic exposure",
    unit: "UTF-16 characters per preview",
    minimum: 0,
    hardMaximum: MAX_RPC_ERROR_PREVIEW_CHARS,
    rationale: "A short redacted prefix diagnoses framing without reflecting an attacker-controlled record.",
  },
  processStderrBytes: {
    resource: "retained child stderr diagnostic tail",
    unit: "bytes per child process",
    default: DEFAULT_STDERR_LIMIT_BYTES,
    minimum: 0,
    hardMaximum: MAX_STDERR_LIMIT_BYTES,
    rationale: "Sixteen KiB preserves recent diagnostics while bounding resident memory and error output.",
  },
  terminationGraceMs: {
    resource: "child process-tree shutdown latency",
    unit: "milliseconds",
    default: DEFAULT_TERMINATION_GRACE_MS,
    minimum: MIN_TERMINATION_GRACE_MS,
    hardMaximum: MAX_TERMINATION_GRACE_MS,
    rationale:
      "Five seconds permits Pi cleanup; the 1 ms to 30 s seam supports deterministic tests and bounded shutdown.",
  },
  ipcRecordBytes: {
    resource: "authenticated control-plane decoder and encoded frame",
    unit: "encoded UTF-8 bytes before LF per frame",
    minimum: 1,
    hardMaximum: IPC_RECORD_LIMIT_BYTES,
    rationale:
      "Two MiB bounds authenticated control-plane allocation without imposing a separate raw assignment policy cap; representable source size depends on JSON escaping.",
  },
  ipcErrorBytes: {
    resource: "remote control-plane error reflection",
    unit: "UTF-8 bytes per error message",
    minimum: 0,
    hardMaximum: IPC_ERROR_MESSAGE_MAX_BYTES,
    rationale: "One KiB is sufficient for typed diagnostics and bounds both server and client reflection.",
  },
} as const satisfies Record<string, BoundaryLimitEvidence>;

/** Cryptographic/robustness parameters are intentionally separate from configurable resource limits. */
export const BOUNDARY_ROBUSTNESS_PARAMETERS = {
  capabilityToken: {
    value: CAPABILITY_TOKEN_BYTES,
    unit: "random bytes",
    classification: "cryptographic" as const,
    rationale: "A 256-bit ephemeral bearer capability resists guessing across resident child connections.",
  },
  artifactId: {
    value: ARTIFACT_ID_BYTES,
    unit: "random bytes",
    classification: "cryptographic" as const,
    rationale: "A 128-bit opaque artifact reference resists enumeration without exposing a host path.",
  },
  artifactAllocationAttempts: {
    value: ARTIFACT_DIRECTORY_ALLOCATION_ATTEMPTS,
    unit: "attempts",
    classification: "robustness" as const,
    rationale: "Four retries tolerate an extraordinary random collision without representing resource policy.",
  },
} as const;
