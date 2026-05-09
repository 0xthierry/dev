import type { RuleActivationMode, RuleFrontmatter } from "./types";

export type ParsedRuleFile = {
  frontmatter: RuleFrontmatter;
  body: string;
};

export function parseRuleFile(content: string): ParsedRuleFile {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      frontmatter: emptyFrontmatter(false),
      body: content.trim(),
    };
  }

  const raw = parseFrontmatterBlock(match[1] ?? "");
  const frontmatter = normalizeFrontmatter(raw, true);
  return {
    frontmatter,
    body: content.slice(match[0].length).trim(),
  };
}

export function classifyRule(frontmatter: RuleFrontmatter): RuleActivationMode {
  if (frontmatter.alwaysApply === true) return "always";
  if (frontmatter.paths.length > 0 || frontmatter.globs.length > 0) return "path";
  if (frontmatter.description) return "agent";
  if (frontmatter.hasFrontmatter && frontmatter.alwaysApply === false) return "manual";
  return "always";
}

function emptyFrontmatter(hasFrontmatter: boolean): RuleFrontmatter {
  return {
    paths: [],
    globs: [],
    raw: {},
    hasFrontmatter,
  };
}

function normalizeFrontmatter(
  raw: Record<string, string | boolean | string[]>,
  hasFrontmatter: boolean,
): RuleFrontmatter {
  const alwaysApply = raw.alwaysApply ?? raw["always-apply"];
  const description = toOptionalString(raw.description);
  return {
    alwaysApply: typeof alwaysApply === "boolean" ? alwaysApply : toOptionalBoolean(alwaysApply),
    description,
    paths: normalizePatternList(raw.paths),
    globs: normalizePatternList(raw.globs),
    raw,
    hasFrontmatter,
  };
}

function parseFrontmatterBlock(block: string): Record<string, string | boolean | string[]> {
  const result: Record<string, string | boolean | string[]> = {};
  let listKey: string | undefined;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listMatch = trimmed.match(/^-\s*(.*)$/);
    if (listMatch && listKey) {
      const existing = result[listKey];
      const next = parseScalar(listMatch[1] ?? "");
      const nextValue = typeof next === "string" ? next : String(next);
      result[listKey] = Array.isArray(existing) ? [...existing, nextValue] : [nextValue];
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      listKey = undefined;
      continue;
    }

    const key = keyMatch[1] ?? "";
    const value = keyMatch[2] ?? "";
    if (value.trim() === "") {
      result[key] = [];
      listKey = key;
      continue;
    }

    result[key] = parseScalar(value);
    listKey = undefined;
  }

  return result;
}

function parseScalar(value: string): string | boolean | string[] {
  const trimmed = stripInlineComment(value.trim());
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((part) => stripQuotes(part.trim()))
      .filter(Boolean);
  }
  return stripQuotes(trimmed);
}

function stripInlineComment(value: string): string {
  let quoted: string | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== "\\") {
      quoted = quoted === char ? undefined : (quoted ?? char);
      continue;
    }
    if (char === "#" && !quoted && /\s/.test(value[index - 1] ?? " ")) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizePatternList(value: string | boolean | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values
    .flatMap(splitPatternValue)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
}

function splitPatternValue(value: string): string[] {
  return value.split(",").map((part) => stripQuotes(part.trim()));
}

function toOptionalString(value: string | boolean | string[] | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toOptionalBoolean(value: string | boolean | string[] | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
