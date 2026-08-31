import { describe, expect, test } from "bun:test";
import { createCapabilityAuthority } from "./authentication";

describe("CapabilityAuthority", () => {
  test("issues unique ephemeral capabilities bound to exact callers", () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const caller = { agentId: "agent-1", agentPath: "/root/review" };

    // Act
    const first = authority.issue(caller);
    const second = authority.issue(caller);

    // Assert
    expect(first.token).not.toBe(second.token);
    expect(authority.authenticate(first.token)).toBeUndefined();
    expect(authority.authenticate(second.token)).toEqual(caller);
    expect(JSON.stringify(authority)).not.toContain(first.token);
  });

  test("fails closed for altered capabilities and revokes every caller generation", () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const caller = { agentId: "agent-1", agentPath: "/root/review" };
    const first = authority.issue(caller);
    const second = authority.issue(caller);

    // Act
    const altered = authority.authenticate(`${first.token}x`);
    authority.revoke(caller);

    // Assert
    expect(altered).toBeUndefined();
    expect(authority.authenticate(first.token)).toBeUndefined();
    expect(authority.authenticate(second.token)).toBeUndefined();
  });

  test("rejects non-canonical caller bindings", () => {
    // Arrange
    const authority = createCapabilityAuthority();

    // Act / Assert
    expect(() => authority.issue({ agentId: "agent-1", agentPath: "/root/../escape" })).toThrow(
      "caller path must be canonical",
    );
    expect(() => authority.issue({ agentId: " agent-1", agentPath: "/root/review" })).toThrow(
      "caller ID must be non-empty and exact",
    );
  });
});
