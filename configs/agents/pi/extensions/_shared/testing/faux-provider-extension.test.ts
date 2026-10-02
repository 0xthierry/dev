import { describe, expect, test } from "bun:test";
import { normalizeContext, type Tool } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  auditToolCatalog,
  FAUX_RESPONSE_PLAN_ENV,
  FAUX_RESPONSE_PLANS_BY_DEPTH_ENV,
  FAUX_RESPONSE_PLANS_BY_PROMPT_ENV,
  FAUX_TOOL_CALLS_ENV,
  getFauxResponses,
  resolveFauxPromptPlans,
  resolveFauxResponsePlan,
} from "./faux-provider-extension";

function requireResponseFactory(environment: NodeJS.ProcessEnv) {
  const [response] = getFauxResponses(environment);
  if (typeof response !== "function") throw new Error("Expected a contextual faux response");
  return response;
}

function tool(name: string): Tool {
  return { name, description: `${name} fixture tool`, parameters: Type.Object({}) };
}

describe("transcript-driven faux responses", () => {
  test("selects the most specific prompt plan from the current patched system sections", () => {
    // Arrange
    const response = requireResponseFactory({
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify(["fallback"]),
      [FAUX_RESPONSE_PLANS_BY_PROMPT_ENV]: JSON.stringify({
        "old-role": ["stale selection"],
        worker: ["generic selection"],
        "specialist-worker": ["specialist selection"],
      }),
    });
    const context = normalizeContext({
      messages: [
        { role: "system", content: "Base instructions", sections: { role: "old-role" }, timestamp: 0 },
        { role: "user", content: "old-role is only user text", timestamp: 1 },
        { role: "system", content: "", sections: { role: "specialist-worker" }, timestamp: 2 },
      ],
    });

    // Act
    const message = response(context);

    // Assert
    expect(message.content).toEqual([{ type: "text", text: "specialist selection" }]);
  });

  test("uses the fallback plan when a selector was removed from the system prompt", () => {
    // Arrange
    const response = requireResponseFactory({
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify(["fallback selection"]),
      [FAUX_RESPONSE_PLANS_BY_PROMPT_ENV]: JSON.stringify({ "old-role": ["stale selection"] }),
    });
    const context = normalizeContext({
      messages: [
        { role: "system", content: "Base instructions", sections: { role: "old-role" }, timestamp: 0 },
        { role: "system", content: "", sections: { role: null }, timestamp: 1 },
      ],
    });

    // Act
    const message = response(context);

    // Assert
    expect(message.content).toEqual([{ type: "text", text: "fallback selection" }]);
  });

  test("audits the active catalog after transcript tool additions and removals", () => {
    // Arrange
    const response = requireResponseFactory({
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify([
        { toolCatalogAudit: { expected: ["agent_spawn", "agent_list"], forbidden: ["agent"] } },
      ]),
    });
    const context = normalizeContext({
      messages: [
        { role: "system", content: "", toolsAdded: [tool("read"), tool("agent")], timestamp: 0 },
        {
          role: "system",
          content: "",
          toolsRemoved: [{ name: "agent" }],
          toolsAdded: [tool("agent_spawn"), tool("agent_list")],
          timestamp: 1,
        },
      ],
    });

    // Act
    const message = response(context);

    // Assert
    expect(message.content).toEqual([
      { type: "text", text: "TOOL_CATALOG_AUDIT exact=true names=agent_spawn,agent_list forbidden=none" },
    ]);
  });

  test("reports a forbidden tool still declared in the transcript", () => {
    // Arrange
    const response = requireResponseFactory({
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify([
        { toolCatalogAudit: { expected: ["agent_spawn"], forbidden: ["agent"] } },
      ]),
    });
    const context = normalizeContext({
      messages: [{ role: "system", content: "", toolsAdded: [tool("agent_spawn"), tool("agent")], timestamp: 0 }],
    });

    // Act
    const message = response(context);

    // Assert
    expect(message.content).toEqual([
      { type: "text", text: "TOOL_CATALOG_AUDIT exact=false names=agent_spawn forbidden=agent" },
    ]);
  });
});

describe("JSON tool arguments", () => {
  test("preserves nested JSON values in planned tool arguments", () => {
    // Arrange
    const environment = {
      [FAUX_RESPONSE_PLAN_ENV]: JSON.stringify([
        {
          toolCalls: [
            {
              name: "read",
              id: "planned-call",
              arguments: { path: "notes.md", options: { enabled: true, limit: 2 }, values: [null, "text", 3] },
            },
          ],
        },
      ]),
    };

    // Act
    const plan = resolveFauxResponsePlan(environment);

    // Assert
    expect(plan).toEqual([
      {
        toolCalls: [
          {
            name: "read",
            id: "planned-call",
            arguments: { path: "notes.md", options: { enabled: true, limit: 2 }, values: [null, "text", 3] },
          },
        ],
      },
    ]);
  });

  test("preserves nested JSON values in direct faux tool-call responses", () => {
    // Arrange
    const environment = {
      [FAUX_TOOL_CALLS_ENV]: JSON.stringify([
        {
          name: "read",
          id: "direct-call",
          arguments: { path: "notes.md", options: { enabled: false }, values: [null, 3] },
        },
      ]),
    };

    // Act
    const [response] = getFauxResponses(environment);

    // Assert
    expect(response).toMatchObject({
      stopReason: "toolUse",
      content: [
        {
          type: "toolCall",
          name: "read",
          id: "direct-call",
          arguments: { path: "notes.md", options: { enabled: false }, values: [null, 3] },
        },
      ],
    });
  });

  test("rejects non-finite JSON numbers in planned tool arguments", () => {
    // Arrange
    const environment = {
      [FAUX_RESPONSE_PLAN_ENV]: '[{"toolCalls":[{"name":"read","arguments":{"options":{"limit":1e400}}}]}]',
    };

    // Act / Assert
    expect(() => resolveFauxResponsePlan(environment)).toThrow(
      `${FAUX_RESPONSE_PLAN_ENV}[0].toolCalls[0].arguments must be a JSON object`,
    );
  });

  test("rejects non-finite JSON numbers in direct faux tool arguments", () => {
    // Arrange
    const environment = {
      [FAUX_TOOL_CALLS_ENV]: '[{"name":"read","arguments":{"values":[1e400]}}]',
    };

    // Act / Assert
    expect(() => getFauxResponses(environment)).toThrow(`${FAUX_TOOL_CALLS_ENV}[0].arguments must be a JSON object`);
  });
});

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
