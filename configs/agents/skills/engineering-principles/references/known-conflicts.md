# Known definition and example conflicts

The principle definitions and TypeScript examples are preserved rather than silently corrected. These are specific factual discrepancies to surface when they affect an assignment, not replacement principles or general exceptions.

## Assertions that fail on undefined

[Test Behavior, Not Implementation](test-behavior-not-implementation.md) lists `toBeDefined` and `toBeTruthy` among assertion shapes that still pass when an imported function returns `undefined`.

Both assertions fail on `undefined`. The assertion's shape alone therefore does not establish the claimed behavior. Do not report that a particular test still passes without checking it. If this classification would lead to deleting or rewriting a test, give the parent the concrete counterexample and ask how to resolve the conflict.

## A duration typed as number can be negative

The constructive time-range example in [TypeScript patterns](typescript-patterns.md) says a negative range cannot be written with `{ start: Date; durationMs: number }`.

That type accepts `durationMs: -1`. The representation alone does not prove non-negativity. Do not cite it as such a proof. If the assignment needs that invariant, surface the missing construction or validation guarantee to the parent before using the example as the design contract.

Keep these conflicts separate from the preserved definitions. A future correction should be explicit and reviewed, not hidden inside a paraphrase of the principle.
