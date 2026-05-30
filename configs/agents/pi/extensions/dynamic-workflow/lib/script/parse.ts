import type { Node } from "acorn";
import { parse } from "acorn";
import { assertWorkflowAstPolicy, assertWorkflowSourcePolicy, type WorkflowPolicyOptions } from "./policy";

export interface WorkflowMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowMetaPhase[];
}

export interface ParsedWorkflowScript {
  meta: WorkflowMeta;
  body: string;
}

type AnyNode = Node & { [key: string]: unknown; start: number; end: number };

export function parseWorkflowScript(script: string, options: WorkflowPolicyOptions = {}): ParsedWorkflowScript {
  assertWorkflowSourcePolicy(script, options);
  const ast = parse(script, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
  }) as unknown as AnyNode & { body?: AnyNode[] };

  assertWorkflowAstPolicy(ast);

  const first = ast.body?.[0];
  if (first?.type !== "ExportNamedDeclaration") {
    throw new Error("`export const meta = { name, description, phases }` must be the first statement in the script");
  }

  const declaration = first.declaration as AnyNode | null | undefined;
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
    throw new Error("meta export must be `export const meta = ...`");
  }
  if (!Array.isArray(declaration.declarations) || declaration.declarations.length !== 1) {
    throw new Error("meta export must declare only `meta`");
  }

  const declarator = declaration.declarations[0] as AnyNode;
  if (!isIdentifierNamed(declarator.id, "meta")) throw new Error("meta export must declare `meta`");
  if (!declarator.init) throw new Error("meta must have a literal value");

  const meta = evaluateLiteral(declarator.init as AnyNode, "meta");
  validateMeta(meta);
  assertNoExportsAfterMeta(ast.body ?? []);

  return {
    meta,
    body: `${script.slice(0, first.start)}${script.slice(first.end)}`,
  };
}

function assertNoExportsAfterMeta(statements: AnyNode[]): void {
  for (const statement of statements.slice(1)) {
    if (statement.type.startsWith("Export"))
      throw new Error("Workflow scripts may only export the first meta constant");
  }
}

function evaluateLiteral(node: AnyNode, path: string): unknown {
  switch (node.type) {
    case "ObjectExpression": {
      const out: Record<string, unknown> = {};
      const properties = node.properties as AnyNode[];
      for (const prop of properties) {
        if (prop.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        if (prop.type !== "Property") throw new Error(`only plain properties allowed in ${path}`);
        if (prop.computed) throw new Error(`computed keys not allowed in ${path}`);
        if (prop.kind !== "init" || prop.method) throw new Error(`methods/accessors not allowed in ${path}`);
        const key = propertyKey(prop.key as AnyNode, path);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new Error(`reserved key name not allowed in ${path}: ${key}`);
        }
        out[key] = evaluateLiteral(prop.value as AnyNode, `${path}.${key}`);
      }
      return out;
    }
    case "ArrayExpression":
      return (node.elements as Array<AnyNode | null>).map((element, index) => {
        if (!element) throw new Error(`sparse arrays not allowed in ${path}`);
        if (element.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        return evaluateLiteral(element, `${path}[${index}]`);
      });
    case "Literal":
      return node.value;
    case "TemplateLiteral": {
      const expressions = node.expressions as AnyNode[];
      if (expressions.length > 0) throw new Error(`template interpolation not allowed in ${path}`);
      const quasis = node.quasis as Array<AnyNode & { value?: { cooked?: string; raw?: string } }>;
      return quasis.map((quasi) => quasi.value?.cooked ?? quasi.value?.raw ?? "").join("");
    }
    case "UnaryExpression":
      if (node.operator === "-" && isNumericLiteral(node.argument)) return -(node.argument.value as number);
      throw new Error(`only negative-number unary allowed in ${path}`);
    default:
      throw new Error(`non-literal node type in ${path}: ${node.type}`);
  }
}

function propertyKey(node: AnyNode, path: string): string {
  if (node.type === "Identifier") return String(node.name);
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")) {
    return String(node.value);
  }
  throw new Error(`unsupported key type in ${path}: ${node.type}`);
}

function validateMeta(meta: unknown): asserts meta is WorkflowMeta {
  if (!meta || typeof meta !== "object") throw new Error("meta must be an object");
  const value = meta as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("meta.name must be a non-empty string");
  if (typeof value.description !== "string" || !value.description.trim()) {
    throw new Error("meta.description must be a non-empty string");
  }
  if (value.whenToUse !== undefined && typeof value.whenToUse !== "string") {
    throw new Error("meta.whenToUse must be a string");
  }
  if (value.phases === undefined) return;
  if (!Array.isArray(value.phases)) throw new Error("meta.phases must be an array");
  for (const phase of value.phases) {
    if (!phase || typeof phase !== "object" || typeof (phase as Record<string, unknown>).title !== "string") {
      throw new Error("each meta phase must have a title string");
    }
  }
}

function isIdentifierNamed(value: unknown, name: string): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as AnyNode).type === "Identifier" &&
    (value as AnyNode).name === name
  );
}

function isNumericLiteral(value: unknown): value is AnyNode & { value: number } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as AnyNode).type === "Literal" &&
    typeof (value as AnyNode).value === "number"
  );
}
