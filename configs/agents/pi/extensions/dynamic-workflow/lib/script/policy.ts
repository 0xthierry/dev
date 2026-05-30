import type { Node } from "acorn";

export interface WorkflowPolicyOptions {
  maxScriptBytes?: number;
}

const DEFAULT_MAX_SCRIPT_BYTES = 64 * 1024;
const FORBIDDEN_IDENTIFIERS = new Set([
  "Date",
  "eval",
  "fetch",
  "Function",
  "global",
  "globalThis",
  "importScripts",
  "require",
  "WebSocket",
  "window",
  "XMLHttpRequest",
]);

const FORBIDDEN_MEMBER_PATTERNS = new Set([
  "Math.random",
  "process.env",
  "process.exit",
  "process.kill",
  "process.mainModule",
  "process.binding",
  "process._linkedBinding",
]);

export function assertWorkflowSourcePolicy(script: string, options: WorkflowPolicyOptions = {}): void {
  const maxBytes = options.maxScriptBytes ?? DEFAULT_MAX_SCRIPT_BYTES;
  if (Buffer.byteLength(script, "utf8") > maxBytes) {
    throw new Error(
      `Workflow script is too large (${Buffer.byteLength(script, "utf8")} bytes). Maximum is ${maxBytes}.`,
    );
  }
}

export function assertWorkflowAstPolicy(ast: Node): void {
  walkNode(ast, undefined);
}

function walkNode(node: unknown, parent: Node | undefined): void {
  if (!isNode(node)) return;

  assertNodePolicy(node, parent);

  for (const [key, value] of Object.entries(node as unknown as Record<string, unknown>)) {
    if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
    if (Array.isArray(value)) {
      for (const child of value) walkNode(child, node);
      continue;
    }
    walkNode(value, node);
  }
}

function assertNodePolicy(node: Node, parent: Node | undefined): void {
  switch (node.type) {
    case "ExportAllDeclaration":
    case "ExportDefaultDeclaration":
    case "ImportDeclaration":
      throw new Error(`Workflow scripts cannot use ${node.type}.`);
    case "ImportExpression":
      throw new Error("Workflow scripts cannot use dynamic import().");
    case "NewExpression":
      assertNewExpressionPolicy(node as Node & { callee?: unknown });
      return;
    case "CallExpression":
      assertCallExpressionPolicy(node as Node & { callee?: unknown });
      return;
    case "Identifier":
      assertIdentifierPolicy(node as Node & { name?: string }, parent);
      return;
    case "MemberExpression":
      assertMemberExpressionPolicy(node as Node & { object?: unknown; property?: unknown; computed?: boolean });
      return;
  }
}

function assertNewExpressionPolicy(node: Node & { callee?: unknown }): void {
  const callee = identifierName(node.callee);
  if (callee === "Date" || callee === "Function") throw new Error(`Workflow scripts cannot construct ${callee}.`);
}

function assertCallExpressionPolicy(node: Node & { callee?: unknown }): void {
  const callee = identifierName(node.callee);
  if (callee && FORBIDDEN_IDENTIFIERS.has(callee)) throw new Error(`Workflow scripts cannot call ${callee}().`);

  const member = memberPath(node.callee);
  if (member && FORBIDDEN_MEMBER_PATTERNS.has(member)) {
    throw new Error(`Workflow scripts cannot call ${member}().`);
  }
}

function assertIdentifierPolicy(node: Node & { name?: string }, parent: Node | undefined): void {
  const name = node.name;
  if (!name || !FORBIDDEN_IDENTIFIERS.has(name)) return;
  if (isSafePropertyKey(node, parent)) return;
  throw new Error(`Workflow scripts cannot access ${name}.`);
}

function assertMemberExpressionPolicy(node: Node & { object?: unknown; property?: unknown; computed?: boolean }): void {
  const member = memberPath(node);
  if (member && FORBIDDEN_MEMBER_PATTERNS.has(member)) {
    throw new Error(`Workflow scripts cannot access ${member}.`);
  }

  const property = node.computed ? undefined : identifierName(node.property);
  if (property === "constructor" || property === "__proto__" || property === "prototype") {
    throw new Error(`Workflow scripts cannot access ${property}.`);
  }
}

function isSafePropertyKey(node: Node & { name?: string }, parent: Node | undefined): boolean {
  if (!parent) return false;
  const value = parent as Node & { key?: unknown; property?: unknown; computed?: boolean; shorthand?: boolean };
  if (parent.type === "Property" && value.key === node && value.computed !== true && value.shorthand !== true)
    return true;
  if (parent.type === "MemberExpression" && value.property === node && value.computed !== true) return true;
  return false;
}

function memberPath(value: unknown): string | undefined {
  if (!isNode(value) || value.type !== "MemberExpression") return undefined;
  const node = value as Node & { object?: unknown; property?: unknown; computed?: boolean };
  if (node.computed) return undefined;
  const object = identifierName(node.object) ?? memberPath(node.object);
  const property = identifierName(node.property);
  if (!object || !property) return undefined;
  return `${object}.${property}`;
}

function identifierName(value: unknown): string | undefined {
  if (!isNode(value) || value.type !== "Identifier") return undefined;
  return (value as Node & { name?: string }).name;
}

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && typeof (value as Node).type === "string";
}
