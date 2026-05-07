# Pi Extension Code Taste

Use this guide when creating or refactoring extensions under `configs/agents/pi/extensions/`.

## Definition

Tasty code removes special cases by changing the shape of the code, not by hiding branches in different files.

Good taste is not “write fewer lines.” The lesson is: when code has an edge-case branch, ask whether a better representation would make the edge case disappear. A linked-list removal is better when removing the first node and removing a middle node become the same operation after changing what the code points at. A grid-edge initializer is better when it loops over the edges directly instead of scanning every cell and asking “is this an edge?” four times.

Good taste here means:

- normalize inputs once;
- model outcomes with precise TypeScript types;
- pass typed values through one common path;
- keep Pi-specific code at the Pi boundary;
- keep provider-specific code behind provider modules;
- make module names expose the boundary they own.

Bad taste here usually looks like:

- a giant `register.ts` that validates, fetches, formats, stores, and talks to providers;
- wrappers/barrels like `export * from "./providers/foo"`;
- `resolveDependencies(overrides: Partial<...>)` created only for tests;
- string matching errors in a tool handler;
- test-only production commands, flags, shortcuts, or hidden branches;
- repeated `if this special URL / if this provider / if this error text` logic at many layers;
- “refactors” that only move conditionals to new modules without removing the underlying edge cases.

## The taste test

Before writing or after reading a function, ask:

1. What are the real cases in the domain?
2. Can those cases be represented as data or types once?
3. Can the rest of the code operate on that representation uniformly?
4. Are conditionals checking policy, or are they compensating for a bad shape?
5. Did the refactor make execution flow simpler, or did it only rearrange files?

A conditional is not automatically bad. Boundary validation, discriminated-union switches, and explicit provider capability checks are fine. The smell is repeated edge-case detection after the code already had a chance to normalize the input.

## Tasty is not just module structure

Moving code into folders is not enough. A refactor has better taste only when it removes special-case knowledge from callers.

Bad refactor:

```ts
// The caller still knows every special case; the branches just moved.
if (isPdf(url)) return pdfUnsupported(url);
if (hasTimestamp(options) && !isYouTube(url)) return timestampUnsupported(url);
if (isGitHub(url)) return fetchGitHub(url);
if (isYouTube(url)) return fetchYouTube(url);
return fetchPage(url);
```

Better refactor:

```ts
const target = classifyFetchTarget(url, options);
if (!target.ok) return target.error;

return runContentPipeline(target.value, extractors);
```

Best refactors often make the call site boring. The interesting rules move to one classifier, one planner, one pipeline, or one typed result shape.

## Extension shape

Start with this shape and grow only when the boundary is real:

```text
my-extension/
  index.ts                 # Pi entrypoint only
  index.test.ts            # Optional no-cost entrypoint registration test
  index.spec.ts            # Optional Pi RPC / E2E spec
  lib/
    register.ts            # Pi lifecycle and registration wiring only
    register.test.ts
    tools/                 # tool schemas, handlers, renderers, runtime wiring
    content/               # domain classification/orchestration, if needed
    providers/             # external systems/provider adapters
    storage/               # state/session persistence, if needed
    shared/                # small pure helpers used inside this extension
```

Use folders by boundary, not by aesthetic preference. Add a folder when it creates a meaningful separation: Pi tool handling, domain logic, storage, an external provider, or shared pure helpers.

## Entrypoint boundary

`index.ts` is the only Pi-discovered entrypoint. It must only register the extension:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerMyExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerMyExtension(pi);
}
```

`lib/register.ts` wires lifecycle handlers and registers commands/tools. It should not contain provider clients, parsing algorithms, formatting logic, storage validation, or large execute bodies.

Good:

```ts
export function registerMyExtension(pi: ExtensionAPI): void {
  registerMyTools(pi, createMyRuntime());
}

export function registerMyTools(pi: ExtensionAPI, runtime: MyRuntime): void {
  registerSearchTool(pi, runtime);
  registerFetchTool(pi, runtime);
}
```

Bad:

```ts
export function registerMyExtension(pi: ExtensionAPI, overrides: Partial<MyRuntime> = {}): void {
  const runtime = resolveDependencies(overrides);
  pi.registerTool({
    name: "search",
    async execute() {
      // validation, network calls, formatting, storage, fallback providers...
    },
  });
}
```

## No barrel exports

Do not add barrel files or compatibility wrappers:

```ts
// Bad
export * from "./providers/foo";
export { parseFooUrl } from "./url";
```

Import from the concrete module that owns the behavior:

```ts
// Good
import { parseFooUrl } from "./providers/foo/url";
import { fetchFoo } from "./providers/foo/client";
```

Why:

- dependencies stay visible;
- module ownership stays clear;
- tests can live beside the real behavior;
- accidental public APIs do not grow;
- Pi only needs the extension `index.ts`, not internal re-export surfaces.

## Normalize once

Parse and classify inputs once near the boundary, then pass a typed shape through the workflow.

Good:

```ts
type FetchTarget =
  | { kind: "page"; url: URL }
  | { kind: "videoFrames"; url: URL; videoId: string; timestamp: string };

type FetchTargetResult =
  | { ok: true; target: FetchTarget }
  | { ok: false; error: WebAccessError };

function classifyFetchTarget(input: unknown): FetchTargetResult {
  // URL validation, unsupported media, and timestamp rules live here.
}
```

Downstream modules now switch on `target.kind` instead of re-checking URL validity, video status, or timestamp rules.

Bad:

```ts
async function fetchContent(url: string, options: FetchOptions) {
  if (options.timestamp && !url.includes("youtube")) return error();
  if (url.endsWith(".pdf")) return error();
  // later...
  if (options.timestamp && !isYouTube(url)) return anotherError();
}
```

## Typed outcomes, not error-string protocols

Create structured errors at the source of failure. Do not ask tool handlers to infer meaning from strings.

Good:

```ts
type ExtractedContent =
  | { error: null; url: string; title: string; content: string }
  | { error: string; errorDetails: WebAccessError; url: string; title: string; content: string };
```

Bad:

```ts
if (result.error?.toLowerCase().includes("auth")) {
  return authRequired();
}
```

The provider or classifier that knows the failure should create `AUTH_REQUIRED`, `PDF_UNSUPPORTED`, or `FETCH_FAILED` directly.

## One common path beats repeated edge cases

Provider fallback chains should use one interface and one loop. This is the extension version of initializing grid edges directly instead of scanning the whole grid and asking four edge questions for every cell.

Good:

```ts
interface ContentExtractor {
  name: string;
  supports(target: FetchTarget): boolean;
  extract(target: FetchTarget, signal?: AbortSignal): Promise<ExtractionOutcome>;
}

for (const extractor of extractors) {
  if (!extractor.supports(target)) continue;
  const outcome = await extractor.extract(target, signal);
  if (outcome.status === "success" || outcome.status === "terminal") return outcome.result;
  if (outcome.status === "failure" && !firstFailure) firstFailure = outcome.result;
}
```

Bad:

```ts
try { /* provider A */ } catch {}
try { /* provider B with slightly different abort handling */ } catch {}
try { /* provider C with different fallback semantics */ } catch {}
```

The loop makes fallback semantics a property of the pipeline instead of every provider branch.

## Plan work directly instead of looping over the wrong space

If the task is “operate on the edges,” loop over the edges. If the task is “fetch providers in priority order,” loop over providers. If the task is “extract frames,” build a frame plan and execute it. Do not loop over a broad space and test your way into the small subset you really wanted.

Bad:

```ts
for (const second of everySecondInVideo) {
  if (requestedTimestamps.includes(second)) {
    frames.push(await extractFrame(second));
  }
}
```

Good:

```ts
const plan = planFrameRequest(options, duration);
for (const timestamp of plan.timestamps) {
  frames.push(await extractFrame(timestamp));
}
```

The second version names the real work. It is simpler, usually faster, and gives tests a pure planning function to verify.

## Test seams should be real seams

When tests need fakes, accept a complete fake runtime or fake implementation at a real boundary.

Good:

```ts
export interface MyRuntime {
  search: typeof search;
  fetchContent: typeof fetchContent;
  now: () => number;
}

export function createMyRuntime(): MyRuntime {
  return { search, fetchContent, now: Date.now };
}
```

In tests, pass a complete fake:

```ts
const runtime: MyRuntime = {
  search: mock(async () => ({ answer: "ok", results: [] })),
  fetchContent: mock(async () => []),
  now: mock(() => 123),
};
```

Bad:

```ts
function resolveDependencies(overrides: Partial<MyRuntime> = {}): MyRuntime {
  return { search, fetchContent, now: Date.now, ...overrides };
}
```

A partial override bag usually means the production abstraction exists only for tests. Prefer an explicit runtime or a pure function that accepts the implementation it needs.

## Naming

Use boring, exact names that reveal ownership:

- `classifyFetchTarget()` parses and validates a target.
- `planYouTubeFrameRequest()` computes a frame plan but does not run `ffmpeg`.
- `fetchYouTubeThumbnail()` performs the thumbnail fetch.
- `buildGitHubContent()` renders cloned repository content.
- `restoreFromEntries()` restores state from session entries.

Avoid generic names like `utils`, `helpers`, `manager`, `process`, or `handle` unless the module is truly tiny and generic.

## Refactor checklist

Before handing off an extension refactor:

- [ ] `index.ts` only registers the extension.
- [ ] `register.ts` only wires Pi lifecycle and registration boundaries.
- [ ] No `export *` or barrel re-export modules were added.
- [ ] Inputs are normalized/classified once before the main workflow.
- [ ] The main workflow operates on typed domain shapes instead of raw user input.
- [ ] Repeated edge-case checks were eliminated, not merely moved into helper files.
- [ ] Loops iterate over the real work set, not a broad space filtered by conditionals.
- [ ] Failures are typed at their source and not string-classified in tool handlers.
- [ ] Test seams are explicit complete runtimes/fakes, not partial dependency bags.
- [ ] Module names describe the behavior they own.
- [ ] Important behavior has direct tests; see `testing.md`.
