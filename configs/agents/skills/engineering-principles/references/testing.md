# Test the real boundary

A test specifies one observable behavior at the boundary that owns it. Use real infrastructure when its semantics are part of the claim. Keep the specification visible in the test, isolate its state, and validate it through the project's test harness.

Apply this principle when choosing test scope, writing or reviewing tests, building fixtures, or deciding what a passing check proves. Read the project's testing guide and runner configuration first. This principle does not install a runner, rename an existing suite, or authorize live side effects.

## Derive the cases before implementation

Read the contract and existing writers before deriving behavioral cases. Every authorization or eligibility predicate, guarded-transition miss, uniqueness conflict, duplicate delivery, and relevant concurrent winner needs a named expected outcome. A happy path does not prove a fail-closed command.

Assert the complete fact consumed at the next boundary. If a subscriber or job depends on routing identity, correlation IDs, or presentation content, assert those values exactly. A convenient discriminator or substring does not prove the whole contract.

## Choose the boundary

Use unit, integration, and E2E as the automated categories. Smoke checks and agentic live checks are operator validation, not a fourth automated category. Do not invent a category or suffix to accommodate a test that has the wrong scope. Follow the project's approved placement map; changing it requires an explicit architecture decision.

| Category | What it proves | What stays real |
| --- | --- | --- |
| Unit | Meaningful isolated logic: parsing, mapping, classification, pure transitions, or key generation | The logic under test; no DB, queue, network, HTTP server, filesystem side effects, SDK calls, or use-case boundary |
| Integration: use case | The use case's returned result, durable state, and follow-up effects such as outbox writes | The use case and real database whenever persistence matters |
| Integration: handler, adapter, or other behavior | One owned behavior boundary | Its implementation; real DB when persistence matters; real queues only when queue behavior is the subject |
| Integration: repository | A DB-specific invariant that cannot be expressed through application behavior | The actual database, queries, constraints, and transactions |
| E2E: route | HTTP-visible behavior and durable side effects through the mounted application | Concrete app/router, middleware, use cases, repositories, and internal services |
| E2E: workflow | Runtime wiring from the external entrypoint to the final outcome | Every participating internal runtime boundary; for example HTTP, DB, outbox, queue, worker registration, and handler |

Colocate unit and integration tests. Keep route and workflow E2E specs in the project's E2E tree. A typical server map uses `*.test.ts`, `*.use-case.spec.ts`, other integration `*.spec.ts`, rare `*.repository.spec.ts`, E2E `*.router.spec.ts`, and `workflows/*.workflow.spec.ts`. These are placement conventions, not paths to impose on another repository.

Persistence-changing behavior is integration-tested through use cases with the real database by default. Prove the actual queries, constraints, transactions, and application-visible idempotency or concurrency the contract relies on. When the architecture uses a transactional outbox, prove its writes occur in the same transaction; do not require an outbox in an architecture that has none. Fakes do not establish database semantics.

Test an index's protected invariant, not its name. Direct repository specs are justified for behavior such as partial uniqueness, conflict targets, expression-based lookups, and concurrent row claiming that application tests cannot express.

Unit tests are selective, not mandatory per file. Never add tests for pass-through services or code with no meaningful isolated logic. Cover static configuration and constant lists through the behavior that consumes them; test parsing or normalization directly when that logic is meaningful.

Keep adjacent responsibilities separate. A use-case spec proves its own state and follow-up effects, not downstream consumption. Default job-handler tests invoke the handler directly with validated or intentionally invalid payloads, real DB when persistence matters, and external provider mocks when needed. They assume receipt and do not retest the upstream route. Do not duplicate a use case's full behavior in route tests. Reserve workflow E2E for important runtime paths; put edge cases in focused integration or unit tests unless the runtime boundary itself is the subject.

## Keep the specification in the test

- One behavior per test. The name states the behavior; the assertions prove it.
- Use clear Arrange, Act, and Assert sections. Add explicit comments when a section has more than one or two lines.
- Act is one line. If it needs several actions, reconsider the subject's API or split the behaviors.
- Arrange states only what matters. Put unrelated setup values in fixture-builder defaults.
- Assert observable results: returned values, persisted rows, outbox rows, or the request sent to an external provider. Internal call sequences belong in assertions only when the call itself is the contract.
- No conditionals or loops inside a test. Separate the cases.
- A test must be able to fail for a defect. If deleting the production line under test leaves it green, it does not prove that behavior.

Never wrap `expect()` in a helper or define shared custom matchers. Assertions stay in the spec file with the runner's built-in matchers. Share Arrange and Teardown, never Assert.

Removing an assertion helper does not mean pasting its body into every caller:

| Existing helper | Replacement |
| --- | --- |
| Wraps one matcher | Call that matcher inline. |
| Narrows a union or requires a setup row | Keep a typed `requireX` guard without `expect()`. It may throw for an unmet precondition; it must not hide the behavioral assertion. |
| Loads rows and asserts on them | Return typed data from a reader; assert the shape in the spec. |
| Repeats a many-field invariant | Use one built-in shape/equality assertion, subject to the runner's matcher caveats. |

Assert rejected promises directly with the runner's rejection matchers. Do not introduce error-capture helpers solely to assert a thrown type.

For Bun, read [Bun testing APIs](bun-testing.md) before choosing assertions, mocks, or time control. It routes to examples and version-specific caveats. Other runners need their own verified APIs; do not assume Bun behavior applies to them.

## Keep fixtures and shared state isolated

Use real provider and SDK types for valid fixtures. Never disguise a malformed fixture as `Record<string, unknown>`, `Partial<T>`, a broad custom payload, or a test-only cast/record guard. Invalid-payload tests may supply deliberately invalid values at the trust boundary. Fix valid fixtures or production types when the real provider type does not fit.

Reusable support owns setup, typed readers, fixture builders, and scoped teardown. Import support modules by deep path, without barrels. Support files must not use test-discovery suffixes. Support functions take one destructured object with explicit required dependencies.

Keep `createSubject` in the spec: the collaborators a test replaces are part of its specification. Also keep provider builders whose differing fields are asserted provider facts, bespoke cleanup graphs, ambient global installers, and smoke harnesses out of generic shared support.

Shared support must never assert, set or restore the clock, or delete by table. Every delete must target rows the spec owns. A predicate on a shared status, queue, job name, or broad prefix is still an unscoped delete.

Fixture identities must be unique across files, processes, and interrupted runs. Use a fixture scope with process entropy and randomness, not literal unique keys or a file-local counter. Keep required ID ordering explicit rather than depending on generated-ID shape.

Track known IDs before inserts where possible; otherwise track each row immediately after its own insert. Do not batch tracking after several inserts. Discover and track rows created indirectly by production code, including outbox and delivery rows. An ID-less join row must be selected by a tracked owning parent. A scope cannot clean up rows it never saw.

Cleanup must respect foreign keys, handle late-bound references with bounded retries, and fail with the remaining owned rows if no progress is possible. Do not conceal failed teardown.

Scope assertions as well as cleanup. A sweeper can read another spec's rows even when this spec deletes only its own. Query assertions through an owned, non-null identity. When repairing broad cleanup, repair unscoped assertions and hardcoded identities in the same change. Verify that a deliberately foreign row survives and does not change the assertions.

Unique fixture IDs prevent collisions; they do not isolate a production query that selects the first, oldest, or all qualifying rows. If a test requires an otherwise empty table, use an explicitly isolated harness boundary. Never delete or mutate foreign rows to force the subject to select your fixture.

Restore every replaced global, environment variable, and mock. Set test environment defaults only when unset, with literals matching the harness's tracked non-secret test configuration exactly. Do not overwrite shared process state with divergent per-spec credentials or endpoints. Configure import-time dependencies through the harness before loading the app; assume another co-resident spec may already have imported it. Keep time control in the spec's own hooks. Do not add production `now`, `clock`, or `date` parameters solely for test determinism.

## Run through the real harness

Use the project's canonical root commands for final validation, including its package-scoping wrappers. Do not substitute ad hoc file runs or workspace-local commands that bypass environment, containers, coverage, or process isolation. Discover the actual commands; names such as `test:unit`, `test:integration`, and `test:coverage` are examples, not guaranteed scripts.

Run the full directory or suite target the new spec joins, not only the file in isolation. Validate the supported shared-process and sharded isolation shapes. Isolated success can hide leaked globals, import-order dependencies, and foreign fixture interference. Do not silently narrow an agreed validation target.

The runner may reset its dedicated test database once at the run boundary, before any specs load. That is not permission for a spec to wipe shared tables. Use only the project's test-harness reset, with its test-database safeguards; never improvise a reset against an ambient database URL.

Interrupted runs can leave debris. For a full-suite-only failure, compare the same test on a clean dedicated test database before assuming a production defect. A clean-run success is evidence to investigate contamination, not proof that no other order-dependent defect exists. Verify that a successful run leaves no test-created rows or jobs behind; account separately for any baseline data the harness deliberately seeds.

## State what E2E and live checks prove

Route tests are HTTP black boxes. Use real concrete application wiring, not route-internal helpers or mocked use cases/repositories. Mock only outer provider/network boundaries. Configure provider endpoints before importing an app that wires them at import time.

Workflow E2E keeps all participating internal runtime boundaries real. Never import production process entrypoints in workflow specs. Compose and scope the runtime pieces explicitly, including the queue, events, worker registrations, and outbox relay when that architecture uses them. Register completion and failure waiters before publishing, so fast completion cannot be missed.

Distinguish provider modes:

- **Internal workflow E2E** proves the application-owned path. Only the outer provider/network boundary may be mocked. It does not prove a live provider contract.
- **Live-provider E2E** claims the real provider contract and must use the configured provider. Missing live configuration is a failure or blocker, never permission to substitute fakes.

A multi-boundary test with replaced internal runtime components is integration coverage, not workflow E2E.

Application smoke checks must preflight and exercise the actual running application stack through an external or product-shaped entrypoint. Do not start a private replacement server, worker, coordinator, or in-process harness and call it an application smoke. A component/operator check can be useful, but name its narrower claim. Report the project's real startup command when the app is unavailable.

Run smoke scripts, generated migrations, and one-off/operator scripts as artifacts. Do not add tests that merely exercise their script text. Extract reusable parsing or planning into ordinary modules if it needs regression coverage.

Agentic live checks require a runbook with allowed side effects, snapshot/restore requirements, evidence paths, expected outputs, and a reviewer checklist. Produce a structured report validated by the project's report validator, then have a separate read-only reviewer check external evidence and final state. Missing credentials, evidence, reviewer, validator, or failed restoration is a blocker. Do not replace deterministic automated coverage with agentic self-certification.

## Report the evidence

Name the tested behavior, chosen boundary, infrastructure left real, and any external mocks. Report the canonical commands actually run, their outcomes, and unverified claims or blockers. A skipped live contract, a mock-only persistence check, or a successful command that discovered no tests is not passing coverage.
