import { isAbsolute, resolve } from "node:path";
import { matchFirstGlob, normalizeRulePath } from "./glob";
import type { ProjectRule, RuleActivation, RuleActivationReason } from "./types";

export type ActivationPlan = {
  active: RuleActivation[];
  newActivations: RuleActivation[];
};

export function planPromptActivations(
  rules: ProjectRule[],
  prompt: string,
  seenPaths: Iterable<string>,
  activeRuleKeys: Set<string>,
): ActivationPlan {
  const promptPaths = extractPromptPaths(prompt);
  const manualTokens = extractManualRuleTokens(prompt);
  const candidatePaths = [...promptPaths, ...seenPaths];
  const active = rules.flatMap((rule) => activationForRule(rule, candidatePaths, manualTokens));
  return splitNewActivations(active, activeRuleKeys);
}

export function planPathActivations(rules: ProjectRule[], path: string, activeRuleKeys: Set<string>): ActivationPlan {
  const active = rules.flatMap((rule) => activationForRule(rule, [path], new Set<string>()));
  return splitNewActivations(active, activeRuleKeys);
}

export function findRuleReadActivation(
  rules: ProjectRule[],
  cwd: string,
  readPath: string,
  activeRuleKeys: Set<string>,
): RuleActivation | undefined {
  const normalizedReadPath = normalizeAbsoluteishPath(cwd, readPath);
  const activation = rules.find((rule) => {
    const paths = [rule.path, ...rule.aliases.map((alias) => normalizeAbsoluteishPath(cwd, alias))];
    return paths.some((path) => normalizeRulePath(path) === normalizedReadPath);
  });
  if (!activation || activeRuleKeys.has(activation.key)) return undefined;
  return { rule: activation, reason: { kind: "read", path: readPath } };
}

export function extractPromptPaths(prompt: string): string[] {
  const paths = new Set<string>();
  for (const match of prompt.matchAll(/@([^\s`'"<>()[\]{}]+)/g)) {
    addPath(paths, match[1] ?? "");
  }
  for (const match of prompt.matchAll(
    /(?:^|[\s`'"(])((?:\.?\.?\/?[A-Za-z0-9_@.-]+\/)+[A-Za-z0-9_@.-]+(?:\.[A-Za-z0-9_@.-]+)?(?::\d+(?::\d+)?)?)/g,
  )) {
    addPath(paths, match[1] ?? "");
  }
  for (const match of prompt.matchAll(/(?:^|[\s`'"(])([A-Za-z0-9_@.-]+\.[A-Za-z0-9_@.-]+(?::\d+(?::\d+)?)?)/g)) {
    addPath(paths, match[1] ?? "");
  }
  return [...paths];
}

export function extractManualRuleTokens(prompt: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of prompt.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
    const token = normalizeRuleToken(match[1] ?? "");
    if (token) tokens.add(token);
  }
  return tokens;
}

export function markActivations(activeRuleKeys: Set<string>, activations: RuleActivation[]): void {
  for (const activation of activations) {
    activeRuleKeys.add(activation.rule.key);
  }
}

function activationForRule(rule: ProjectRule, paths: string[], manualTokens: Set<string>): RuleActivation[] {
  const manualToken = matchingManualToken(rule, manualTokens);
  if (manualToken) return [{ rule, reason: { kind: "manual", token: manualToken } }];

  if (rule.mode === "always") return [{ rule, reason: { kind: "always" } }];
  if (rule.mode !== "path") return [];

  for (const path of paths) {
    const match = matchFirstGlob(path, rule.patterns);
    if (match) return [{ rule, reason: { kind: "path", path: match.path, pattern: match.pattern } }];
  }
  return [];
}

function splitNewActivations(active: RuleActivation[], activeRuleKeys: Set<string>): ActivationPlan {
  const deduped = dedupeActivations(active);
  return {
    active: deduped,
    newActivations: deduped.filter((activation) => !activeRuleKeys.has(activation.rule.key)),
  };
}

function dedupeActivations(activations: RuleActivation[]): RuleActivation[] {
  const seen = new Set<string>();
  const result: RuleActivation[] = [];
  for (const activation of activations) {
    if (seen.has(activation.rule.key)) continue;
    seen.add(activation.rule.key);
    result.push(activation);
  }
  return result;
}

function matchingManualToken(rule: ProjectRule, manualTokens: Set<string>): string | undefined {
  const names = [rule.name, rule.relativePath, rule.relativePath.replace(/\.mdc?$/i, "")].map(normalizeRuleToken);
  for (const token of manualTokens) {
    if (names.includes(token)) return token;
  }
  return undefined;
}

function addPath(paths: Set<string>, value: string): void {
  const path = normalizeRulePath(value);
  if (path && !path.startsWith("http")) paths.add(path);
}

function normalizeRuleToken(value: string): string {
  return normalizeRulePath(value)
    .replace(/\.mdc?$/i, "")
    .toLowerCase();
}

function normalizeAbsoluteishPath(cwd: string, path: string): string {
  const normalized = normalizeRulePath(path);
  const absolute = isAbsolute(path) ? path : resolve(cwd, normalized);
  return normalizeRulePath(absolute);
}

export function describeActivationReason(reason: RuleActivationReason): string {
  switch (reason.kind) {
    case "always":
      return "always";
    case "manual":
      return `manual @${reason.token}`;
    case "path":
      return `matched ${reason.path} via ${reason.pattern}`;
    case "read":
      return `read ${reason.path}`;
  }
}
