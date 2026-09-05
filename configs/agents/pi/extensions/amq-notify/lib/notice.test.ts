import { describe, expect, test } from "bun:test";
import { buildNotice } from "./notice";

describe("buildNotice", () => {
  test("embeds the drained text and main-oriented handling guidance", () => {
    // Arrange
    const drainOutput = "  From: claude\n  Subject: [REVIEW] x  ";

    // Act
    const notice = buildNotice(drainOutput, "main");

    // Assert
    expect(notice).toContain("📬 AMQ");
    expect(notice).toContain("From: claude");
    expect(notice).toContain("relay it to the user");
    expect(notice).toContain("amq reply --id <message-id> --strict");
    expect(notice).toContain("do not send a redundant acknowledgement");
    expect(notice).toContain("If the user explicitly asks for a manual AMQ check, obey");
    expect(notice).toContain("do not substitute `.agent-mail` filesystem probes");
  });

  test("tells workers to preserve reply lineage", () => {
    // Arrange
    const drainOutput = "  From: pi\n  ID: task-1\n  Kind: todo  ";

    // Act
    const notice = buildNotice(drainOutput, "worker");

    // Assert
    expect(notice).toContain("Handle the assigned task");
    expect(notice).toContain("amq reply --id <message-id> --strict");
    expect(notice).toContain("amq send --strict");
    expect(notice).not.toContain("relay it to the user");
  });
});
