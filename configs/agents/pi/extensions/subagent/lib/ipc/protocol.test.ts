import { describe, expect, test } from "bun:test";
import { MAX_WAIT_TIMEOUT_MS } from "../supervisor/limits";
import { encodeIpcFrame, IPC_RECORD_LIMIT_BYTES, parseOperationPayload, requestFrame } from "./protocol";

describe("IPC encoded envelopes", () => {
  test("carries a raw assignment above the retired policy cap under worst-case JSON escaping", () => {
    // Arrange
    const prompt = "\0".repeat(300 * 1024);
    const frame = requestFrame("spawn-max", "agent_spawn", {
      task_name: "pathological",
      subagent_type: "worker",
      prompt,
    });

    // Act
    const encoded = encodeIpcFrame(frame);
    const parsed = parseOperationPayload("agent_spawn", frame.payload);

    // Assert
    expect(parsed.prompt).toBe(prompt);
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(IPC_RECORD_LIMIT_BYTES + 1);
    expect(encoded.endsWith("\n")).toBe(true);
  });

  test("rejects a frame whose encoded record exceeds the cap before transport", () => {
    // Arrange
    const frame = requestFrame("spawn-oversized", "agent_spawn", {
      task_name: "pathological",
      subagent_type: "worker",
      prompt: "\0".repeat(Math.ceil(IPC_RECORD_LIMIT_BYTES / 6) + 1_000),
    });

    // Act
    const encode = () => encodeIpcFrame(frame);

    // Assert
    expect(encode).toThrow("IPC record exceeds the hard byte limit");
  });
});

describe("IPC wait payload", () => {
  test("accepts only whole-second timeouts in the declared range", () => {
    // Arrange
    const values = [0, MAX_WAIT_TIMEOUT_MS / 1_000];

    // Act
    const accepted = values.map((timeout_seconds) =>
      parseOperationPayload("agent_wait", { targets: ["/root/worker"], timeout_seconds }),
    );

    // Assert
    expect(accepted.map((value) => ("timeout_seconds" in value ? value.timeout_seconds : undefined))).toEqual(values);
    for (const timeout_seconds of [-1, 0.5, MAX_WAIT_TIMEOUT_MS / 1_000 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parseOperationPayload("agent_wait", { targets: ["/root/worker"], timeout_seconds })).toThrow(
        `whole number from 0 to ${MAX_WAIT_TIMEOUT_MS / 1_000}`,
      );
    }
  });
});
