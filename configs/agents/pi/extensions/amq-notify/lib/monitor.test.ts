import { describe, expect, test } from "bun:test";
import { parseMonitorResult } from "./monitor";

const messageJson = JSON.stringify({
  event: "messages",
  mode: "peek",
  me: "pi",
  count: 1,
  drained: [
    {
      id: "msg-1",
      from: "claude",
      to: ["pi"],
      thread: "p2p/claude__pi",
      subject: "Review",
      priority: "normal",
      kind: "result",
      body: "done\n",
      moved_to_cur: false,
    },
  ],
});

describe("parseMonitorResult", () => {
  test("formats peeked JSON messages and exposes their ids for acknowledgement", () => {
    // Arrange
    const result = { stdout: messageJson, stderr: "", code: 0 };

    // Act
    const payload = parseMonitorResult(result, "pi");

    // Assert
    expect(payload).toEqual({
      kind: "messages",
      ids: ["msg-1"],
      text: [
        "[AMQ] 1 message available for pi:",
        "",
        "- From: claude",
        "  ID: msg-1",
        "  Subject: Review",
        "  Priority: normal",
        "  Kind: result",
        "  Thread: p2p/claude__pi",
        "  Body:",
        "done",
        "---",
      ].join("\n"),
    });
  });

  test("treats monitor timeouts as empty", () => {
    // Arrange
    const result = {
      stdout: JSON.stringify({ event: "timeout", mode: "peek", me: "pi", count: 0, drained: [] }),
      stderr: "monitor timed out",
      code: 4,
    };

    // Act
    const payload = parseMonitorResult(result, "pi");

    // Assert
    expect(payload).toEqual({ kind: "empty" });
  });

  test("reports invalid non-empty monitor output", () => {
    // Arrange
    const results = [
      { stdout: "not-json", stderr: "", code: 0 },
      { stdout: JSON.stringify({ count: 1, drained: [{}] }), stderr: "", code: 0 },
    ];

    // Act
    const payloads = results.map((result) => parseMonitorResult(result, "pi"));

    // Assert
    expect(payloads.map((payload) => payload.kind)).toEqual(["failure", "failure"]);
  });

  test("reports command failures from stderr instead of treating them as an empty inbox", () => {
    // Arrange
    const result = {
      stdout: "",
      stderr: 'mailbox for "pi" is missing at root /tmp/amq',
      code: 3,
    };

    // Act
    const payload = parseMonitorResult(result, "pi");

    // Assert
    expect(payload).toEqual({
      kind: "failure",
      reason: 'mailbox for "pi" is missing at root /tmp/amq',
    });
  });
});
