import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendAgentFeedbackEntry } from "./storage";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

describe("appendAgentFeedbackEntry", () => {
  test("creates the feedback file with a heading and first entry", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-agent-feedback-storage-"));
    const filePath = join(tempDir, ".pi", "agent", "feedback", "project", "agent_feedback.md");
    const entry = "## 2026-05-11 09:07 — verification_blocker\n\nSummary: Could not verify.\n\n";

    // Act
    await appendAgentFeedbackEntry({ filePath, entry });
    const content = await readFile(filePath, "utf8");

    // Assert
    expect(content).toContain("# Agent Feedback\n\n");
    expect(content).toContain("Summary: Could not verify.");
  });

  test("appends entries to an existing feedback file without duplicating the heading", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-agent-feedback-storage-"));
    const filePath = join(tempDir, "agent_feedback.md");
    await writeFile(filePath, "# Existing Feedback\n\n## first\n\n", "utf8");
    const entry = "## second\n\nSummary: Another entry.\n\n";

    // Act
    await appendAgentFeedbackEntry({ filePath, entry });
    const content = await readFile(filePath, "utf8");

    // Assert
    expect(content).toBe("# Existing Feedback\n\n## first\n\n## second\n\nSummary: Another entry.\n\n");
  });

  test("separates an appended entry when the existing file has no trailing newline", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-agent-feedback-storage-"));
    const filePath = join(tempDir, "agent_feedback.md");
    await writeFile(filePath, "# Existing Feedback", "utf8");
    const entry = "## second\n\nSummary: Another entry.\n\n";

    // Act
    await appendAgentFeedbackEntry({ filePath, entry });
    const content = await readFile(filePath, "utf8");

    // Assert
    expect(content).toBe("# Existing Feedback\n\n## second\n\nSummary: Another entry.\n\n");
  });
});
