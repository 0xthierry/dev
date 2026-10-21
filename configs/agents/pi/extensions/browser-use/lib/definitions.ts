import { Type } from "typebox";

export const BROWSER_USE_TOOL_NAME = "browser_use";
export const BROWSER_USE_STATUS_COMMAND = "browser-use-status";

export const BROWSER_USE_PARAMETERS = Type.Object(
  {
    code: Type.String({
      description:
        "JavaScript to run in the trusted browser kernel with top-level await. Use nodeRepl.write(value) for output.",
    }),
  },
  { additionalProperties: false },
);

export const BROWSER_USE_PROMPT_SNIPPET =
  "Use browser_use JavaScript only when the user explicitly requests browser_use or control-browser; otherwise use Playwriter MCP, with Chrome DevTools MCP for diagnostics or capability fallback";

export const BROWSER_USE_PROMPT_GUIDELINES = [
  "Default to Playwriter MCP for browser automation in the user's existing browser/profile. Use Chrome DevTools MCP for diagnostics or an authorized capability fallback through CDP, preserving browser and page identity. Use browser_use only when the user explicitly requests browser_use, control-browser, or the ChatGPT browser extension for the task. Naming a browser, an existing login, or a URL does not select browser_use.",
  "When browser_use is explicitly requested, follow the control-browser skill. Import setupBrowserRuntime from the absolute browser-client path in the tool description.",
  "browser_use starts off. If it errors as disabled, ask once for /browser-use on, then continue. /browser-use on --accept-permissions auto-accepts every browser permission prompt for the session. Do not ask permission for each click or navigation after it is on.",
  "Tool availability or /browser-use on alone does not select browser_use. Do not ask to enable it during a Playwriter or Chrome DevTools MCP task. Preserve the user's chosen browser and tool; report failures instead of silently switching tools. Never switch tools to bypass an explicit permission denial.",
];
