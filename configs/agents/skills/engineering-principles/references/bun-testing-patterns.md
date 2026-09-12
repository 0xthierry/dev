# Bun testing patterns

Use the [Bun API selection table](bun-testing.md) to choose the relevant section. The snippets illustrate assertions and setup; names such as `subject`, `command`, and `fixture` stand for the project's real subject and fixtures. They are not repository commands or replacements for integration/E2E coverage.

## Equality and shapes

Keep assertions in the spec with built-in matchers:

```ts
expect(row.expiresAt).toEqual(frozenNow)
expect(result).toEqual({ status: 'recorded', deliveryId: expectedDeliveryId })
expect(row).toMatchObject({ status: 'pending', installationId: ownedInstallationId })
```

`toEqual` compares `Date` values by instant. A different instant, an ISO string, `null`, and `undefined` do not equal the expected `Date`. A separate `toBeInstanceOf(Date)` adds nothing to that equality check.

Use a complete literal shape for facts the next boundary consumes. Use a partial shape only for genuinely irrelevant extra fields; do not omit routing identity or correlation just to shorten an assertion.

## Asymmetric matchers and received-object mutation

Verified on Bun 1.3.10 and 1.4.0: `toMatchObject` with asymmetric matchers can write the matcher into the received object. A later read, including through an alias, then sees the matcher rather than production data.

```ts
// Unsafe on the documented version: the field can stop being a Date.
expect(row).toMatchObject({ at: expect.any(Date) })

// A later comparison can now accept an unrelated instant.
expect(new Date('1999-12-31T00:00:00.000Z')).toEqual(row.at)
```

Keep concrete values in `toMatchObject`. Assert loose fields separately:

```ts
// Unsafe: a later leak check may inspect a matcher instead of the real details.
expect(failure).toMatchObject({
  code: 'provider_failure',
  details: expect.objectContaining({ provider: 'example' }),
})

// Safe shape assertions: do not replace the details object with a matcher.
expect(failure).toMatchObject({ code: 'provider_failure' })
expect(failure.details).toMatchObject({ provider: 'example' })
expect(JSON.stringify(failure.details)).not.toContain(secretSentinel)
```

Concrete `toMatchObject` values and `toEqual` were unaffected in those checks. Reproduce version-sensitive behavior with the project's pinned runtime before claiming a fix or removing the precaution. Do not treat this example as a claim that every later release still mutates receivers.

## Promises

Assert a rejection directly and await the matcher:

```ts
await expect(subject.run(command)).rejects.toThrow(ExpectedError)
await expect(subject.read(query)).resolves.toEqual({ status: 'ready' })
```

Do not introduce `catchError` helpers or catch-and-store variables merely to assert the error type. Missing `await` can make the test finish before the assertion settles.

## Typed mocks and callbacks

Derive the callable type from the real dependency when possible, such as `WebClient['chat']['postMessage']`. Use the provider's actual payload types in fixtures.

```ts
import { expect, it, mock } from 'bun:test'
import type { Mock } from 'bun:test'

type SendMessage = (input: { channel: string; text: string }) => Promise<{ ok: true }>

function createSendMessageMock(): Mock<SendMessage> {
  const sendMessage = mock<SendMessage>()
  sendMessage.mockResolvedValue({ ok: true })
  return sendMessage
}

it('sends the mapped message', async () => {
  // Arrange
  const sendMessage = createSendMessageMock()
  const subject = createSubject({ sendMessage })

  // Act
  await subject.run({ channelId: 'C123', message: 'hello' })

  // Assert
  expect(sendMessage).toHaveBeenCalledTimes(1)
  expect(sendMessage).toHaveBeenCalledWith({ channel: 'C123', text: 'hello' })
})
```

`mock<T>()` returns a function typed as `T` with Bun mock methods. Use `Mock<Dependency>` for helper return types, not an unspecialized `ReturnType<typeof mock>`.

Use `mockResolvedValueOnce` and `mockRejectedValueOnce` for successive async outcomes. Use `toHaveBeenNthCalledWith`, `toHaveBeenLastCalledWith`, and result matchers when the order or result is itself the contract.

Assert call arguments with matchers, not manual extraction from `.mock.calls`. Extract a captured value only to feed it back into the test, such as invoking the callback a subject registered. Keep callback registration and callback behavior as separate cases when they specify different behaviors. Use `spyOn` only when observing a real method is the point of the test.

## Mock cleanup and module boundaries

Prefer fresh local mocks per test. If shared mocks are necessary, `mock.clearAllMocks()` in `afterEach` clears call history; it does not reset implementations or restore module exports. Configure per-test behavior explicitly rather than relying on consumed one-shot responses from another test.

Use `mock.module()` sparingly, at external module boundaries. If importing the original module would trigger side effects that must not run, preload its mock before importing the subject. Do not import that module merely to take a cleanup snapshot; use the project's isolated/preloaded harness for that case.

For a safe-to-import module, snapshot its real exports before registering a replacement. On Bun 1.3.10 and 1.4.0, `mock.restore()` alone does not restore exports replaced by `mock.module()`. Those replacements can affect later spec files. Explicitly re-register the snapshot during teardown:

```ts
import { afterAll, mock } from 'bun:test'
import * as providerModule from './provider-client'

const snapshot = { ...providerModule }

mock.module('./provider-client', () => ({
  ...snapshot,
  send: mock<typeof providerModule.send>(),
}))

// Import the subject after registering the mock.
const { createSubject } = await import('./subject')

afterAll(() => {
  mock.restore()
  mock.module('./provider-client', () => snapshot)
})
```

The module names are illustrative; use the exact specifier production resolves. This technique restores exports, not arbitrary initialization side effects or already-created application objects. Verify it through the complete suite target, not an isolated spec alone.

For shared logger capture, return a proxy from the module mock. Do not replace methods on the real singleton and then expect an export snapshot to repair that mutation.

## System time

Use normal production time APIs. Do not add `now`, `clock`, or `date` parameters solely to make tests deterministic.

For deterministic timestamps, control Bun's system time in the spec's own hooks:

```ts
import { afterEach, beforeEach, expect, it, setSystemTime } from 'bun:test'

const frozenNow = new Date('2026-05-15T00:00:00.000Z')

beforeEach(() => {
  setSystemTime(frozenNow)
})

afterEach(() => {
  setSystemTime()
})

it('writes the current timestamp', async () => {
  // Arrange
  const subject = createSubject()

  // Act
  const saved = await subject.run(command)

  // Assert
  expect(saved.updatedAt).toEqual(frozenNow)
})
```

`setSystemTime` affects `new Date()`, `Date.now()`, and the default current time used by `Intl.DateTimeFormat().format()`. It does not run pending `setTimeout` or `setInterval` callbacks. Moving the system clock forward is not evidence that a polling or retry callback ran.

## Scheduled timers and stale recovery

When the subject needs a scheduled timer to fire, use Bun's `jest` compatibility API from `bun:test`. Do not install Jest or combine fake timers with `setSystemTime` in the same spec file.

```ts
import { afterEach, beforeEach, expect, it, jest, mock } from 'bun:test'

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-05-15T00:00:00.000Z') })
})

afterEach(() => {
  jest.useRealTimers()
})

it('polls after the configured interval', () => {
  // Arrange
  const onPoll = mock<(input: { subscriptionId: string }) => void>()
  const subject = createSubject({ onPoll, subscriptionId: 'subscription-1' })
  subject.startPolling()

  // Act
  jest.advanceTimersByTime(30_000)

  // Assert
  expect(onPoll).toHaveBeenCalledTimes(1)
  expect(onPoll).toHaveBeenCalledWith({ subscriptionId: 'subscription-1' })
})
```

Fake timers advance the clock along with scheduled callbacks. Await actual promise work when the callback is asynchronous; advancing timers synchronously is not proof that every async continuation has completed. Normal promises still resolve under fake timers.

A frozen clock alone cannot age a row past a stale-reclaim threshold. Either arrange the stored timestamp far enough before the frozen time that it already qualifies, or advance fake time when the test claims to prove the transition into eligibility. If a test hangs for exactly a configured wait budget, inspect clock and stored-time assumptions before blaming the network.

Clock control is process-global state. Shared fixtures must not freeze or restore it. Keep hooks and restoration in the spec, and verify coexistence with the suite's other files.
