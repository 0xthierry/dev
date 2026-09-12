---
name: engineering-principles
description: >-
  Select and apply engineering principles when advising on a decision or implementing
  a change. Assess applicability, read the selected definitions in full, and explain
  which concrete choices they changed or why a relevant principle was not used.
  Includes TypeScript and testing guidance with on-demand Bun API references.
  Do not load every definition by default.
---

# Select and apply engineering principles

Choose principles before the decision they govern, not after the work to justify it. This index supplies applicability triggers. The linked files supply the full definitions. Reading a name or its summary is not applying the principle.

## Make the applicability decision

1. Identify the outcome, constraints, current decision, and evidence available. Use the advisor's lens or the worker's task to find candidate principles in the index.
2. Compare each candidate's trigger with the actual task. Read its definition in full before applying it. If the trigger or an exception is uncertain, read the definition before deciding not to use it.
3. State a brief selection rationale before the consequential choice. Name the principle, the task condition that makes it relevant, and the action or recommendation it requires. A narrow task can do this in one sentence; do not create a document just for the selection.
4. Apply the full rule, including its conditions and required outputs. A stronger requirement must not become optional merely because a weaker action is easier. If it conflicts with the assignment or authority, name the conflict and ask the parent. Mark it blocked or deferred, not irrelevant or completed.
5. Reassess when new evidence, scope, or a failed attempt changes applicability. Explain a material change in selection instead of continuing under a stale premise.
6. In the result, name each principle that actually shaped a decision and the specific choice it changed. Point to the evidence or artifact when the principle requires one. Cite only definitions read in this session.

Explain why not when the parent requested a principle, a plausible candidate was considered and rejected, or a normally applicable step was skipped. Give the concrete missing condition, exception, or blocker. Do not enumerate every unrelated principle or use "not needed" without a reason.

Return concise decision rationales, not a transcript of internal deliberation. A principle that was read but changed nothing should not be claimed as applied. "Selected" before work and "applied" after work are different claims.

## Core

- **[Laziness Protocol](references/laziness-protocol.md).** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading.
- **[Foundational Thinking](references/foundational-thinking.md).** Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **[Redesign from First Principles](references/redesign-from-first-principles.md).** Integrating a new requirement into an existing design.
- **[Attack the Premise](references/attack-the-premise.md).** Two or more fixes that share one premise have failed the same gate.
- **[Subtract Before You Add](references/subtract-before-you-add.md).** Sequencing an addition, refactor, or rewrite.
- **[Minimize Reader Load](references/minimize-reader-load.md).** Reviewing or shaping code that is hard to trace.
- **[Outcome-Oriented Execution](references/outcome-oriented-execution.md).** Planned rewrites and migrations with explicit phase boundaries.
- **[Experience First](references/experience-first.md).** Product, UX, or feature-scope tradeoffs.
- **[Exhaust the Design Space](references/exhaust-the-design-space.md).** A novel interaction or architectural decision with no established precedent and multiple viable approaches.
- **[Build the Lever](references/build-the-lever.md).** Any nontrivial work, including a one-off whose tool makes the work repeatable or checkable.

## Architecture

- **[Model the Domain](references/model-the-domain.md).** Stateful logic, branching, or repeated shape assumptions across files.
- **[Boundary Discipline](references/boundary-discipline.md).** Validation, error handling, or framework adapters.
- **[Type System Discipline](references/type-system-discipline.md).** Types or signatures in a statically typed language.
- **[Make Operations Idempotent](references/make-operations-idempotent.md).** Commands, lifecycle steps, or loops amid crashes, restarts, and retries.
- **[Migrate Callers Then Delete Legacy APIs](references/migrate-callers-then-delete-legacy-apis.md).** Introducing a new internal API while old callers still exist.
- **[Separate Before Serializing Shared State](references/separate-before-serializing-shared-state.md).** Concurrent actors might write the same file, branch, key, or object.

## Verification

- **[Prove It Works](references/prove-it-works.md).** After a task, before declaring done.
- **[Fix Root Causes](references/fix-root-causes.md).** Debugging a reported failure.
- **[Sequence Work into Verifiable Units](references/sequence-verifiable-units.md).** Multi-step work, sweeps, migrations, or delivery through ordered commits.
- **[Test Behavior, Not Implementation](references/test-behavior-not-implementation.md).** Writing, changing, or keeping a test.
- **[Test the real boundary](references/testing.md).** Choosing test scope, writing or reviewing tests, building fixtures, or deciding what passing coverage proves.

## Context and enforcement

- **[Guard the Context Window](references/guard-the-context-window.md).** Large outputs, long files, repeated reads, or fan-out planning.
- **[Encode Lessons in Structure](references/encode-lessons-in-structure.md).** A repeated instruction or recurring correction that could become an enforced mechanism.

## TypeScript

For TS or TSX work, read [Type System Discipline](references/type-system-discipline.md), then [TypeScript best practices](references/typescript.md). Load [TypeScript patterns](references/typescript-patterns.md) when concrete syntax or an example is needed. Do not substitute the language-specific table for the underlying principle.

Before using the test-assertion heuristic or the constructive time-range example as proof, read the [known definition and example conflicts](references/known-conflicts.md). The definitions are preserved; a demonstrated conflict must be surfaced rather than silently rewritten or applied against contrary evidence.

## Testing and Bun

For testing work, read [Test Behavior, Not Implementation](references/test-behavior-not-implementation.md) and its [known assertion-heuristic conflict](references/known-conflicts.md), then [Test the real boundary](references/testing.md) for category selection, real-infrastructure requirements, visible assertions, fixture isolation, and evidence. If the project's runner is Bun, then read [Bun testing APIs](references/bun-testing.md). That table selects built-in matchers, typed mocks, and time controls. Load [Bun testing patterns](references/bun-testing-patterns.md) when implementing an unfamiliar API or checking a version-sensitive caveat. Non-Bun work does not need the Bun references.

## Apply within the role

The advisor uses principles to evaluate and recommend. It does not claim an implementation or experiment was completed merely because it recommended one. The worker uses principles to change and verify the assigned artifact. Both retain the authority and parent-communication rules in their agent files.

Short names such as `prove-it-works` in the definitions refer to this index's matching reference. References to other workflows do not install those workflows or grant their permissions. If a required companion is unavailable, report the dependency rather than inventing an equivalent result.
