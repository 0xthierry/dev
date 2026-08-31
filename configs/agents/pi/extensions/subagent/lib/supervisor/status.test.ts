import { describe, expect, test } from "bun:test";
import { isActiveStatus, isResumableStatus, isTerminalStatus } from "./status";

describe("agent status classification", () => {
  test("classifies active, resumable, and terminal states", () => {
    // Arrange
    const statuses = ["queued", "starting", "running", "idle", "interrupted", "failed", "unloaded", "closed"] as const;

    // Act
    const result = statuses.map((status) => ({
      status,
      active: isActiveStatus(status),
      resumable: isResumableStatus(status),
      terminal: isTerminalStatus(status),
    }));

    // Assert
    expect(result).toEqual([
      { status: "queued", active: false, resumable: false, terminal: false },
      { status: "starting", active: true, resumable: false, terminal: false },
      { status: "running", active: true, resumable: false, terminal: false },
      { status: "idle", active: false, resumable: true, terminal: false },
      { status: "interrupted", active: false, resumable: true, terminal: false },
      { status: "failed", active: false, resumable: true, terminal: false },
      { status: "unloaded", active: false, resumable: true, terminal: false },
      { status: "closed", active: false, resumable: false, terminal: true },
    ]);
  });
});
