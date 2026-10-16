import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const vendorPath = "../../ai-memory-pi.ts";
const { default: register } = await import(vendorPath);

// Isolate only the external memory service. Pi loads and runs the actual vendor hooks.
export default function hookServer(pi: ExtensionAPI) {
  const log = process.env.AI_MEMORY_HOOK_SPEC_LOG;
  if (!log) throw new Error("AI_MEMORY_HOOK_SPEC_LOG is required");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      if (url.origin !== "http://127.0.0.1:49374") throw new Error(`Unexpected spec network request: ${url.origin}`);
      appendFileSync(log, `${JSON.stringify({ url: url.toString(), body: JSON.parse(String(init?.body ?? "{}")) })}\n`);
      return new Response(url.pathname === "/handoff" ? "Isolated prior-session handoff" : "ok");
    },
    { preconnect: originalFetch.preconnect },
  );
  register(pi);
}
