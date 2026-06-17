import { describe, expect, test } from "bun:test";
import { buildNotice } from "./notice";

describe("buildNotice", () => {
  test("embeds the drained text and main-oriented handling guidance", () => {
    // Arrange
    const drainOutput = "  From: claude\n  Subject: [REVIEW] x  ";

    // Act
    const notice = buildNotice(drainOutput);

    // Assert
    expect(notice).toContain("📬 AMQ");
    expect(notice).toContain("From: claude");
    expect(notice).toContain("relay it to the user");
    expect(notice).toContain("If the user explicitly asks for a manual AMQ check, obey");
    expect(notice).toContain("do not substitute `.agent-mail` filesystem probes");
    expect(notice).not.toContain("Reply with");
  });
});
