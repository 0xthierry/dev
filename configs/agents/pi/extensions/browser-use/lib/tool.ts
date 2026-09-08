import { z } from "zod";

const codeInputSchema = z.object({ code: z.string() });

export function browserUseToolDescription(browserClientPath: string): string {
  return `Run JavaScript against the user's connected Chromium browser (Chrome, Brave, or Edge) through the ChatGPT browser extension.

Follow the control-browser skill before browser work. First call in a session:

const { setupBrowserRuntime } = await import(${JSON.stringify(browserClientPath)});
const agent = await setupBrowserRuntime();

Never use globalThis or client.setupBrowserRuntime. Prefer agent.browsers.get("extension") or get("brave") when get("chrome") fails. Write results with nodeRepl.write(value). Do not use agent-browser or Playwright MCP for this surface.`;
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
