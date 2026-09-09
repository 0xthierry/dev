import { z } from "zod";

const codeInputSchema = z.object({ code: z.string() });

export function browserUseToolDescription(browserClientPath: string): string {
  return `Run JavaScript against the user's connected Chromium browser (Chrome, Brave, or Edge) through the ChatGPT browser extension, only when the user explicitly requests browser_use, control-browser, or this extension for the task. Otherwise use agent-browser, including for existing browsers through CDP. Tool availability or /browser-use on alone is not a request to use this tool.

Follow the control-browser skill before using this tool. First call in a session:

const { setupBrowserRuntime } = await import(${JSON.stringify(browserClientPath)});
const agent = await setupBrowserRuntime();

Never use globalThis or client.setupBrowserRuntime. Follow the skill's browser selection rules; preserve an explicitly named browser. Write results with nodeRepl.write(value). These APIs belong to browser_use, not agent-browser or Playwright MCP. Never switch tools to bypass an explicit permission denial.`;
}

export function parseBrowserUseCode(value: unknown): string {
  return codeInputSchema.parse(value).code;
}

export function summarizeBrowserUseCode(value: unknown): string | undefined {
  const parsed = codeInputSchema.safeParse(value);
  if (!parsed.success) return undefined;
  return parsed.data.code
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 100);
}
