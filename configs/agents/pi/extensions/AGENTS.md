# Pi Extensions

Repository-owned Pi extensions live here and are installed by symlinking this directory to `~/.pi/agent/extensions`.

Before implementing or refactoring an extension, also follow:

- [`taste.md`](./taste.md) — module boundaries, TypeScript design, no barrels, and tasty code principles.
- [`testing.md`](./testing.md) — test coverage, Arrange / Act / Assert, `bun:test` mocks, and E2E rules.

## Structure

Each extension must have its own directory:

```text
configs/agents/pi/extensions/
  my-extension/
    index.ts
    index.test.ts
    index.spec.ts
    lib/
      register.ts
      register.test.ts
      feature.ts
      feature.test.ts
```

Rules:

- Use `extensions/<extension-name>/index.ts` as the only Pi entrypoint.
- `index.ts` must only wire/register the extension and export the default function.
- Keep behavior, parsing, command/tool handlers, and side-effectful helpers under `extensions/<extension-name>/lib/*.ts`.
- Keep Pi-specific code at the boundary: `index.ts` and `lib/register.ts`.
- Keep shared test helpers under `extensions/_shared/testing/`.
- Do not create `extensions/_shared/index.ts`; Pi auto-discovers `extensions/*/index.ts` as extensions.
- Do not add barrel exports or wrapper modules (`export * from ...`, re-export-only files). Import concrete modules directly.
- Avoid root-level `extensions/*.ts` unless it is intentionally a single-file extension.

Preferred `index.ts` shape:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerMyExtension } from "./lib/register";

export default function (pi: ExtensionAPI) {
  registerMyExtension(pi);
}
```

## Maintainability principles

- Treat every extension as a small, testable package.
- Prefer pure functions for domain logic.
- Use small modules with explicit names instead of large catch-all files.
- Normalize/classify inputs once near the boundary, then pass typed shapes through the workflow.
- Prefer typed results/errors over string matching in tool handlers.
- Use complete fake runtimes/implementations for tests instead of `resolveDependencies(overrides: Partial<...>)` patterns.
- Namespace commands, tools, and event-bus messages to avoid collisions as the extension set grows.
- Keep top-level side effects minimal; do startup work inside registration/event handlers.
- Check `ctx.hasUI` before prompting or showing UI in handlers that may run outside interactive mode.
- Respect abort signals for async work when `ctx.signal` or a tool `signal` is available.
- Truncate large custom-tool output before returning it to the model.
- Use `withFileMutationQueue()` for custom tools that mutate files.
- Use `StringEnum` from `@mariozechner/pi-ai` for string enum tool parameters.

See [`taste.md`](./taste.md) for examples and refactor checklists.

## Tests

Tests are colocated with the code they verify.

Use the filename suffix to communicate the boundary being tested:

- `*.test.ts` is for default no-cost tests.
  - Use for pure functions, local parsing/formatting, validation, storage helpers, or fake Pi integration.
  - Mock or avoid network, credentials, browsers, provider CLIs, subprocess E2E, and real model calls.
  - Use `mock()` from `bun:test` for spies/fakes instead of handwritten counters or workaround objects.
  - These tests run by default.
- `*.spec.ts` is for integration, live-contract, and E2E tests.
  - Use when the test crosses a process, network, browser-cookie, credential, real provider/model, or real Pi agent boundary.
  - May spawn Pi.
  - May call configured models and cost money.
  - These tests run only through the E2E test command.

Every extension must include E2E coverage in a `*.spec.ts` file. If an extension registers a command, tool, shortcut, flag, custom UI flow, event-driven visible behavior, or other user-facing capability, the E2E must exercise that actual capability through Pi rather than only checking startup or registration. Prefer a no-cost deterministic path when live providers would cost money or require credentials, and put gated live provider coverage behind explicit environment flags when needed.

Every behavior module should have a colocated same-basename `*.test.ts`, except type-only files and static schema/constant-only files.

Use Bun for tests and write every test in Arrange / Act / Assert form:

```ts
test("registers the command", async () => {
  // Arrange
  const fakePi = createFakePi();

  // Act
  registerMyExtension(fakePi.pi);

  // Assert
  expect(fakePi.commands.has("my-command")).toBe(true);
});
```

Prefer behavioral integration tests over implementation-detail tests. For extension registration, use the shared fake Pi harness from `_shared/testing/fake-pi.ts` and exercise registered commands, tools, and event handlers.

Do not register user-facing commands, tools, shortcuts, flags, messages, or UI solely for testing. Anything registered by an extension is available to the user after installation. If testability needs a seam, inject a complete fake runtime/implementation through `lib/register.ts` or test pure `lib/*.ts` functions instead.

See [`testing.md`](./testing.md) for detailed examples and checklists.

## Test commands

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
- `test:pi-extensions my-extension` runs only `configs/agents/pi/extensions/my-extension/**/*.test.ts`.
- `test:pi-extensions:e2e` runs only `configs/agents/pi/extensions/**/*.spec.ts`.
- `test:pi-extensions:e2e my-extension` runs only `configs/agents/pi/extensions/my-extension/**/*.spec.ts`.

Do not put paid/model-calling tests in `*.test.ts`; use `*.spec.ts`.

Run lint and typecheck after changing extension code. `lint:pi-extensions` uses Biome, and `typecheck:pi-extensions` uses `tsconfig.pi-extensions.json`.

## E2E guidance

Do not hide live `.spec.ts` coverage behind opt-in gates such as `*_LIVE_SPEC=1`, `*_COOKIE_SPEC=1`, or early-return skips. Specs are the extension's real-service validation entrypoints and should run when the E2E command selects them. If a live spec requires credentials, browser cookies, local provider setup, or a target URL, read those from the normal environment/config and fail clearly when unavailable rather than passing as skipped. Use default public targets when practical, and reserve env vars for required credentials, provider configuration, or overriding a target, not for enabling the test itself.

Prefer Pi RPC mode for E2E tests because it is observable and scriptable:

```bash
pi --mode rpc --no-session -e configs/agents/pi/extensions/my-extension
```

Use `_shared/testing/pi-rpc-harness.ts` for RPC-based E2E tests. E2E specs must exercise the extension's actual user-visible behavior, not only prove that Pi starts or that a command is registered. For commands, send the slash command through Pi and assert the resulting messages, files, tools, UI events, or other user-visible effects. For custom tools, drive the tool through the agent loop when practical and assert streamed tool events/results. Prefer no-cost real-agent E2E coverage with `_shared/testing/faux-provider-extension.ts` when model behavior can be deterministic. The shared faux provider registers a local in-process model for tests; configure its response per spec with `PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT` instead of hardcoding extension-specific behavior in the shared helper. Paid E2E tests can send prompts to configured real models and assert streamed events such as `tool_execution_start`, `tool_execution_end`, and `agent_end`.

Only expose deterministic commands or health-check behavior when they are genuinely useful to the user, not solely to make tests easier.
