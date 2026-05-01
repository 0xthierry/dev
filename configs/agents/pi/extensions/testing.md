# Pi Extension Testing Guide

Use this guide for tests under `configs/agents/pi/extensions/`.

## File naming

Tests are colocated with the code they verify.

Default no-cost tests use the same basename:

```text
lib/content/target.ts
lib/content/target.test.ts

lib/providers/github/render.ts
lib/providers/github/render.test.ts
```

Live/integration/E2E specs use `.spec.ts`:

```text
index.spec.ts
lib/providers/exa.spec.ts
lib/providers/github/extract.spec.ts
```

## Every behavior module needs a test

For every source file with behavior, add a same-basename `*.test.ts`.

Exceptions:

- type-only files, such as `types.ts`;
- static schema/constant-only files, such as pure `definitions.ts` files;
- files whose only meaningful proof is a live boundary, which may also have `*.spec.ts`.

If a file mixes pure behavior and live behavior, split out the pure behavior and test it with `*.test.ts`. Keep the real boundary in `*.spec.ts`.

## Arrange / Act / Assert is mandatory

Every test should use explicit Arrange / Act / Assert comments, matching the desktop notification extension style.

Good:

```ts
import { describe, expect, test } from "bun:test";
import { normalizeThing } from "./thing";

describe("normalizeThing", () => {
  test("trims names", () => {
    // Arrange
    const input = "  docs  ";

    // Act
    const result = normalizeThing(input);

    // Assert
    expect(result).toBe("docs");
  });
});
```

Acceptable for tiny table-like checks:

```ts
test("recognizes supported values", () => {
  // Arrange
  const values = ["day", "week", "invalid"];

  // Act
  const results = values.map((value) => isSupported(value));

  // Assert
  expect(results).toEqual([true, true, false]);
});
```

Avoid tests that jump straight to assertions with no clear setup or action.

## Use `bun:test` mocks

Use `mock()` from `bun:test` for spies, fake callbacks, fake providers, fake runtimes, and fetch replacements.

Good:

```ts
import { afterEach, describe, expect, mock, test } from "bun:test";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.clearAllMocks();
});

test("fetches content", async () => {
  // Arrange
  const fetchMock = mock(async () => new Response("ok"));
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  // Act
  const result = await fetchThing("https://example.com");

  // Assert
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(result).toBe("ok");
});
```

Bad:

```ts
let calls = 0;
const fakeFetch = async () => {
  calls += 1;
  return new Response("ok");
};
```

Do not handwrite counters, ad hoc spy objects, or custom workaround hooks when `mock()` expresses the behavior directly.

## Fake complete implementations

When testing registration or tool handlers, pass a complete fake runtime/implementation. Do not add partial dependency override helpers just for tests.

Good:

```ts
function fakeRuntime(): MyRuntime {
  return {
    search: mock(async () => ({ answer: "ok", results: [] })),
    fetchContent: mock(async () => []),
    now: mock(() => 123),
  };
}

test("registers the search tool", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = fakeRuntime();
  registerMyTools(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("search", { query: "docs" });

  // Assert
  expect(runtime.search).toHaveBeenCalledWith("docs", expect.any(Object));
  expect(result.details).toMatchObject({ successfulQueries: 1 });
});
```

Bad:

```ts
registerMyExtension(fakePi.pi, testDependencies({ search: fakeSearch }));
```

`testDependencies({ ... })` and `resolveDependencies(overrides)` hide the real required dependencies and often preserve bad production code only for test convenience.

## Testing Pi registration

Use the shared fake Pi harness for default tests:

```ts
import { createFakePi } from "../_shared/testing/fake-pi";

test("registers the command", () => {
  // Arrange
  const fakePi = createFakePi();

  // Act
  registerMyExtension(fakePi.pi);

  // Assert
  expect(fakePi.commands.has("my-command")).toBe(true);
});
```

Do not register user-facing commands, tools, shortcuts, flags, event messages, or UI solely for testing. Anything registered by an extension is available to the user after installation.

If testability needs a seam, prefer:

- a pure function;
- a typed runtime passed to a registration helper;
- a provider interface passed to an orchestrator;
- the shared fake Pi harness.

## What belongs in `.test.ts`

Use `*.test.ts` for default no-cost tests:

- parsers and classifiers;
- timestamp/frame planning;
- prompt and render formatting;
- storage validation;
- typed error construction;
- provider request payload building;
- fake Pi tool registration and execution;
- local HTTP servers or mocked fetch responses.

Default tests must not require:

- real network access;
- browser cookies;
- provider CLIs;
- credentials or secrets;
- real model calls;
- spawned Pi processes.

## What belongs in `.spec.ts`

Use `*.spec.ts` for live boundaries:

- Pi RPC E2E behavior;
- live provider contracts;
- browser cookie access;
- real subprocess/CLI behavior;
- real model/provider calls;
- real network contracts that can fail outside the code.

Specs run only through the E2E command and may require secrets or local environment setup.

## E2E pattern

Prefer Pi RPC mode for E2E tests because it is observable and scriptable:

```bash
pi --mode rpc --no-session -e configs/agents/pi/extensions/my-extension
```

Use `_shared/testing/pi-rpc-harness.ts` for RPC tests.

E2E specs must exercise real user-visible behavior, not only prove that Pi starts or that a command is registered.

Prefer no-cost real-agent E2E coverage with `_shared/testing/faux-provider-extension.ts` when model behavior can be deterministic. Configure the faux provider with environment variables instead of hardcoding extension-specific behavior into shared helpers.

## Test command reference

From the repository root:

```bash
bun run test:pi-extensions
bun run test:pi-extensions my-extension

bun run test:pi-extensions:e2e
bun run test:pi-extensions:e2e my-extension

bun run lint:pi-extensions
bun run typecheck:pi-extensions
```

Command behavior:

- `test:pi-extensions` runs only `configs/agents/pi/extensions/**/*.test.ts`.
- `test:pi-extensions my-extension` runs only that extension's `*.test.ts` files.
- `test:pi-extensions:e2e` runs only `configs/agents/pi/extensions/**/*.spec.ts`.
- `test:pi-extensions:e2e my-extension` runs only that extension's `*.spec.ts` files.

## Test checklist

Before handing off extension changes:

- [ ] Every behavior module has a same-basename `*.test.ts`, except type-only/static files.
- [ ] Every test uses Arrange / Act / Assert comments.
- [ ] `bun:test` `mock()` is used for spies and fakes instead of handwritten counters/workarounds.
- [ ] Default tests do not require network, credentials, provider CLIs, browser cookies, real models, or spawned Pi.
- [ ] Live boundaries have `*.spec.ts` or a documented reason they cannot be live-validated.
- [ ] Fake Pi tests exercise user-visible registered behavior.
- [ ] Test-only commands/tools/UI were not added to production registration.
