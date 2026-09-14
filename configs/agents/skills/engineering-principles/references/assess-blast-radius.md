# Assess Blast Radius

Before shipping a change whose safety depends on behavior outside the diff, identify what else can break and prove the critical assumption that makes the change safe.

Apply this to shared APIs, persisted or wire formats, migrations, dependency behavior, lifecycle timing, concurrency, cross-language boundaries, and small-looking changes with downstream consumers.

**Pattern:**

1. **State what changed.** Include the behavioral difference that the diff does not make obvious.
2. **Name the critical safety claim.** Find the one or two facts on which most of the change's safety depends. A long list of hypothetical risks is not a substitute.
3. **Follow the path beyond the diff.** Trace callers, readers and writers, schemas, pinned dependency behavior, downstream consumers, timing, cleanup, and failure recovery where they can affect the claim.
4. **Prove the claim as directly as practical.** Strengthen the evidence as far as practical: point to the authoritative source, trace whether the bad case is reachable, run a script or test against the real code, then reproduce it in the running system when the surface is available. Use [Build the Lever](build-the-lever.md) when a rerunnable check makes the proof reviewable.
5. **Classify the result.** Separate confirmed risks, risks checked and cleared, and unproven claims. If executable evidence was practical but not obtained, the safety claim remains unproven.

A risk is actionable only when it has a reachable path and a concrete consequence. Do not manufacture findings from possibilities that types, validation, ownership, or actual callers exclude.

This principle complements [Prove It Works](prove-it-works.md). Prove It Works checks that the intended result occurs. Assess Blast Radius checks that the same change does not violate a contract somewhere else.
