import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { TokenSpeedEngine } from "./engine";

afterEach(() => {
  setSystemTime();
});

describe("TokenSpeedEngine", () => {
  test("uses average TPS while the sliding window is still filling", () => {
    // Arrange
    setSystemTime(new Date(1_000));
    const engine = new TokenSpeedEngine();
    engine.start();
    setSystemTime(new Date(1_100));
    engine.recordTokens(2);
    setSystemTime(new Date(1_500));

    // Act
    const snapshot = engine.snapshot();

    // Assert
    expect(snapshot.tokenCount).toBe(2);
    expect(snapshot.elapsedSeconds).toBe(0.5);
    expect(snapshot.tps).toBe(4);
  });

  test("calculates current TPS from the one-second sliding window", () => {
    // Arrange
    setSystemTime(new Date(1_000));
    const engine = new TokenSpeedEngine();
    engine.start();
    engine.recordTokens(1);
    setSystemTime(new Date(1_600));
    engine.recordTokens(1);
    setSystemTime(new Date(2_100));
    engine.recordTokens(1);
    setSystemTime(new Date(2_500));
    engine.recordTokens(1);
    setSystemTime(new Date(2_600));

    // Act
    const snapshot = engine.snapshot();

    // Assert
    expect(snapshot.tokenCount).toBe(4);
    expect(snapshot.tps).toBe(3);
  });

  test("returns final average TPS and stops streaming", () => {
    // Arrange
    setSystemTime(new Date(1_100));
    const engine = new TokenSpeedEngine();
    engine.start();
    setSystemTime(new Date(1_200));
    engine.recordTokens(2);
    setSystemTime(new Date(1_600));

    // Act
    const snapshot = engine.stop();

    // Assert
    expect(engine.isStreaming).toBe(false);
    expect(snapshot).toEqual({ tokenCount: 2, elapsedSeconds: 0.5, tps: 4 });
  });

  test("ignores token records while idle", () => {
    // Arrange
    setSystemTime(new Date(1));
    const engine = new TokenSpeedEngine();

    // Act
    engine.recordTokens(3);
    const snapshot = engine.snapshot();

    // Assert
    expect(engine.tokenCount).toBe(0);
    expect(snapshot).toEqual({ tokenCount: 0, elapsedSeconds: 0, tps: 0 });
  });
});
