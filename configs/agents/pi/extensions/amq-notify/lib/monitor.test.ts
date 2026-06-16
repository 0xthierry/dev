import { describe, expect, test } from "bun:test";
import { parseMonitorPayload } from "./monitor";

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

describe("parseMonitorPayload", () => {
  test("formats peeked JSON messages and exposes their ids for acknowledgement", () => {
    // Arrange
    const stdout = messageJson;

    // Act
    const payload = parseMonitorPayload(stdout, "pi");

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
    const stdout = JSON.stringify({ event: "timeout", mode: "peek", me: "pi", count: 0, drained: [] });

    // Act
    const payload = parseMonitorPayload(stdout, "pi");

    // Assert
    expect(payload).toEqual({ kind: "empty" });
  });

  test("reports invalid non-empty monitor output", () => {
    // Arrange
    const outputs = ["not-json", JSON.stringify({ count: 1, drained: [{}] })];

    // Act
    const payloads = outputs.map((stdout) => parseMonitorPayload(stdout, "pi"));

    // Assert
    expect(payloads.map((payload) => payload.kind)).toEqual(["invalid", "invalid"]);
  });
});
