# Pi Extensions

Repository-owned Pi extensions live here and are installed by symlinking this directory to `~/.pi/agent/extensions`.

## Structure

Each extension must have its own directory:

```text
configs/agents/pi/extensions/
  my-extension/
    index.ts
    lib/
      register.ts
      feature.ts
      feature.test.ts
      register.test.ts
    index.spec.ts
```

Rules:

- Use `extensions/<extension-name>/index.ts` as the only Pi entrypoint.
- `index.ts` must only wire/register the extension and export the default function.
- Keep behavior, parsing, command/tool handlers, and side-effectful helpers under `extensions/<extension-name>/lib/*.ts`.
- Keep shared test helpers under `extensions/_shared/testing/`.
- Do not create `extensions/_shared/index.ts`; Pi auto-discovers `extensions/*/index.ts` as extensions.
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
- Keep Pi-specific code at the boundary (`index.ts` and `lib/register.ts`).
- Prefer pure functions for domain logic.
- Use small modules with explicit names instead of large catch-all files.
- Namespace commands, tools, and event-bus messages to avoid collisions as the extension set grows.
- Keep top-level side effects minimal; do startup work inside registration/event handlers.
- Check `ctx.hasUI` before prompting or showing UI in handlers that may run outside interactive mode.
- Respect abort signals for async work when `ctx.signal` or a tool `signal` is available.
- Truncate large custom-tool output before returning it to the model.
- Use `withFileMutationQueue()` for custom tools that mutate files.
- Use `StringEnum` from `@mariozechner/pi-ai` for string enum tool parameters.

## Tests

Tests are colocated with the code they verify.

- `*.test.ts` is for default no-cost tests.
  - Use pure functions or fake Pi integration.
  - Do not call real models.
  - These tests run by default.
- `*.spec.ts` is for real Pi E2E tests.
  - May spawn Pi.
  - May call configured models and cost money.
  - These tests run only through the E2E test command.

Use Bun for tests and write tests in Arrange / Act / Assert form:

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

Do not register user-facing commands, tools, shortcuts, flags, messages, or UI solely for testing. Anything registered by an extension is available to the user after installation. If testability needs a seam, inject dependencies through `lib/register.ts` or test pure `lib/*.ts` functions instead.

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

Prefer Pi RPC mode for E2E tests because it is observable and scriptable:

```bash
pi --mode rpc --no-session -e configs/agents/pi/extensions/my-extension
```

Use `_shared/testing/pi-rpc-harness.ts` for RPC-based E2E tests. E2E specs must exercise the extension's actual user-visible behavior, not only prove that Pi starts or that a command is registered. Prefer no-cost real-agent E2E coverage with `_shared/testing/faux-provider-extension.ts` when model behavior can be deterministic. The shared faux provider registers a local in-process model for tests; configure its response per spec with `PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT` instead of hardcoding extension-specific behavior in the shared helper. Paid E2E tests can send prompts to configured real models and assert streamed events such as `tool_execution_start`, `tool_execution_end`, and `agent_end`.

Only expose deterministic commands or health-check behavior when they are genuinely useful to the user, not solely to make tests easier.
