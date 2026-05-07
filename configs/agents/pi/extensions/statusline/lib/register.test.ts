import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerStatusline } from "./register";
import type { StatuslineRuntime } from "./types";

describe("registerStatusline", () => {
  test("sets a footer status on session start", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    const setStatus = mock(() => undefined);
    registerStatusline(fakePi.pi, runtime, { refreshMs: 60_000 });

    // Act
    await fakePi.emit("session_start", {}, createUiContext(setStatus));
    await fakePi.emit("session_shutdown", {}, createUiContext(setStatus));

    // Assert
    expect(runtime.loadStatus).toHaveBeenCalledWith("/repo", undefined);
    expect(setStatus).toHaveBeenCalledWith(
      "thierry-statusline",
      "accent:PR #42dim: · success:+2dim:/error:-1 warning:~1dim: · warning:NET USD 80.00",
    );
  });

  test("refreshes the footer status when a turn ends", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    const setStatus = mock(() => undefined);
    registerStatusline(fakePi.pi, runtime, { refreshMs: 60_000 });

    // Act
    await fakePi.emit("turn_end", {}, createUiContext(setStatus));

    // Assert
    expect(runtime.loadStatus).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(
      "thierry-statusline",
      "accent:PR #42dim: · success:+2dim:/error:-1 warning:~1dim: · warning:NET USD 80.00",
    );
  });

  test("does not load status when UI is unavailable", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    registerStatusline(fakePi.pi, runtime, { refreshMs: 60_000 });

    // Act
    await fakePi.emit("session_start", {}, { hasUI: false });

    // Assert
    expect(runtime.loadStatus).not.toHaveBeenCalled();
  });
});

function fakeRuntime(): StatuslineRuntime {
  return {
    loadStatus: mock(async () => ({
      git: {
        branch: "feature/pr-42-statusline",
        pullRequest: { number: 42, source: "branch" as const },
        changes: { added: 2, removed: 1, changedFiles: 1, untrackedFiles: 0, binaryFiles: 0 },
      },
      stock: { symbol: "NET", label: "NET", price: 80, currency: "USD" },
    })),
  };
}

function createUiContext(setStatus: (key: string, text?: string) => void): Record<string, unknown> {
  return {
    hasUI: true,
    ui: {
      setStatus,
      theme: {
        fg: (name: string, text: string) => `${name}:${text}`,
      },
    },
  };
}
