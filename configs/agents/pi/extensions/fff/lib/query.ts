import path from "node:path";

export function normalizePathConstraint(pathConstraint: string, cwd = process.cwd()): string | null {
  let trimmed = stripMentionPrefix(pathConstraint.trim());
  if (!trimmed) return trimmed;

  if (path.isAbsolute(trimmed)) {
    const relative = path.relative(cwd, trimmed).replaceAll(path.sep, "/");
    if (relative === "") return null;
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative)) {
      throw new Error(`Path constraint must be relative to the workspace: ${pathConstraint}`);
    }
    trimmed = relative;
  }

  if (trimmed === "." || trimmed === "./") return null;
  if (trimmed.startsWith("./")) trimmed = trimmed.slice(2);

  const recursiveDir = trimmed.match(/^(.*)\/\*\*(?:\/\*)?$/);
  if (recursiveDir) {
    const dir = recursiveDir[1];
    if (dir && !/[*?[{]/.test(dir)) return `${dir}/`;
  }

  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return trimmed;
  if (/[*?[{]/.test(trimmed)) return trimmed;

  const lastSegment = trimmed.split("/").pop() ?? "";
  if (/\.[a-zA-Z][a-zA-Z0-9]{0,9}$/.test(lastSegment)) return trimmed;

  return `${trimmed}/`;
}

export function normalizeExcludes(exclude: string | string[] | undefined, cwd = process.cwd()): string[] {
  if (!exclude) return [];

  const list = Array.isArray(exclude) ? exclude : [exclude];
  const normalized: string[] = [];

  for (const raw of list) {
    const parts = raw
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      const stripped = part.startsWith("!") ? part.slice(1) : part;
      const constraint = normalizePathConstraint(stripped, cwd);
      if (constraint) normalized.push(`!${constraint}`);
    }
  }

  return normalized;
}

export function buildQuery(
  pathConstraint: string | undefined,
  pattern: string,
  exclude?: string | string[],
  cwd = process.cwd(),
): string {
  const parts: string[] = [];

  if (pathConstraint) {
    const normalized = normalizePathConstraint(pathConstraint, cwd);
    if (normalized) parts.push(normalized);
  }

  parts.push(...normalizeExcludes(exclude, cwd));
  parts.push(pattern);

  return parts.join(" ");
}

function stripMentionPrefix(value: string): string {
  if (!value.startsWith("@")) return value;
  const withoutAt = value.slice(1);
  if (withoutAt.startsWith('"') && withoutAt.endsWith('"')) return withoutAt.slice(1, -1);
  return withoutAt;
}
