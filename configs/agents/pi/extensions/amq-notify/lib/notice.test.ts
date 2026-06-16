import { describe, expect, test } from "bun:test";
import { buildNotice, isEmptyMonitorOutput } from "./notice";

describe("buildNotice", () => {
  test("embeds the drained text and main-oriented handling guidance", () => {
    const notice = buildNotice("  From: claude\n  Subject: [REVIEW] x  ");

    expect(notice).toContain("📬 AMQ");
    expect(notice).toContain("From: claude");
    expect(notice).toContain("relay it to the user");
    expect(notice).not.toContain("Reply with");
  });
});

describe("isEmptyMonitorOutput", () => {
  test("treats blank output as empty", () => {
    expect(isEmptyMonitorOutput("   \n ")).toBe(true);
  });

  test("treats timeout/empty markers as empty", () => {
    expect(isEmptyMonitorOutput("No new messages (timeout)")).toBe(true);
    expect(isEmptyMonitorOutput("No messages to drain")).toBe(true);
  });

  test("treats a real message as non-empty", () => {
    expect(isEmptyMonitorOutput("[AMQ] 1 message(s) for pi:\n\n- From: claude")).toBe(false);
  });
});
