import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const FAUX_PROVIDER_NAME = "pi-extension-e2e-faux";
export const FAUX_MODEL_ID = "pi-extension-e2e-faux-model";
export const FAUX_ALT_MODEL_ID = "pi-extension-e2e-faux-model-alt";
export const FAUX_API_KEY_ENV = "PI_EXTENSION_E2E_FAUX_API_KEY";
export const FAUX_RESPONSE_TEXT_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT";
export const FAUX_TOOL_CALLS_ENV = "PI_EXTENSION_E2E_FAUX_TOOL_CALLS";
export const FAUX_RESPONSE_PLAN_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_PLAN";
export const FAUX_RESPONSE_PLANS_BY_DEPTH_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_PLANS_BY_DEPTH";
export const FAUX_RESPONSE_PLANS_BY_PROMPT_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_PLANS_BY_PROMPT";
export const FAUX_TOKENS_PER_SECOND_ENV = "PI_EXTENSION_E2E_FAUX_TOKENS_PER_SECOND";
export const FAUX_TOKENS_PER_SECOND_BY_DEPTH_ENV = "PI_EXTENSION_E2E_FAUX_TOKENS_PER_SECOND_BY_DEPTH";
export const DEFAULT_FAUX_RESPONSE_TEXT = "Pi extension E2E faux response.";

const model = {
  id: FAUX_MODEL_ID,
  name: "Pi Extension E2E Faux Model",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1_024,
};
const alternateModel = { ...model, id: FAUX_ALT_MODEL_ID, name: "Pi Extension E2E Faux Alternate Model" };

export default function (pi: ExtensionAPI) {
  const faux = registerFauxProvider({
    provider: FAUX_PROVIDER_NAME,
    models: [model, alternateModel],
    tokensPerSecond: getTokensPerSecond(process.env),
  });

  faux.setResponses(getFauxResponses());

  pi.registerProvider(FAUX_PROVIDER_NAME, {
    name: "Pi Extension E2E Faux Provider",
    baseUrl: "http://localhost:0",
    apiKey: `$${FAUX_API_KEY_ENV}`,
    api: faux.api,
    models: [model, alternateModel],
  });
}

function getFauxResponses() {
  const plan = resolveFauxResponsePlan(process.env);
  const promptPlans = resolveFauxPromptPlans(process.env);
  if (promptPlans) {
    const length = Math.max(plan?.length ?? 0, ...promptPlans.map((candidate) => candidate.plan.length));
    return Array.from({ length }, (_, index) => (context: Context) => {
      const selected = promptPlans.find((candidate) => context.systemPrompt?.includes(candidate.selector))?.plan;
      const step = selected?.[index] ?? plan?.[index] ?? { text: DEFAULT_FAUX_RESPONSE_TEXT };
      return responseFromPlanStep(step, context);
    });
  }
  if (plan) {
    return plan.map((step) =>
      isContextualStep(step) ? (context: Context) => responseFromPlanStep(step, context) : responseFromPlanStep(step),
    );
  }
  const toolCalls = getFauxToolCalls();
  const finalMessage = fauxAssistantMessage(getFauxResponseText());
  if (toolCalls.length === 0) return [finalMessage];
  return [fauxAssistantMessage(toolCalls, { stopReason: "toolUse" }), finalMessage];
}

export type FauxResponsePlanStep =
  | { text: string }
  | { toolCalls: Array<{ name: string; arguments?: Record<string, unknown>; id?: string }> }
  | { contextEcho: { sentinel: string; prefix?: string } }
  | { finalAnswerEcho: { payloadSentinel: string; prefix?: string } }
  | { toolCatalogAudit: { expected: string[]; forbidden?: string[] } };

export function resolveFauxResponsePlan(environment: NodeJS.ProcessEnv): FauxResponsePlanStep[] | undefined {
  const depth = normalizedDepth(environment.PI_SUBAGENT_DEPTH);
  const byDepth = environment[FAUX_RESPONSE_PLANS_BY_DEPTH_ENV];
  let raw = environment[FAUX_RESPONSE_PLAN_ENV];
  if (byDepth) {
    const parsed = parseRecord(byDepth, FAUX_RESPONSE_PLANS_BY_DEPTH_ENV);
    const selected = parsed[String(depth)];
    if (selected !== undefined) raw = JSON.stringify(selected);
  }
  if (!raw) return undefined;
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV} must be a non-empty JSON array`);
  }
  return value.map((item, index) => parsePlanStep(item, index));
}

export function resolveFauxPromptPlans(
  environment: NodeJS.ProcessEnv,
): Array<{ selector: string; plan: FauxResponsePlanStep[] }> | undefined {
  const raw = environment[FAUX_RESPONSE_PLANS_BY_PROMPT_ENV];
  if (!raw) return undefined;
  const record = parseRecord(raw, FAUX_RESPONSE_PLANS_BY_PROMPT_ENV);
  const plans = Object.entries(record)
    .map(([selector, value]) => {
      if (!selector) throw new Error(`${FAUX_RESPONSE_PLANS_BY_PROMPT_ENV} selectors must be non-empty`);
      if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${FAUX_RESPONSE_PLANS_BY_PROMPT_ENV}.${selector} must be a non-empty array`);
      }
      return { selector, plan: value.map((step, index) => parsePlanStep(step, index)) };
    })
    .sort((left, right) => right.selector.length - left.selector.length || left.selector.localeCompare(right.selector));
  return plans.length ? plans : undefined;
}

function responseFromPlanStep(step: FauxResponsePlanStep, context?: Context) {
  if ("text" in step) return fauxAssistantMessage(step.text);
  if ("toolCalls" in step) {
    return fauxAssistantMessage(
      step.toolCalls.map((call) =>
        fauxToolCall(call.name, call.arguments ?? {}, call.id ? { id: call.id } : undefined),
      ),
      { stopReason: "toolUse" },
    );
  }
  const strings = collectStrings(context);
  if ("contextEcho" in step) {
    const found = strings.some((value) => value.includes(step.contextEcho.sentinel));
    return fauxAssistantMessage(
      found
        ? `${step.contextEcho.prefix ?? "CONTEXT_ECHO"} ${step.contextEcho.sentinel}`
        : `MISSING_CONTEXT_SENTINEL ${step.contextEcho.sentinel}`,
    );
  }
  if ("finalAnswerEcho" in step) {
    const answer = strings.find(
      (value) => value.includes("Message Type: FINAL_ANSWER") && value.includes(step.finalAnswerEcho.payloadSentinel),
    );
    const sender = answer?.match(/(?:^|\n)Sender: ([^\n]+)/)?.[1];
    return fauxAssistantMessage(
      answer && sender
        ? `${step.finalAnswerEcho.prefix ?? "FINAL_ANSWER_ECHO"} ${step.finalAnswerEcho.payloadSentinel} sender=${sender}`
        : `MISSING_FINAL_ANSWER ${step.finalAnswerEcho.payloadSentinel}`,
    );
  }
  const names = Array.isArray(context?.tools) ? context.tools.map((tool) => tool.name) : [];
  const audit = auditToolCatalog(names, step.toolCatalogAudit.expected, step.toolCatalogAudit.forbidden ?? []);
  return fauxAssistantMessage(
    `TOOL_CATALOG_AUDIT exact=${audit.exact} names=${audit.collaboration.join(",")} forbidden=${audit.presentForbidden.join(",") || "none"}`,
  );
}

export function auditToolCatalog(
  actual: readonly string[],
  expected: readonly string[],
  forbidden: readonly string[] = [],
): { exact: boolean; collaboration: string[]; presentForbidden: string[] } {
  const expectedNames = new Set(expected);
  const collaboration = actual.filter((name) => expectedNames.has(name));
  const presentForbidden = forbidden.filter((name) => actual.includes(name));
  return {
    exact:
      collaboration.length === expected.length &&
      collaboration.every((name, index) => name === expected[index]) &&
      presentForbidden.length === 0,
    collaboration,
    presentForbidden,
  };
}

function isContextualStep(step: FauxResponsePlanStep): boolean {
  return "contextEcho" in step || "finalAnswerEcho" in step || "toolCatalogAudit" in step;
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== "object") return [];
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
}

function getFauxToolCalls() {
  const raw = process.env[FAUX_TOOL_CALLS_ENV];
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${FAUX_TOOL_CALLS_ENV} must be a JSON array`);
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}] must be an object`);
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || !value.name) {
      throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}].name must be a non-empty string`);
    }
    const args = value.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}].arguments must be an object when provided`);
    }
    const id = typeof value.id === "string" && value.id ? value.id : undefined;
    return fauxToolCall(value.name, args as Record<string, unknown>, id ? { id } : undefined);
  });
}

function getFauxResponseText(): string {
  return process.env[FAUX_RESPONSE_TEXT_ENV] || DEFAULT_FAUX_RESPONSE_TEXT;
}

function getTokensPerSecond(environment: NodeJS.ProcessEnv): number {
  const depth = normalizedDepth(environment.PI_SUBAGENT_DEPTH);
  const byDepth = environment[FAUX_TOKENS_PER_SECOND_BY_DEPTH_ENV];
  let raw = environment[FAUX_TOKENS_PER_SECOND_ENV];
  if (byDepth) {
    const parsed = parseRecord(byDepth, FAUX_TOKENS_PER_SECOND_BY_DEPTH_ENV);
    const selected = parsed[String(depth)];
    if (selected !== undefined) raw = String(selected);
  }
  if (raw === undefined || raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error("Faux tokens per second must be a non-negative number");
  return value;
}

function parsePlanStep(value: unknown, index: number): FauxResponsePlanStep {
  if (typeof value === "string") return { text: value };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${index}] must be a string or object`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1) throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${index}] must contain exactly one step kind`);
  if (typeof record.text === "string") return { text: record.text };
  if (record.contextEcho !== undefined) {
    return {
      contextEcho: parseEcho(record.contextEcho, index, "contextEcho", "sentinel") as {
        sentinel: string;
        prefix?: string;
      },
    };
  }
  if (record.finalAnswerEcho !== undefined) {
    return {
      finalAnswerEcho: parseEcho(record.finalAnswerEcho, index, "finalAnswerEcho", "payloadSentinel") as {
        payloadSentinel: string;
        prefix?: string;
      },
    };
  }
  if (record.toolCatalogAudit !== undefined) {
    const audit = parseRecordValue(record.toolCatalogAudit, `${FAUX_RESPONSE_PLAN_ENV}[${index}].toolCatalogAudit`);
    if (
      !Array.isArray(audit.expected) ||
      audit.expected.length === 0 ||
      !audit.expected.every((name) => typeof name === "string" && name)
    ) {
      throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${index}].toolCatalogAudit.expected must be a non-empty string array`);
    }
    if (
      audit.forbidden !== undefined &&
      (!Array.isArray(audit.forbidden) || !audit.forbidden.every((name) => typeof name === "string" && name))
    ) {
      throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${index}].toolCatalogAudit.forbidden must be a string array`);
    }
    const unknown = Object.keys(audit).filter((key) => key !== "expected" && key !== "forbidden");
    if (unknown.length) {
      throw new Error(
        `${FAUX_RESPONSE_PLAN_ENV}[${index}].toolCatalogAudit contains unknown fields: ${unknown.join(", ")}`,
      );
    }
    return {
      toolCatalogAudit: {
        expected: audit.expected as string[],
        ...(Array.isArray(audit.forbidden) ? { forbidden: audit.forbidden as string[] } : {}),
      },
    };
  }
  if (!Array.isArray(record.toolCalls) || record.toolCalls.length === 0) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${index}].toolCalls must be a non-empty array`);
  }
  return {
    toolCalls: record.toolCalls.map((call, callIndex) => parsePlanToolCall(call, index, callIndex)),
  };
}

function parseEcho(
  value: unknown,
  stepIndex: number,
  kind: "contextEcho" | "finalAnswerEcho",
  sentinelField: "sentinel" | "payloadSentinel",
): Record<string, string> {
  const label = `${FAUX_RESPONSE_PLAN_ENV}[${stepIndex}].${kind}`;
  const record = parseRecordValue(value, label);
  const sentinel = record[sentinelField];
  if (typeof sentinel !== "string" || !sentinel) throw new Error(`${label}.${sentinelField} must be non-empty`);
  if (record.prefix !== undefined && (typeof record.prefix !== "string" || !record.prefix)) {
    throw new Error(`${label}.prefix must be non-empty`);
  }
  return { [sentinelField]: sentinel, ...(typeof record.prefix === "string" ? { prefix: record.prefix } : {}) };
}

function parsePlanToolCall(value: unknown, stepIndex: number, callIndex: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${stepIndex}].toolCalls[${callIndex}] must be an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${stepIndex}].toolCalls[${callIndex}].name must be non-empty`);
  }
  const argumentsValue = record.arguments ?? {};
  if (!argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${stepIndex}].toolCalls[${callIndex}].arguments must be an object`);
  }
  if (record.id !== undefined && (typeof record.id !== "string" || !record.id)) {
    throw new Error(`${FAUX_RESPONSE_PLAN_ENV}[${stepIndex}].toolCalls[${callIndex}].id must be non-empty`);
  }
  return {
    name: record.name,
    arguments: argumentsValue as Record<string, unknown>,
    ...(typeof record.id === "string" ? { id: record.id } : {}),
  };
}

function parseRecord(raw: string, name: string): Record<string, unknown> {
  return parseRecordValue(JSON.parse(raw) as unknown, name);
}

function parseRecordValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  return value as Record<string, unknown>;
}

function normalizedDepth(value: string | undefined): number {
  const depth = Number(value);
  return Number.isInteger(depth) && depth > 0 ? depth : 0;
}
