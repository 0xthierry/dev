export type GlobMatch = {
  pattern: string;
  path: string;
};

export function matchFirstGlob(path: string, patterns: string[]): GlobMatch | undefined {
  const normalizedPath = normalizeRulePath(path);
  for (const pattern of expandPatternList(patterns)) {
    if (globToRegExp(normalizeRulePattern(pattern)).test(normalizedPath)) {
      return { pattern, path: normalizedPath };
    }
  }
  return undefined;
}

export function normalizeRulePath(path: string): string {
  return stripPathDecorations(path).replace(/^@+/, "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

export function expandPatternList(patterns: string[]): string[] {
  return patterns.flatMap((pattern) => expandBraces(pattern.trim())).filter(Boolean);
}

function normalizeRulePattern(pattern: string): string {
  return pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function stripPathDecorations(path: string): string {
  return path
    .trim()
    .replace(/[),.;:!?]+$/g, "")
    .replace(/:(\d+)(:\d+)?$/g, "");
}

function expandBraces(pattern: string): string[] {
  const match = pattern.match(/^(.*)\{([^{}]+)\}(.*)$/);
  if (!match) return [pattern];

  const prefix = match[1] ?? "";
  const options = (match[2] ?? "").split(",").map((part) => part.trim());
  const suffix = match[3] ?? "";
  return options.flatMap((option) => expandBraces(`${prefix}${option}${suffix}`));
}

function globToRegExp(pattern: string): RegExp {
  let output = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      const afterGlobstar = pattern[index + 2];
      if (afterGlobstar === "/") {
        output += "(?:.*/)?";
        index += 2;
      } else {
        output += ".*";
        index += 1;
      }
      continue;
    }

    if (char === "*") {
      output += "[^/]*";
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    output += escapeRegExp(char ?? "");
  }
  output += "$";
  return new RegExp(output);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
