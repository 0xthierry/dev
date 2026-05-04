# AGENTS.md

Repository-level instructions for coding agents working in this project. Apply higher-priority system and user instructions first. Use this file to guide implementation, validation, debugging, and handoff behavior inside the repository.

## Correctness and uncertainty

Be explicit about uncertainty. Do not invent facts, sources, APIs, command results, file contents, implementation details, external-system behavior, or test outcomes.

Treat a claim as verified only when it is supported by code inspection, command output, tests, installed package/source inspection, official documentation, or observed runtime behavior.

If something is uncertain, resolve it through inspection or execution when possible. When the uncertainty changes architecture, scope, target files, external systems, credentials, compatibility, or user-visible behavior, ask a concise clarifying question if clarification is allowed. When clarification is not allowed, choose the safest reasonable default, continue, and document the assumption.

Do not present approximate work as complete. Implement the real solution, verify it, and clearly separate what passed, what failed, and what could not be run.

## Linked and referenced files

When asked to read or work from a file that contains links, references, imports, citations, attachments, or related file paths, assess whether those referenced materials are relevant to the current task or likely to affect upcoming work.

Read the referenced materials when they are necessary to understand context, verify claims, resolve ambiguity, inspect dependencies, follow implementation flow, or avoid making unsupported assumptions.

Do not ignore relevant linked or referenced materials merely because they are indirect. If a referenced item cannot be accessed, is unavailable, or is unnecessary for the task, state that clearly and explain the impact, if any, on the work.

When relevance is uncertain and the decision could affect architecture, scope, target files, external systems, credentials, compatibility, or user-visible behavior, ask a concise clarifying question if clarification is allowed. When clarification is not allowed, choose the safest reasonable default, continue, and document the assumption.

## Authorization and interaction

A direct request to build, implement, fix, validate, or refactor authorizes the normal non-destructive work required to complete that task.

A design question such as “how can I…”, “what if we…”, or “can we make it…” is a discussion prompt, not implementation authorization. Present options and tradeoffs first. Write code only after the user clearly asks for implementation, unless higher-priority instructions say to proceed.

Do not offload execution by giving the user commands that you can run yourself. When a command is within tool access and the action is authorized, run it. Reserve “run this yourself” for interactive authentication, unavailable credentials, inaccessible environments, missing permissions, or tools outside the current runtime.

## Existing repository behavior

Match the existing repository style, naming, file organization, formatting, testing patterns, and framework conventions, even when they differ from your default preferences.

Prefer focused changes. Avoid broad rewrites when a smaller change satisfies the request.

Do not create helpers, utilities, service objects, abstractions, or indirection layers merely for appearance. Add an abstraction when it creates a meaningful boundary, isolates an external dependency, improves testability, clarifies domain behavior, removes real duplication, or supports an explicit requirement.

Backward compatibility is not an automatic hidden requirement. When a change may affect public APIs, persisted data, configuration formats, integrations, deployment contracts, or user-visible behavior, ask whether compatibility is required if clarification is allowed. When clarification is not allowed, make the smallest safe change that satisfies the request. Preserve existing behavior when doing so is cheap and does not conflict with the requested change, but do not add legacy paths, shims, or duplicate behavior by default.

## External systems, credentials, and secrets

Before work depends on credentials, tokens, external services, project selection, provider models, generated IDs, or external-system data, verify that the required environment is configured and usable when possible.

If credentials or services are unavailable, do not invent placeholders, local-only IDs, fake provider behavior, mock production data, or alternate production code paths. If implementation can continue safely, build the real environment-driven path and record the live-validation blocker. If the missing external value is required to perform the requested action, stop and ask when clarification is allowed.

Never print, persist, copy, commit, or expose secret values. Redact secrets from logs, reports, command output, screenshots, generated files, README examples, Docker files, compose files, CI files, and final responses.

Mocks, stubs, and fakes are useful test support. They do not prove that a production external integration contract is valid. Verify external APIs, SDK methods, model names, configuration keys, generated data shapes, and provider behavior through installed source, official documentation, contract tests, or a gated live smoke test when credentials are available.

## Evidence defaults for production-shaped software

Building the proof mechanism is part of implementation. Do not rely on ad hoc transcript commands, source files, manual claims, or final-response assertions when a repeatable validation entrypoint can reasonably be created.

Important behavior should have executable evidence. Choose the proof level that matches the risk and user-visible behavior: unit tests for isolated logic, integration tests for boundaries, contract tests for external interfaces, system or end-to-end tests for full workflows, smoke tests for runtime behavior, and operational checks for production configuration.

When software includes dynamic user-facing behavior, keep or add the normal system, browser, end-to-end, or workflow test setup for the stack. Do not skip workflow-level tests merely because the interface is simple, minimal, database-free, or implemented with a lightweight framework. Lower-level tests do not replace a workflow test for the core user journey.

When software depends on a real external service, provider, SDK, model, API, queue, payment system, identity provider, storage service, webhook, package registry, or generated external data, add a named gated smoke or contract-validation entrypoint when practical. The check must use real environment configuration, run only when required credentials and an explicit enable flag are present, redact secrets, and report a concrete pass/fail/blocker result.

When core application behavior depends on state, choose storage that matches the implied runtime. For production-shaped software, core state should not live only in process memory, hidden fields, unbounded client/session payloads, unlocked local files, or other single-process shortcuts unless the user explicitly accepts ephemeral or single-instance behavior. If the obvious persistence mechanism is forbidden, choose an appropriate alternative rather than dropping durability, consistency, or recovery expectations.

When local or file-backed storage is used for core state, make its limits explicit and handle the relevant risks: concurrency, locking, corruption, backup, restart behavior, container/runtime paths, permissions, and multi-instance deployment. Local storage can be acceptable for prototypes, tests, development-only paths, small single-node tools, or explicitly accepted single-instance deployments, but it should not be silently presented as general production durability.

When a project has a validation, CI, release, or health-check command, include the checks that prove important inferred requirements: ordinary tests, workflow tests for user-facing behavior, external integration smoke when safely enabled, static/security checks when relevant, configuration validation, local boot/runtime checks, and deployment/container checks when deployment artifacts exist.

A check that exists but is not run is weak evidence. A live call that is ad hoc and not repeatable is weak evidence. A production claim without runtime validation is weak evidence. Prefer named commands, scripts, CI steps, or documented validation gates that future engineers can rerun.

## Tests, debugging, and fixes

When changing behavior, add or update tests at the level that proves the behavior. Use the narrowest useful test for the change, then run broader validation when the risk or scope justifies it.

When fixing a bug, prefer this sequence when practical: write or update a regression test that reproduces the bug, run it and confirm it fails for the expected reason, implement the fix, run the regression test again, then run the relevant broader validation. If the correct regression test is materially ambiguous and clarification is allowed, ask. If clarification is not allowed, write the narrowest test that captures the observed bug and document the assumption.

Do not confuse the first visible failure with the root cause. For data-related bugs, trace the bad value to the earliest point where it became incorrect, reinterpreted, overwritten, lost, exposed, or persisted incorrectly before proposing a fix.

When a command or test fails, preserve the exact command and the actual relevant output. Do not rewrite or paraphrase error messages as if they were exact. Redact only secret values.

## Dependency and generated-file management

Do not edit generated lockfiles directly, including `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`, `uv.lock`, `Gemfile.lock`, and similar files. Change dependencies through the package manager or generator command and let the tool regenerate the lockfile. If a direct lockfile edit appears necessary, ask first when clarification is allowed; otherwise avoid the direct edit and document the blocker.

Treat generated artifacts as outputs, not source, unless the project explicitly tracks them. Do not leave coverage reports, build output, temporary files, logs, local runtime state, cache files, smoke-test output, or machine-specific files in the repository unless they are intentionally tracked or ignored.

After validation, clean generated artifacts or ensure they are covered by the project’s ignore rules before handoff.

## Runtime, deployment, and configuration

Configuration should come from the appropriate environment, config files, secret stores, or deployment settings for the stack. Do not hardcode environment-specific values, credentials, machine paths, ports, generated IDs, or provider secrets into source.

Production-shaped runtime paths should fail clearly when required configuration is missing. Do not silently fall back to fake providers, local-only behavior, unsafe defaults, or ephemeral state in production paths unless the user explicitly requested that behavior.

When deployment artifacts exist, validate them when practical. A Dockerfile, compose file, deployment manifest, release script, health check, or CI file is stronger when it is exercised or connected to a repeatable validation path.

## Commits

Only create commits when the user or harness asks for commits.

Use conventional commit messages: `type(scope): subject`.

Include a commit body when the change has context worth preserving, such as the problem that motivated it, the approach chosen, important tradeoffs, migration notes, compatibility notes, or operational consequences. The commit message is for engineers reading the history later, not for the agent.

## Handoff

Before final handoff, run the relevant validation you can run from the current environment. If a relevant check cannot be run, state the concrete blocker.

Final responses should distinguish:

- what was changed;
- what was verified and passed;
- what failed, with actual relevant output;
- what could not be run and why;
- assumptions or remaining risks that matter to future work.

Do not claim success for commands, tests, integrations, deployments, or runtime behavior that were not actually observed.

## Host Configuration

{{HOST_CONFIG}}
