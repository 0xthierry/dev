import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ARTIFACT_PAGE_BYTES,
  DEFAULT_ARTIFACT_PAGE_LINES,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_METADATA_BYTES,
  MAX_ARTIFACT_PAGE_BYTES,
  MAX_ARTIFACT_PAGE_LINES,
  MAX_MODEL_ARTIFACT_SOURCE_BYTES,
} from "../artifacts/artifacts";
import { IPC_ERROR_MESSAGE_MAX_BYTES, IPC_RECORD_LIMIT_BYTES } from "../ipc/protocol";
import { MAX_INBOUND_JSONL_RECORD_BYTES, MAX_OUTBOUND_JSONL_BYTES, MAX_RPC_ERROR_PREVIEW_CHARS } from "../rpc/jsonl";
import {
  DEFAULT_STDERR_LIMIT_BYTES,
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_STDERR_LIMIT_BYTES,
  MAX_TERMINATION_GRACE_MS,
  MIN_TERMINATION_GRACE_MS,
} from "../runner/process";
import { BOUNDARY_LIMIT_EVIDENCE, BOUNDARY_ROBUSTNESS_PARAMETERS } from "./boundary-limits";

describe("boundary limit evidence", () => {
  test("documents a resource, unit, range, and rationale for every boundary limit", () => {
    // Arrange
    const entries = Object.values(BOUNDARY_LIMIT_EVIDENCE);

    // Act
    const valid = entries.map(
      (entry) =>
        entry.resource.length > 0 &&
        entry.unit.length > 0 &&
        Number.isFinite(entry.minimum) &&
        Number.isFinite(entry.hardMaximum) &&
        entry.minimum <= entry.hardMaximum &&
        (!("default" in entry) ||
          (entry.default !== undefined && entry.default >= entry.minimum && entry.default <= entry.hardMaximum)) &&
        entry.rationale.length >= 24,
    );

    // Assert
    expect(valid.every(Boolean)).toBe(true);
  });

  test("ties evidence values directly to behavior constants", () => {
    // Arrange
    const evidence = BOUNDARY_LIMIT_EVIDENCE;

    // Act
    const values = {
      artifact: evidence.artifactBytes.hardMaximum,
      metadata: evidence.artifactMetadataBytes.hardMaximum,
      pageBytes: [evidence.artifactPageBytes.default, evidence.artifactPageBytes.hardMaximum],
      modelPageBytes: evidence.artifactModelSourceBytes.hardMaximum,
      pageLines: [evidence.artifactPageLines.default, evidence.artifactPageLines.hardMaximum],
      rpc: [evidence.rpcInboundRecordBytes.hardMaximum, evidence.rpcOutboundCommandBytes.hardMaximum],
      rpcPreview: evidence.rpcErrorPreviewChars.hardMaximum,
      stderr: [evidence.processStderrBytes.default, evidence.processStderrBytes.hardMaximum],
      grace: [
        evidence.terminationGraceMs.minimum,
        evidence.terminationGraceMs.default,
        evidence.terminationGraceMs.hardMaximum,
      ],
      ipc: [evidence.ipcRecordBytes.hardMaximum, evidence.ipcErrorBytes.hardMaximum],
    };

    // Assert
    expect(values).toEqual({
      artifact: MAX_ARTIFACT_BYTES,
      metadata: MAX_ARTIFACT_METADATA_BYTES,
      pageBytes: [DEFAULT_ARTIFACT_PAGE_BYTES, MAX_ARTIFACT_PAGE_BYTES],
      modelPageBytes: MAX_MODEL_ARTIFACT_SOURCE_BYTES,
      pageLines: [DEFAULT_ARTIFACT_PAGE_LINES, MAX_ARTIFACT_PAGE_LINES],
      rpc: [MAX_INBOUND_JSONL_RECORD_BYTES, MAX_OUTBOUND_JSONL_BYTES],
      rpcPreview: MAX_RPC_ERROR_PREVIEW_CHARS,
      stderr: [DEFAULT_STDERR_LIMIT_BYTES, MAX_STDERR_LIMIT_BYTES],
      grace: [MIN_TERMINATION_GRACE_MS, DEFAULT_TERMINATION_GRACE_MS, MAX_TERMINATION_GRACE_MS],
      ipc: [IPC_RECORD_LIMIT_BYTES, IPC_ERROR_MESSAGE_MAX_BYTES],
    });
  });

  test("classifies capability entropy, artifact entropy, and allocation retries outside resource limits", () => {
    // Arrange
    const parameters = BOUNDARY_ROBUSTNESS_PARAMETERS;

    // Act
    const classifications = Object.values(parameters).map((parameter) => parameter.classification);

    // Assert
    expect(parameters.capabilityToken).toMatchObject({
      value: 32,
      unit: "random bytes",
      classification: "cryptographic",
    });
    expect(parameters.artifactId).toMatchObject({ value: 16, unit: "random bytes", classification: "cryptographic" });
    expect(parameters.artifactAllocationAttempts).toMatchObject({ value: 4, classification: "robustness" });
    expect(classifications).toEqual(["cryptographic", "cryptographic", "robustness"]);
  });
});
