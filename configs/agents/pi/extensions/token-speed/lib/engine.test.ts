import { describe, expect, test } from "bun:test";
import { TokenSpeedEngine } from "./engine";

describe("TokenSpeedEngine", () => {
  test("uses average TPS while the sliding window is still filling", () => {
    // Arrange
    let now = 0;
    const engine = new TokenSpeedEngine(() => now);
    engine.start();
    now = 100;
    engine.recordTokens(2);
    now = 500;

    // Act
    const snapshot = engine.snapshot();

    // Assert
    expect(snapshot.tokenCount).toBe(2);
    expect(snapshot.elapsedSeconds).toBe(0.5);
    expect(snapshot.tps).toBe(4);
  });

  test("calculates current TPS from the one-second sliding window", () => {
    // Arrange
    let now = 0;
    const engine = new TokenSpeedEngine(() => now);
    engine.start();
    engine.recordTokens(1);
    now = 600;
    engine.recordTokens(1);
    now = 1_100;
    engine.recordTokens(1);
    now = 1_500;
    engine.recordTokens(1);
    now = 1_600;

    // Act
    const snapshot = engine.snapshot();

    // Assert
    expect(snapshot.tokenCount).toBe(4);
    expect(snapshot.tps).toBe(3);
  });

  test("returns final average TPS and stops streaming", () => {
    // Arrange
    let now = 100;
    const engine = new TokenSpeedEngine(() => now);
    engine.start();
    now = 200;
    engine.recordTokens(2);
    now = 600;

    // Act
    const snapshot = engine.stop();

    // Assert
    expect(engine.isStreaming).toBe(false);
    expect(snapshot).toEqual({ tokenCount: 2, elapsedSeconds: 0.5, tps: 4 });
  });

  test("ignores token records while idle", () => {
    // Arrange
    const engine = new TokenSpeedEngine(() => 0);

    // Act
    engine.recordTokens(3);
    const snapshot = engine.snapshot();

    // Assert
    expect(engine.tokenCount).toBe(0);
    expect(snapshot).toEqual({ tokenCount: 0, elapsedSeconds: 0, tps: 0 });
  });
});
