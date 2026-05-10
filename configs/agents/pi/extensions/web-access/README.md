# Web Access

Pi extension that gives the agent web research and content-reading tools.

## What it registers

This extension registers three LLM-callable tools:

| Tool | Purpose |
| --- | --- |
| `web_search` | Search the web for current or specialized information and return citation-friendly source URLs. |
| `fetch_content` | Fetch pages, GitHub repositories/files, and YouTube content into readable markdown or image frames. |
| `get_search_content` | Retrieve stored results from an earlier `web_search` or `fetch_content` call. |

It does not register slash commands, keyboard shortcuts, flags, or custom UI.

## Installation and loading

This repository's agent installer symlinks `configs/agents/pi/extensions` to `~/.pi/agent/extensions`, and Pi auto-discovers directory extensions with an `index.ts` file.

For an ad-hoc run from the repository root:

```bash
pi -e configs/agents/pi/extensions/web-access
```

To install this extension as a Pi package from a local checkout:

```bash
pi install ./configs/agents/pi/extensions/web-access
```

To install the GitHub package that contains this extension:

```bash
pi install git:github.com/0xthierry/dev
# or
pi install https://github.com/0xthierry/dev
```

The GitHub package installs all extensions declared by the repository root. To install only `web-access`, clone the repo and use the local per-extension command above, or install the GitHub package and use `pi config` to disable resources you do not want.

After changing the extension in an interactive Pi session, use `/reload` to reload auto-discovered extensions.

## Quick usage examples

```ts
web_search({ query: "Pi coding agent extension API", numResults: 5 })

web_search({
  queries: ["current Node.js LTS", "Node.js release schedule"],
  recencyFilter: "month",
  domainFilter: ["nodejs.org", "-medium.com"],
})

fetch_content({ url: "https://example.com/article" })

fetch_content({
  url: "https://github.com/owner/repo/tree/main/docs",
  forceClone: true,
})

fetch_content({
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  timestamp: "0:30-1:00",
  frames: 6,
})

get_search_content({ responseId: "<responseId>", urlIndex: 0 })

get_search_content({
  responseId: "<responseId>",
  urlIndex: 0,
  offset: 30000,
  limit: 30000,
})
```

The model normally calls these tools itself. The examples above show the parameter shapes.

## Configuration file

Configuration is optional and lives at:

```text
~/.pi/web-search.json
```

A missing file is treated as an empty config.

Example:

```json
{
  "$schema": "./agent/extensions/web-access/web-search.schema.json",
  "exaApiKeyEnv": "EXA_API_KEY",
  "braveApiKeyEnv": "BRAVE_API_KEY",
  "tavilyApiKeyEnv": "TAVILY_API_KEY",
  "braveProfile": "Default",
  "medium": {
    "enabled": true,
    "profile": "Default"
  },
  "youtube": {
    "enabled": true,
    "preferredModel": "gemini-3-flash-preview"
  },
  "githubClone": {
    "enabled": true,
    "cloneTimeoutSeconds": 30,
    "clonePath": "/tmp/pi-github-repos"
  }
}
```

### Config fields

| Field | Default | Used for |
| --- | --- | --- |
| `exaApiKeyEnv` | `EXA_API_KEY` | Name of the environment variable that contains the Exa API key. |
| `exaApiKey` | unset | Literal Exa API key. Prefer `exaApiKeyEnv` so secrets stay out of files. |
| `braveApiKeyEnv` | `BRAVE_API_KEY` | Name of the environment variable that contains the Brave Search API key. |
| `braveApiKey` | unset | Literal Brave Search API key. Prefer `braveApiKeyEnv` so secrets stay out of files. |
| `tavilyApiKeyEnv` | `TAVILY_API_KEY` | Name of the environment variable that contains the Tavily API key. |
| `tavilyApiKey` | unset | Literal Tavily API key. Prefer `tavilyApiKeyEnv` so secrets stay out of files. |
| `$schema` | unset | Optional editor schema reference. From `~/.pi/web-search.json`, use `./agent/extensions/web-access/web-search.schema.json`. |
| `braveProfile` | `Default` | Browser profile name used when reading browser cookies. Takes precedence over `chromeProfile` when a feature-specific profile is not set. |
| `chromeProfile` | `Default` | Browser profile name used when `braveProfile` and feature-specific profiles are not set. |
| `medium.enabled` | `false` | Enables local browser-cookie backed HTTP fetches for `medium.com` and `*.medium.com` URLs. |
| `medium.profile` | unset | Browser profile to read Medium cookies from. Falls back to `braveProfile`, then `chromeProfile`, then the browser default profile. |
| `youtube.enabled` | `true` | Enables Gemini-backed YouTube transcript/content extraction. Frame extraction still depends on the request and local tools. |
| `youtube.preferredModel` | `gemini-3-flash-preview` | Gemini Web model for YouTube content extraction. Supported values are `gemini-3-flash-preview`, `gemini-3-pro`, `gemini-2.5-flash`, and `gemini-2.5-pro`. |
| `githubClone.enabled` | `true` | Enables GitHub repository cloning for GitHub URLs. |
| `githubClone.cloneTimeoutSeconds` | `30` | Clone timeout. |
| `githubClone.clonePath` | `/tmp/pi-github-repos` | Parent directory for temporary GitHub clones. |
| `githubClone.maxRepoSizeMB` | `350` | Accepted by the config normalizer, but the current clone implementation does not enforce a size limit. |

`provider` and `searchModel` may appear in older config shapes, but the current implementation does not read them.

## External requirements

Different features need different external services or local tools:

| Feature | Requirement |
| --- | --- |
| Primary web search and Exa content fetch | `EXA_API_KEY` or `exaApiKeyEnv`/`exaApiKey` in `~/.pi/web-search.json`. |
| Brave web search fallback | `BRAVE_API_KEY` or `braveApiKeyEnv`/`braveApiKey` in `~/.pi/web-search.json`. Uses Brave LLM Context because it returned much more LLM-ready grounding content than the normal Web Search snippet endpoint in live validation. |
| Tavily search and extract fallback | `TAVILY_API_KEY` or `tavilyApiKeyEnv`/`tavilyApiKey` in `~/.pi/web-search.json`. |
| Search/fetch fallback | `codex` CLI installed and authenticated/configured. The extension runs `codex exec --sandbox read-only --ephemeral`. |
| Direct page fetch | Network access plus repository npm dependencies (`@mozilla/readability`, `linkedom`, `turndown`). |
| Medium authenticated fetch | `medium.enabled: true` and a Brave/Chromium/Chrome profile signed into Medium. Cookies are only sent to `medium.com` or `*.medium.com`. |
| Jina fallback | Network access to `https://r.jina.ai/`. |
| Gemini Web fallback and YouTube transcript extraction | A Brave, Chromium, or Chrome profile signed into `https://gemini.google.com`, with readable Google cookies. |
| Browser cookie decryption on macOS | The `security` command and the browser's Keychain entry. |
| Browser cookie decryption on Linux | Browser cookie DB access; `secret-tool` is used when available, otherwise Chromium's default local password fallback is tried. |
| GitHub URLs | `gh` CLI is preferred; `git` is used as fallback. Authenticate `gh` if private repositories are needed. |
| YouTube frame extraction | `yt-dlp` and `ffmpeg` installed and on `PATH`. |
| YouTube thumbnails | Network access to YouTube thumbnail URLs. |

Do not commit API keys or browser-cookie material. Prefer environment variables for secrets.

## Medium authenticated fetches

When `medium.enabled` is `true`, `fetch_content` tries a local authenticated HTTP request before public/external content providers for Medium URLs. The extension reads cookies from the configured local browser profile and attaches them only to `medium.com` or `*.medium.com` requests. Cookie values are not logged, stored in tool details, appended to Pi session entries, or sent to Exa, Brave, Tavily, Jina, Gemini, or Codex.

If no Medium cookies are found, or the authenticated response is still incomplete, normal fallback providers continue to run.

## How search works

`web_search` normalizes `query` or `queries` into a list and searches queries with a shared concurrency limit of 10.

Provider order:

1. Exa, when an API key is configured. Rate-limit responses are retried once when Exa provides a short retry delay.
2. Brave LLM Context, when a Brave Search API key is configured.
3. Tavily Search, when a Tavily API key is configured.
4. Codex CLI fallback.

The provider chain falls through when a provider is unavailable, fails after retryable rate-limit handling, or returns no source URLs. Exa, Brave, Tavily, and Codex all retry short rate-limit delays before falling through; long delays are reported with retry guidance instead of blocking for an unsafe amount of time.

Supported parameters:

- `query`: one focused query.
- `queries`: multiple query strings for broader research.
- `numResults`: clamped by providers to 1-20 where applicable.
- `includeContent`: asks capable search providers to store available page text with search results for later retrieval.
- `recencyFilter`: `day`, `week`, `month`, or `year`.
- `domainFilter`: include domains like `example.com`; exclude domains with a leading `-`, like `-spam.example`.

Search output is formatted as a concise answer plus a `Sources` list. Provider responses with no source URLs are treated as failures so the tool does not return an empty `Sources` section. Each successful call stores a search result under a generated `searchId`. If `includeContent` returns inline page content, that content is stored as a separate fetch result under a generated `fetchId`.

## How fetching works

`fetch_content` accepts either `url` or `urls`. Batch fetches run with a concurrency limit of 10.

Before fetching, the extension validates the target:

- invalid URLs are rejected;
- PDFs are unsupported;
- local video files are unsupported;
- `timestamp`/`frames` are only valid for YouTube URLs.

For normal content requests, extractors run in this order:

1. GitHub repository/file/tree extraction.
2. YouTube transcript/content extraction through Gemini Web.
3. Authenticated HTTP for configured site-specific browser-cookie providers such as Medium.
4. Exa Contents API.
5. Tavily Extract API.
6. Direct HTTP fetch with Readability and markdown conversion.
7. Jina Reader fallback.
8. Gemini Web page extraction.
9. Codex CLI fallback.

For YouTube frame requests, the extension uses `yt-dlp` to get a stream URL and `ffmpeg` to extract JPEG frames.

## GitHub behavior

GitHub URLs are cloned into `githubClone.clonePath` and rendered as markdown guidance:

- repository root: tree summary, README excerpt when present, and the local clone path;
- `blob` URL: file content when the file is text-like;
- `tree` URL: directory listing for that path.

Large/noisy output is limited:

- tree listings stop at 200 entries;
- common generated/vendor directories are skipped in recursive root trees;
- inline file content is capped at 100,000 characters;
- README excerpts are capped at 8 KiB.

The result tells the model to use Pi's `read` and `bash` tools at the cloned path for deeper inspection. Clone cache entries are cleared on Pi session shutdown.

## YouTube behavior

For a plain YouTube URL, `fetch_content` asks Gemini Web to extract video title, channel, duration, summary, transcript with timestamps, and visual descriptions. A thumbnail is included when available.

When the user wants a general YouTube summary, description, or transcript, omit `prompt` so the default video extraction prompt is used. Passing `prompt` replaces that default request, so use it only for narrow video questions or explicitly include "transcript with timestamps" when the answer needs the transcript.

For a timestamp or frame request:

- `timestamp` supports `SS`, `MM:SS`, `H:MM:SS`, or `start-end` ranges.
- `frames` must be between 1 and 12.
- Range requests default to 6 frames when `frames` is omitted.
- Frame intervals are at least 5 seconds apart.

Examples:

```ts
fetch_content({ url: "https://youtu.be/dQw4w9WgXcQ", timestamp: "1:23" })
fetch_content({ url: "https://youtu.be/dQw4w9WgXcQ", timestamp: "1:00-2:00", frames: 8 })
fetch_content({ url: "https://youtu.be/dQw4w9WgXcQ", frames: 4 })
```

## Stored results and retrieval

`web_search` and `fetch_content` store full structured results in memory and append a custom Pi session entry with custom type `web-access-results`.

`get_search_content` accepts a stored result ID as `responseId`. That ID may be labeled `responseId`, `searchId`, or `fetchId` in the earlier tool result details.

It can retrieve:

- a stored search query by `responseId` and optional `queryIndex`;
- fetched content by `responseId` and optional `urlIndex`;
- fetched content by exact `url`;
- long fetched content chunks with optional `offset` and `limit` character parameters.

For fetched content, `offset` defaults to `0`, and `limit` defaults to the inline safety limit of 30,000 characters. `limit` is capped at 30,000 characters. When more content remains, the tool returns `nextOffset` in details and includes a ready-to-call `get_search_content` hint for the next chunk.

Storage behavior:

- Stored result IDs are generated per tool call and recorded in tool result details. Batch fetches and truncated inline responses also include retrieval hints in the returned text.
- Results are restored from the current session branch on `session_start` and `session_tree`.
- Restored results expire after 1 hour.
- In-memory stored results are cleared on `session_shutdown`.
- Images from thumbnails/frames are stripped before session persistence; they are returned only in the immediate `fetch_content` response.

Inline text returned to the model is capped at 30,000 characters. When output is truncated, the tool response includes a hint to call `get_search_content` with the generated ID and next `offset`.

## Error behavior

Errors are returned as structured text with:

- what happened;
- what to do next;
- a machine-readable error object in tool details.

Common non-retriable errors include missing query/URL, invalid URL, unsupported PDF, unsupported local video, and timestamp requests for non-YouTube URLs. Network, provider, authentication, clone, and extraction failures are generally marked retriable.

## Development and validation

Default no-cost tests:

```bash
bun run test:pi-extensions web-access
bun run typecheck:pi-extensions
bun run lint:pi-extensions
```

E2E/live specs:

```bash
bun run test:pi-extensions:e2e web-access
```

The E2E command includes live contract specs for provider boundaries. The current specs may require network access, `EXA_API_KEY`, Codex CLI auth, Gemini browser cookies, and `gh`/`git`. Manual frame-extraction validation also requires `yt-dlp` and `ffmpeg`.

Medium cookie validation is gated so it does not read browser cookies unless explicitly enabled:

```bash
PI_WEB_ACCESS_MEDIUM_COOKIE_SPEC=1 bun test configs/agents/pi/extensions/web-access/lib/providers/medium-cookies.spec.ts
PI_WEB_ACCESS_MEDIUM_COOKIE_SPEC=1 PI_WEB_ACCESS_MEDIUM_TEST_URL="https://medium.com/..." bun test configs/agents/pi/extensions/web-access/lib/providers/medium-cookies.spec.ts
```
