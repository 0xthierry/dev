export interface CreateImageCommandArgs {
  help: boolean;
  prompt: string;
  provider?: string;
  outputDir?: string;
  fileName?: string;
  profile?: string;
}

export type ParseCreateImageArgsResult =
  | { ok: true; args: CreateImageCommandArgs }
  | { ok: false; error: string; usage: string };

export const CREATE_IMAGE_USAGE = [
  "Usage: /create-image [options] <prompt>",
  "",
  "Options:",
  "  --provider, -p <id>   Image provider to use. Default: nano-banana.",
  "  --out, -o <dir>       Output directory relative to the current project. Default: generated-images.",
  "  --name <file>         Base filename. Extension is chosen from the generated image type.",
  "  --profile <name>      Browser profile to read Gemini cookies from.",
  "  --help, -h            Show this help.",
  "",
  "Example:",
  "  /create-image --out assets 'a minimal fox logo on a transparent background'",
].join("\n");

type StringOptionKey = "provider" | "outputDir" | "fileName" | "profile";

const OPTION_ALIASES: Record<string, StringOptionKey> = {
  "--provider": "provider",
  "-p": "provider",
  "--out": "outputDir",
  "-o": "outputDir",
  "--name": "fileName",
  "--profile": "profile",
};

export function parseCreateImageArgs(input: string): ParseCreateImageArgsResult {
  const tokens = tokenizeArgs(input);
  const args: CreateImageCommandArgs = { help: false, prompt: "" };
  const promptTokens: string[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token === "--") {
      promptTokens.push(...tokens.slice(index + 1));
      break;
    }

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    const equalsIndex = token.indexOf("=");
    const optionName = equalsIndex > 0 ? token.slice(0, equalsIndex) : token;
    const optionKey = OPTION_ALIASES[optionName];
    if (optionKey) {
      const inlineValue = equalsIndex > 0 ? token.slice(equalsIndex + 1) : undefined;
      const nextValue = inlineValue ?? tokens[++index];
      if (!nextValue) return { ok: false, error: `Missing value for ${optionName}.`, usage: CREATE_IMAGE_USAGE };
      args[optionKey] = nextValue;
      continue;
    }

    if (token.startsWith("-")) return { ok: false, error: `Unknown option: ${token}.`, usage: CREATE_IMAGE_USAGE };

    promptTokens.push(token);
  }

  args.prompt = promptTokens.join(" ").trim();
  return { ok: true, args };
}

export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaping = false;

  for (const character of input) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (escaping) current += "\\";
  if (current) tokens.push(current);
  return tokens;
}
