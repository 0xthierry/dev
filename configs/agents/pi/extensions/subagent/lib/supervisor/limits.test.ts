import { describe, expect, test } from "bun:test";
import { assertConfigurableLimit, SUPERVISOR_LIMIT_EVIDENCE } from "./limits";

describe("supervisor limit evidence", () => {
  test("documents a concrete resource, unit, range, and rationale for every limit", () => {
    // Arrange
    const evidence = Object.values(SUPERVISOR_LIMIT_EVIDENCE);

    // Act
    const complete = evidence.every(
      (limit) =>
        limit.resource.length > 0 &&
        limit.unit.length > 0 &&
        limit.rationale.length > 0 &&
        limit.minimum <= limit.default &&
        (!("hardMaximum" in limit) || limit.default <= limit.hardMaximum),
    );

    // Assert
    expect(complete).toBe(true);
  });

  test("uses child-only active and persistent-process resident defaults", () => {
    // Arrange
    const active = SUPERVISOR_LIMIT_EVIDENCE.activeAgents;
    const resident = SUPERVISOR_LIMIT_EVIDENCE.residentAgents;
    const depth = SUPERVISOR_LIMIT_EVIDENCE.depth;
    const wait = SUPERVISOR_LIMIT_EVIDENCE.waitTimeoutMs;

    // Act
    const defaults = {
      active: active.default,
      resident: resident.default,
      depth: depth.default,
      wait: wait.default,
      waitMax: wait.hardMaximum,
    };

    // Assert
    expect(defaults).toEqual({ active: 8, resident: 16, depth: 1, wait: 30_000, waitMax: 3_600_000 });
  });

  test("accepts trusted machine budgets above the retired policy caps", () => {
    // Arrange
    const values = { activeAgents: 160, residentAgents: 320, depth: 80 } as const;

    // Act
    const validate = () => {
      for (const [name, value] of Object.entries(values)) {
        assertConfigurableLimit(name as keyof typeof values, value);
      }
    };

    // Assert
    expect(validate).not.toThrow();
  });
});
