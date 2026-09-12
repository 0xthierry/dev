# Bun testing APIs

Apply [Test the real boundary](testing.md) first. Use this reference when the selected project's runner is Bun. It owns Bun-specific API choices; the principle owns test boundaries, isolation, and evidence.

Check the project's pinned Bun executable and installed `bun-types` before relying on a version-sensitive API. Date equality, typed mocks, promise matchers, receiver mutation, module restoration, and clock/timer behavior below were checked on Bun 1.3.10 and 1.4.0. These are versioned observations, not a claim that every release behaves identically. Do not introduce Vitest or Jest packages to use Bun's `bun:test` exports.

## Select the API

| Need | Rule | Read when implementing |
| --- | --- | --- |
| Compare values, dates, or complete shapes | Use built-in equality matchers. A `Date` compares by value with `toEqual`; do not convert it to milliseconds just to assert equality. | [Equality and shape examples](bun-testing-patterns.md#equality-and-shapes) |
| Assert a partial shape | Use `toMatchObject` with concrete values. Bun 1.3.10 and 1.4.0 were observed to mutate the received object when it contains asymmetric matchers; do not risk turning later assertions into matcher comparisons. | [Asymmetric matcher caveat](bun-testing-patterns.md#asymmetric-matchers-and-received-object-mutation) |
| Assert async success or failure | Await `.resolves` / `.rejects`; do not capture an error manually just to assert its type. | [Promise examples](bun-testing-patterns.md#promises) |
| Replace a dependency whose calls are a contract | Use `mock<Dependency>()` and typed built-in call/result matchers. Assert the complete relevant payload, not call presence alone. | [Typed mocks and callbacks](bun-testing-patterns.md#typed-mocks-and-callbacks) |
| Reset or restore mocks | Prefer fresh local mocks. `mock.restore()` does not undo `mock.module()` on the checked versions. Explicitly re-register safe export snapshots or use the project's isolated/preloaded harness. | [Mock cleanup and module boundaries](bun-testing-patterns.md#mock-cleanup-and-module-boundaries) |
| Deterministic timestamps | Use `setSystemTime(frozen)` and reset with `setSystemTime()` in the spec's `afterEach`. It changes system time but does not fire pending timers. | [System time](bun-testing-patterns.md#system-time) |
| Fire a scheduled callback, polling, or retry | Use `jest.useFakeTimers({ now })`, advance timers, then `jest.useRealTimers()`. Do not combine this with `setSystemTime` in the same spec file. | [Scheduled timers and stale recovery](bun-testing-patterns.md#scheduled-timers-and-stale-recovery) |

Read the relevant examples before using an unfamiliar API or a version-sensitive behavior. Do not load the patterns file for a non-Bun task. Keep clock mutation and restoration in spec-local hooks; shared support must not own process-global time.

## Built-in matcher lookup

This inventory targets `bun-types@1.3.10`. Verify the selected method against the project's installed types. Use the narrowest matcher that proves the behavioral claim.

```text
equality      toBe toEqual toStrictEqual toMatchObject toSatisfy
presence      toBeDefined toBeUndefined toBeNull toBeNil toBeTruthy toBeFalsy
dates         toBeDate toBeValidDate
numbers       toBeCloseTo toBeGreaterThan toBeLessThan toBeWithin toBeOneOf
collections   toContain toContainEqual toContainKey toContainKeys toContainAllKeys
              toContainValue toHaveLength toHaveProperty
strings       toStartWith toEndWith toInclude toMatch toEqualIgnoringWhitespace
errors        toThrow; rejects.toThrow; resolves
mocks         toHaveBeenCalled toHaveBeenCalledTimes toHaveBeenCalledWith
              toHaveBeenNthCalledWith toHaveBeenLastCalledWith toHaveReturnedWith
asymmetric    expect.objectContaining expect.arrayContaining expect.stringContaining
              expect.stringMatching expect.any expect.anything expect.closeTo
```

Presence is a narrower claim than correct content. `toBeDefined` and `toBeTruthy` do reject `undefined`; that fact alone does not prove a result has the required value. See the [known principle conflicts](known-conflicts.md) before relying on the preserved undefined-return heuristic.

`expect.extend` exists at runtime. Do not use it here: a custom matcher would move the shared assertion out of the spec.
