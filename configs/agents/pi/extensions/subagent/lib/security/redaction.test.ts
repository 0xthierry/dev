import { describe, expect, test } from "bun:test";
import { createEnvironmentRedactor, redactStringValues } from "./redaction";

describe("environment redaction", () => {
  test("scrubs inherited credentials and explicit control capabilities while preserving normal text", () => {
    // Arrange
    const redact = createEnvironmentRedactor(
      { PROVIDER_API_KEY: "provider-sentinel-123", HOME: "/home/test", PASSWORD_HINT: "password" },
      ["control-token-sentinel", "/tmp/private-control.sock"],
    );

    // Act
    const result = redact(
      "normal provider-sentinel-123 control-token-sentinel /tmp/private-control.sock /home/test password",
    );

    // Assert
    expect(result).toBe("normal [REDACTED] [REDACTED] [REDACTED] /home/test [REDACTED]");
  });

  test("scrubs short and common known values without treating sensitive variable names as values", () => {
    // Arrange
    const redact = createEnvironmentRedactor(
      { AUTH_TOKEN: "abc1234", SERVICE_PASSWORD: "password", ORDINARY_NAME: "AUTH_TOKEN" },
      ["x"],
    );

    // Act
    const result = redact("AUTH_TOKEN abc1234 password x ordinary");

    // Assert
    expect(result).toBe("AUTH_TOKEN [REDACTED] [REDACTED] [REDACTED] ordinary");
  });

  test("is idempotent across repeated sink layers even when a secret occurs inside the marker", () => {
    // Arrange
    const redact = createEnvironmentRedactor({ API_KEY: "E", OTHER_SECRET: "[REDACTED]" });

    // Act
    const once = redact("SECRET [REDACTED]");
    const throughPipeline = [1, 2, 3, 4].reduce((value) => redact(value), once);

    // Assert
    expect(once).toBe("S[REDACTED]CR[REDACTED]T [REDACTED]");
    expect(throughPipeline).toBe(once);
  });

  test("recursively scrubs string values without logging or rewriting object keys", () => {
    // Arrange
    const redact = createEnvironmentRedactor({ AUTH_TOKEN: "sensitive-value-456" });
    const input = { event: "completed", nested: ["safe", { output: "sensitive-value-456" }] };

    // Act
    const result = redactStringValues(input, redact);

    // Assert
    expect(result).toEqual({ event: "completed", nested: ["safe", { output: "[REDACTED]" }] });
    expect(input.nested[1]).toEqual({ output: "sensitive-value-456" });
  });
});
