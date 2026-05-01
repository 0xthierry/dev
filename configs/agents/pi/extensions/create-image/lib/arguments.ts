import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ImageGenerationProvider } from "./providers/types";

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

const OPTION_COMPLETIONS: Array<{
  option: string;
  aliases: string[];
  value: string;
  label: string;
  description: string;
}> = [
  {
    option: "--provider",
    aliases: ["-p"],
    value: "--provider nano-banana ",
    label: "--provider",
    description: "Image provider to use.",
  },
  {
    option: "--out",
    aliases: ["-o"],
    value: "--out generated-images ",
    label: "--out",
    description: "Output directory relative to the current project.",
  },
  {
    option: "--name",
    aliases: [],
    value: "--name image ",
    label: "--name",
    description: "Base filename without an extension.",
  },
  {
    option: "--profile",
    aliases: [],
    value: "--profile Default ",
    label: "--profile",
    description: "Browser profile to read Gemini cookies from.",
  },
  {
    option: "--help",
    aliases: ["-h"],
    value: "--help",
    label: "--help",
    description: "Show /create-image usage.",
  },
];

const OPTION_VALUE_COMPLETIONS: Record<StringOptionKey, Array<{ value: string; description: string }>> = {
  provider: [],
  outputDir: [
    { value: "generated-images", description: "Default generated image output directory." },
    { value: "assets", description: "Common project assets directory." },
    { value: "public", description: "Common public/static asset directory." },
    { value: "static", description: "Common static asset directory." },
  ],
  fileName: [
    { value: "image", description: "Generic image filename." },
    { value: "icon", description: "Icon filename." },
    { value: "hero", description: "Hero image filename." },
    { value: "thumbnail", description: "Thumbnail filename." },
  ],
  profile: [
    { value: "Default", description: "Default Chromium/Brave/Chrome profile." },
    { value: "Profile 1", description: "Chromium-style secondary browser profile." },
    { value: "Profile 2", description: "Chromium-style secondary browser profile." },
  ],
};

const PROMPT_STARTERS: AutocompleteItem[] = [
  {
    value: "generate an image of ",
    label: "generate an image of",
    description: "Prompt starter that clearly requests image generation.",
  },
  {
    value: "create a square image of ",
    label: "create a square image of",
    description: "Prompt starter for square images or icons.",
  },
  {
    value: "use image generation to make ",
    label: "use image generation to make",
    description: "Prompt starter that avoids text-only Gemini responses.",
  },
];

export function getCreateImageArgumentCompletions(
  argumentText: string,
  providers: ImageGenerationProvider[] = [],
): AutocompleteItem[] | null {
  const tokenStart = findCurrentTokenStart(argumentText);
  const beforeCurrentToken = argumentText.slice(0, tokenStart);
  const currentToken = argumentText.slice(tokenStart);
  const previousToken = lastToken(beforeCurrentToken);
  const inlineOption = parseInlineOption(currentToken);
  const valueOption = inlineOption
    ? OPTION_ALIASES[inlineOption.optionName]
    : previousToken && OPTION_ALIASES[previousToken];

  if (valueOption) {
    const valuePrefix = inlineOption ? inlineOption.valuePrefix : currentToken;
    const completions = getOptionValueCompletions(valueOption, providers)
      .filter((completion) => completion.value.toLowerCase().startsWith(valuePrefix.toLowerCase()))
      .map((completion) => ({
        value: inlineOption
          ? `${beforeCurrentToken}${inlineOption.optionName}=${completion.value} `
          : `${beforeCurrentToken}${completion.value} `,
        label: completion.value,
        description: completion.description,
      }));
    return completions.length > 0 ? completions : null;
  }

  if (currentToken.startsWith("-")) {
    const usedOptions = collectUsedOptions(tokenizeArgs(beforeCurrentToken));
    const optionItems = OPTION_COMPLETIONS.filter((completion) => !usedOptions.has(completion.option))
      .filter(
        (completion) =>
          completion.option.startsWith(currentToken) ||
          completion.aliases.some((alias) => alias.startsWith(currentToken)),
      )
      .map((completion) => ({
        value: `${beforeCurrentToken}${completion.value}`,
        label: completion.label,
        description: completion.description,
      }));
    return optionItems.length > 0 ? optionItems : null;
  }

  const promptAlreadyStarted = hasPromptToken(tokenizeArgs(beforeCurrentToken));
  const canStartPrompt = !promptAlreadyStarted || currentToken.length > 0;
  const promptItems = canStartPrompt
    ? PROMPT_STARTERS.filter((starter) => starter.value.toLowerCase().startsWith(currentToken.toLowerCase())).map(
        (starter) => ({
          ...starter,
          value: `${beforeCurrentToken}${starter.value}`,
        }),
      )
    : [];

  const optionItems = !promptAlreadyStarted && currentToken.length === 0 ? rootOptionCompletions(argumentText) : [];
  const items = uniqueCompletionItems([...optionItems, ...promptItems]);
  return items.length > 0 ? items : null;
}

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

function getOptionValueCompletions(
  optionKey: StringOptionKey,
  providers: ImageGenerationProvider[],
): Array<{ value: string; description: string }> {
  if (optionKey !== "provider") return OPTION_VALUE_COMPLETIONS[optionKey];

  const providerCompletions = providers.flatMap((provider) => [
    { value: provider.id, description: provider.label },
    ...provider.aliases.map((alias) => ({ value: alias, description: `Alias for ${provider.label}.` })),
  ]);
  return providerCompletions.length > 0
    ? providerCompletions
    : [{ value: "nano-banana", description: "Nano Banana image generation." }];
}

function rootOptionCompletions(argumentText: string): AutocompleteItem[] {
  const usedOptions = collectUsedOptions(tokenizeArgs(argumentText));
  return OPTION_COMPLETIONS.filter((completion) => !usedOptions.has(completion.option)).map((completion) => ({
    value: `${argumentText}${completion.value}`,
    label: completion.label,
    description: completion.description,
  }));
}

function collectUsedOptions(tokens: string[]): Set<string> {
  const used = new Set<string>();
  for (const token of tokens) {
    const optionName = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    const canonical = OPTION_COMPLETIONS.find(
      (completion) => completion.option === optionName || completion.aliases.includes(optionName),
    )?.option;
    if (canonical) used.add(canonical);
  }
  return used;
}

function hasPromptToken(tokens: string[]): boolean {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "--") return index < tokens.length - 1;
    if (token === "--help" || token === "-h") continue;

    const equalsIndex = token.indexOf("=");
    const optionName = equalsIndex > 0 ? token.slice(0, equalsIndex) : token;
    if (OPTION_ALIASES[optionName]) {
      if (equalsIndex === -1) index++;
      continue;
    }

    if (!token.startsWith("-")) return true;
  }
  return false;
}

function parseInlineOption(token: string): { optionName: string; valuePrefix: string } | null {
  const equalsIndex = token.indexOf("=");
  if (equalsIndex <= 0) return null;
  const optionName = token.slice(0, equalsIndex);
  if (!OPTION_ALIASES[optionName]) return null;
  return { optionName, valuePrefix: token.slice(equalsIndex + 1) };
}

function lastToken(input: string): string | undefined {
  return tokenizeArgs(input.trimEnd()).at(-1);
}

function findCurrentTokenStart(input: string): number {
  let quote: '"' | "'" | null = null;
  let escaping = false;
  let tokenStart = 0;

  for (let index = 0; index < input.length; index++) {
    const character = input[index];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (character === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (character === quote) quote = null;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }

    if (/\s/.test(character)) tokenStart = index + 1;
  }

  return tokenStart;
}

function uniqueCompletionItems(items: AutocompleteItem[]): AutocompleteItem[] {
  const seen = new Set<string>();
  const unique: AutocompleteItem[] = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    unique.push(item);
  }
  return unique;
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
