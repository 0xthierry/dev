import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { memoryResponse } from "./mcp-response";

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
      if (new Headers(init?.headers).get("Authorization") !== "Bearer fixture-rpc-local-token")
        return new Response("Unauthorized", { status: 401 });
      const body = JSON.parse(String(init?.body ?? "{}"));
      appendFileSync(
        log,
        `${JSON.stringify({ url: url.toString(), body, headers: Object.fromEntries(new Headers(init?.headers)), authorization: new Headers(init?.headers).get("Authorization") })}\n`,
      );
      if (url.pathname === "/mcp") return memoryResponse(body);
      return new Response(url.pathname === "/handoff" ? "Isolated prior-session handoff" : "ok");
    },
    { preconnect: originalFetch.preconnect },
  );
  register(pi);
}
