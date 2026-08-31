import { describe, expect, test } from "bun:test";
import {
  auditToolCatalog,
  FAUX_RESPONSE_PLAN_ENV,
  FAUX_RESPONSE_PLANS_BY_DEPTH_ENV,
  FAUX_RESPONSE_PLANS_BY_PROMPT_ENV,
  resolveFauxPromptPlans,
  resolveFauxResponsePlan,
} from "./faux-provider-extension";

describe("resolveFauxResponsePlan", () => {
  test("selects deterministic text and tool-call steps for the current child depth", () => {
    // Arrange
    const environment = {
      PI_SUBAGENT_DEPTH: "1",
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify(["fallback"]),
      [FAUX_RESPONSE_PLANS_BY_DEPTH_ENV]: JSON.stringify({
        1: [{ toolCalls: [{ name: "agent_list", arguments: {} }] }, { text: "child complete" }],
      }),
    };

    // Act
    const plan = resolveFauxResponsePlan(environment);

    // Assert
    expect(plan).toEqual([{ toolCalls: [{ name: "agent_list", arguments: {} }] }, { text: "child complete" }]);
  });

  test("orders prompt selectors deterministically from most to least specific", () => {
    // Arrange
    const environment = {
      [FAUX_RESPONSE_PLANS_BY_PROMPT_ENV]: JSON.stringify({
        leaf: ["leaf"],
        "coordinator-system-prompt.md": ["coordinator"],
      }),
    };

    // Act
    const plans = resolveFauxPromptPlans(environment);

    // Assert
    expect(plans?.map((candidate) => candidate.selector)).toEqual(["coordinator-system-prompt.md", "leaf"]);
  });

  test("parses contextual echo and exact catalog audit steps generically", () => {
    // Arrange
    const environment = {
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify([
        { contextEcho: { sentinel: "STEER-SENTINEL", prefix: "STEER_ECHO" } },
        { finalAnswerEcho: { payloadSentinel: "LEAF-SENTINEL" } },
        { toolCatalogAudit: { expected: ["agent_spawn", "agent_list"], forbidden: ["agent"] } },
      ]),
    };

    // Act
    const plan = resolveFauxResponsePlan(environment);

    // Assert
    expect(plan).toEqual([
      { contextEcho: { sentinel: "STEER-SENTINEL", prefix: "STEER_ECHO" } },
      { finalAnswerEcho: { payloadSentinel: "LEAF-SENTINEL" } },
      { toolCatalogAudit: { expected: ["agent_spawn", "agent_list"], forbidden: ["agent"] } },
    ]);
  });

  test("fails exact catalog audit when the forbidden legacy agent tool is present", () => {
    // Arrange
    const expected = ["agent_spawn", "agent_list"];
    const actual = ["read", "agent_spawn", "agent_list", "agent"];

    // Act
    const audit = auditToolCatalog(actual, expected, ["agent"]);

    // Assert
    expect(audit).toEqual({
      exact: false,
      collaboration: expected,
      presentForbidden: ["agent"],
    });
  });

  test("rejects malformed plans instead of silently changing provider behavior", () => {
    // Arrange
    const environment = { [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify([{ toolCalls: [] }]) };

    // Act / Assert
    expect(() => resolveFauxResponsePlan(environment)).toThrow("toolCalls must be a non-empty array");
  });
});
