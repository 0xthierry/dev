export type BlueprintCommandArgs =
  | { mode: "list" }
  | { mode: "run"; selection: string; task: string }
  | { mode: "error"; message: string };

export function parseBlueprintCommandArgs(args: string): BlueprintCommandArgs {
  const tokens = splitCommandArgs(args);
  if (tokens.length === 0 || tokens[0] === "--list" || tokens[0] === "list") return { mode: "list" };

  const [selection, ...taskTokens] = tokens;
  const task = taskTokens.join(" ").trim();
  if (!task) return { mode: "error", message: "Usage: /blueprint <name|scope/name> <task>" };

  return { mode: "run", selection, task };
}

export function splitCommandArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}
