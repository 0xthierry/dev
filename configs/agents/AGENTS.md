# AGENTS.md

Repository-level instructions for coding agents working in this project.

Apply higher-priority system and user instructions first. Use this file for implementation, validation, debugging, dependency handling, runtime behavior, version-control behavior, and handoff inside the repository. This file intentionally focuses on execution quality. Intent and ambiguity handling belong to higher-priority instructions.

## Correctness and uncertainty

Be explicit about uncertainty. Do not invent facts, sources, APIs, command results, file contents, implementation details, external-system behavior, or test outcomes.

Treat a claim as verified only when it is supported by inspection, execution, test output, source-backed checks, official documentation, contract validation, or observed runtime behavior.

If something is uncertain, resolve it through inspection or execution when possible. When the uncertainty changes architecture, scope, target files, external systems, credentials, compatibility, or user-visible behavior, ask a concise clarifying question if clarification is allowed. When clarification is not allowed, choose the safest reasonable default, continue, and document the assumption.

Do not present approximate work as complete. Implement the actual solution, verify it, and clearly separate what passed, what failed, and what could not be run.

Do not claim success for commands, tests, integrations, deployments, user workflows, provider behavior, or runtime behavior that was not actually observed.

## Authorization and interaction

A direct request to build, implement, fix, validate, refactor, or review authorizes the normal non-destructive work required to complete that task.

A design question such as “how can I…”, “what if we…”, or “can we make it…” is a discussion prompt, not implementation authorization. Present options and tradeoffs first. Write code only after the user clearly asks for implementation, unless higher-priority instructions say to proceed.

Do not offload execution by giving the user commands that you can run yourself. When a command is within tool access and the action is authorized, run it. Reserve “run this yourself” for interactive authentication, unavailable credentials, inaccessible environments, missing permissions, destructive actions that need approval, or tools outside the current runtime.

If a command or test fails, preserve the exact command and the actual relevant output. Do not rewrite or paraphrase error messages as if they were exact. Redact only secret values.

## Existing repository behavior

Stay inside the current workspace unless the user explicitly asks otherwise.

Match the existing repository style, naming, file organization, formatting, testing approach, and conventions, even when they differ from your default preferences.

Prefer focused changes. Avoid broad rewrites when a smaller change satisfies the request.

Do not create abstractions merely for appearance. Add an abstraction when it creates a meaningful boundary, isolates an external dependency, improves testability, clarifies domain behavior, removes real duplication, or supports an explicit requirement.

Backward compatibility is not an automatic hidden requirement. When a change may affect public interfaces, persisted data, configuration formats, integrations, deployment contracts, or user-visible behavior, ask whether compatibility is required if clarification is allowed. When clarification is not allowed, make the smallest safe change that satisfies the request. Preserve existing behavior when doing so is cheap and does not conflict with the requested change, but do not add legacy paths, duplicate interfaces, or duplicate behavior by default.

Do not impose conventions from a specific programming-language community when the repository has not chosen them. Follow the repository’s own conventions first. If there is no established convention, choose simple, readable, broadly understandable behavior.

## External systems, credentials, and secrets

Before work depends on credentials, tokens, external services, project selection, provider identifiers, generated IDs, remote resources, or external-system data, verify that the required environment is configured and usable when possible.

If credentials or services are unavailable, do not invent placeholders, local-only IDs, fake provider behavior, mock production data, or alternate production code paths. If implementation can continue safely, build the real environment-driven path and record the live-validation blocker. If the missing external value is required to perform the requested action, stop and ask when clarification is allowed.

Never print, persist, copy, commit, or expose secret values. Redact secrets from logs, reports, command output, screenshots, generated files, documentation examples, build files, deployment files, automation files, and final responses.

External service identifiers, provider names, model names, API methods, API capabilities, generated IDs, queue names, event names, registry names, and remote data shapes are contract data. Do not invent them. Verify them from installed source, official documentation, provider metadata, contract tests, or a gated live smoke check when credentials are available.

Mocks, stubs, simulations, and fakes are useful test support. They do not prove that a production external integration contract is valid.

## Evidence defaults for production-shaped software

Building the proof mechanism is part of implementation. Do not rely on ad hoc transcript commands, source files, manual claims, or final-response assertions when a repeatable validation entrypoint can reasonably be created.

Important behavior should have executable evidence. Choose the proof level that matches the risk and user-visible behavior: isolated tests for isolated logic, boundary tests for system boundaries, contract tests for external interfaces, workflow tests for full user journeys, smoke tests for runtime behavior, and operational checks for production configuration.

A check that exists but is not run is weak evidence. A live call that is ad hoc and not repeatable is weak evidence. A production claim without runtime validation is weak evidence. Prefer named commands, scripts, documented validation gates, automation steps, or health checks that future engineers can rerun.

## Workflow-level proof

When user-facing behavior depends on runtime interface behavior, client-side execution, asynchronous updates, realtime updates, routing, progressive enhancement, device behavior, or similar interactive behavior, prove the core workflow with a runtime-capable workflow test or equivalent check for the stack.

Lower-level tests, non-interactive protocol checks, snapshots, source inspection, and isolated component tests can support confidence, but they do not prove the full interactive workflow.

Do not remove or skip the normal workflow-level test setup merely because the interface is simple, minimal, data-store-free, static-looking, or easier to test at a lower level. If the workflow-level test cannot run, record the concrete blocker.

## External integration proof

When software depends on a real external service, provider, API, queue, payment system, identity provider, storage service, event source, package registry, or generated external data, add a named gated smoke or contract-validation entrypoint when practical.

The check must use real environment configuration, run live calls only when required credentials and an explicit enable flag are present, redact secrets, and report a concrete pass, fail, or blocked result.

Prefer a named project validation command or documented validation gate over one-off terminal calls that cannot be reproduced.

## State and persistence proof

When core application behavior depends on state, choose storage that matches the implied runtime.

For production-shaped software, core state should not live only in process memory, client-controlled payloads, unlocked local files, local-only caches, or other single-process shortcuts unless the user explicitly accepts ephemeral or single-instance behavior.

If the obvious persistence mechanism is forbidden, choose an appropriate alternative rather than dropping durability, consistency, or recovery expectations.

When local or file-backed storage is used for core state, make its limits explicit and handle the relevant risks: concurrency, locking, atomic writes, corruption, backup, restart behavior, runtime paths, permissions, and multi-instance deployment. Local storage can be acceptable for prototypes, tests, development-only paths, small single-node tools, or explicitly accepted single-instance deployments, but it should not be silently presented as general production durability.

## Validation gates

When a project has a validation, automation, release, or health-check command, include the checks that prove important inferred requirements: ordinary tests, workflow tests for user-facing behavior, external integration smoke when safely enabled, static or security checks when relevant, configuration validation, local boot/runtime checks, and deployment checks when deployment artifacts exist.

If a validation entrypoint exists, keep it aligned with the project. If an important proof mechanism is added, include it in the normal validation path when practical, or document why it is gated or separate.

## Tests, debugging, and fixes

When changing behavior, add or update tests at the level that proves the behavior. Use the narrowest useful test for the change, then run broader validation when the risk or scope justifies it.

When fixing a bug, prefer this sequence when practical: write or update a regression test that reproduces the bug, run it and confirm it fails for the expected reason, implement the fix, run the regression test again, then run the relevant broader validation. If the correct regression test is materially ambiguous and clarification is allowed, ask. If clarification is not allowed, write the narrowest test that captures the observed bug and document the assumption.

Do not confuse the first visible failure with the root cause. For data-related bugs, trace the bad value to the earliest point where it became incorrect, reinterpreted, overwritten, lost, exposed, or persisted incorrectly before proposing a fix.

When debugging, inspect the actual code path, data flow, configuration, and runtime output before proposing broad changes. Prefer fixes that address the earliest incorrect state, not only the final symptom.

## Dependency and generated-file management

Do not edit generated dependency-resolution files directly. Change dependencies through the project’s dependency-management tool and let the tool regenerate those files. If a direct edit appears necessary, ask first when clarification is allowed; otherwise avoid the direct edit and document the blocker.

Treat generated artifacts as outputs, not source, unless the project explicitly tracks them. Do not leave coverage reports, build output, temporary files, logs, local runtime state, cache files, smoke-test output, or machine-specific files in the repository unless they are intentionally tracked or ignored.

After validation, clean generated artifacts or ensure they are covered by the project’s ignore rules before handoff.

## Runtime, deployment, and configuration

Configuration should come from the appropriate environment, configuration files, secret stores, or deployment settings for the project. Do not hardcode environment-specific values, credentials, machine paths, ports, generated IDs, or provider secrets into source.

Production-shaped runtime paths should fail clearly when required configuration is missing. Do not silently fall back to fake providers, local-only behavior, unsafe defaults, or ephemeral state in production paths unless the user explicitly requested that behavior.

When deployment artifacts exist, validate them when practical. Build files, container definitions, deployment manifests, release scripts, health checks, and automation files are stronger when exercised or connected to a repeatable validation path.

Prefer explicit operational behavior over hidden assumptions: clear configuration errors, safe error messages, bounded resource usage, sensible timeouts, and documented runtime limits.

## Version-control history

Only create version-control commits when the user or harness asks for commits.

Use the semantic commit convention for commit messages:

```text
type(scope): subject
```

The scope is optional. Use a short type that describes the intent of the change, such as `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`, `perf`, or `revert`, unless the repository already uses a different semantic type set.

Keep the subject concise, imperative, and focused on the user-visible or maintainer-relevant change. Do not use the commit message to describe the agent’s process.

Include a body when context matters to future maintainers: the problem that motivated the change, the approach chosen, important tradeoffs, migration notes, compatibility notes, or operational consequences.

Use footers when machine-readable metadata is useful, such as issue references, release notes, or breaking-change notes. For breaking changes, make the compatibility impact explicit.

## Handoff

Before final handoff, run the relevant validation you can run from the current environment. If a relevant check cannot be run, state the concrete blocker.

Final responses should distinguish:

- what was changed;
- what was verified and passed;
- what failed, with actual relevant output;
- what could not be run and why;
- assumptions or remaining risks that matter to future work.

Do not include secret values in final responses. Do not claim success for anything that was not observed.

## Host Configuration

{{HOST_CONFIG}}
