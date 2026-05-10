# AGENTS.md

Apply higher-priority system, developer, tool, harness, user, and nearer repository instructions first. Treat this file as the strict global baseline. A repository-level `AGENTS.md`, `CLAUDE.md`, README, CI file, or local script may add more specific rules.

## Start Here

**Default: before implementing non-trivial work, identify the project operating profile.** Prefer the nearest repository instructions over these global defaults.

Look for:

- local agent instructions: `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, `.github/copilot-instructions.md`, or similar;
- package manager and lockfile: `package.json`, `bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `Gemfile`, etc.;
- build, test, lint, typecheck, format, dev-server, release, and health-check commands;
- framework/runtime conventions, test helpers, fixtures, generated-code workflows, deployment files, and CI definitions;
- the codebase map: source directories, test directories, generated files, vendored code, scripts, and docs.

**CRITICAL**: Before editing in a git repository, inspect the worktree. Do not overwrite, reformat, move, stage, commit, or revert unrelated user changes.

**CRITICAL**: Do not assume commands from another ecosystem or repository apply here. Use the project-local toolchain, wrappers, scripts, and runtime unless the repository explicitly says otherwise.

**Default: read the whole relevant file before relying on it.** If output is truncated, continue reading until the relevant content is complete. When a file references links, imports, schemas, templates, examples, generated sources, or related docs that affect the task, inspect them too.

## Commands, Builds, and Runtime

- **Default: run the relevant command yourself when it is available in the current environment.** Do not offload execution to the user unless credentials, interactive authentication, permissions, missing tools, or inaccessible infrastructure block you.
- **CRITICAL**: Long-running builds, tests, and checks are allowed. Do not skip a relevant check only because it may take time. Use a generous timeout when appropriate; if the project says a command must not be timed, do not set a timeout.
- Prefer project-local commands: package scripts, `make`, `just`, `task`, `go test`, `cargo test`, `cargo xtask`, repo wrappers, or documented scripts.
- A validation run does not count if it uses the wrong runtime, a globally installed binary when the project requires a local build, stale build output, unrelated tests, or a mocked production path that bypasses the changed code.

## Testing

**Default: all behavior changes get tests.** If you are not testing the behavior you changed, you are not done.

**Default: add or update tests next to existing coverage for the code you changed.** Do not create a new test file when an existing nearby file already covers that component or behavior.

**Exception:** create a new test file only when the project pattern expects it, no suitable file exists, or the new behavior spans a genuinely new test area.

### Changes that may not require runtime tests

Docs-only, comments-only, spelling, formatting-only, or non-executable text changes may skip runtime tests.

**Exception:** if docs contain executable examples, generated docs, checked snapshots, API contracts, config, or behavior claims, run the relevant doc/example/generation validation.

### Writing Tests

- Use the project's existing test helpers, fixtures, factories, harnesses, snapshot normalizers, and temporary-directory helpers.
- Prefer deterministic assertions over broad “does not crash/panic/error” checks that cannot fail usefully.
- **CRITICAL**: Do not write flaky tests. Do not use sleeps, fixed delays, or `setTimeout` as synchronization unless timing itself is the behavior under test. Await the condition instead.
- Assert useful output before final success/exit-code assertions when that gives better failure messages.
- Keep tests focused, but ensure they exercise the real changed path.

### Validating Tests

- **CRITICAL**: A test is NOT VALID if it passes without exercising your change.
- **CRITICAL**: A test is NOT VALID if it only passes because it uses stale artifacts, global tools, local-only state, hidden network access, or fake production behavior.
- When fixing a bug, prefer this sequence: write or update the narrowest regression test, confirm it fails for the expected reason when practical, implement the fix, rerun the regression test, then run broader relevant validation.
- Run the relevant check unless a concrete blocker exists. If blocked, report the exact command and blocker.

## Code Review Self-Check

- Before writing code that makes a non-obvious choice, pre-emptively ask "why this and not the alternative?" If you can't answer, research until you can — don't write first and justify later.
- Don't take a bug report's suggested fix at face value; verify it's the right layer.
If neighboring code does something differently than you're about to, find out why before deviating — its choices are often load-bearing, not stylistic.

## Production, State, External Systems, and Secrets

**Default: build usable software, not a throwaway demo.** When the task mentions real users, deployment, Docker, CI, secrets, payments, auth, external services, databases, queues, providers, or production readiness, treat it as production-shaped.

**Exception:** prototype shortcuts such as in-memory state, fake providers, hidden-field state, weak tests, or local-only behavior are allowed only when the user explicitly asks for a prototype/demo/spike or explicitly accepts the limitation.

- When core behavior needs state, use storage that matches the implied runtime. Do not silently store core production state only in process memory, unbounded client/session payloads, unlocked local files, or other single-process shortcuts.
- If local/file-backed storage is appropriate, handle and document relevant limits: concurrency, locking, corruption, backups, restart behavior, container paths, permissions, and multi-instance deployment.
- Before relying on credentials, tokens, external services, project IDs, provider models, generated IDs, or external data, verify the environment is configured when possible.
- If credentials or services are unavailable, build the real environment-driven path when safe and record the live-validation blocker. Do not invent placeholders, fake production data, mock provider behavior, or alternate production code paths.
- Mocks, stubs, and fakes are useful test support. They do not prove a production integration contract is valid.
- For real external integrations, add a named gated smoke or contract-validation entrypoint when practical. It must run only with required credentials and an explicit enable flag, redact secrets, and report a concrete pass/fail/blocker result.
- **CRITICAL**: Never print, persist, copy, commit, or expose secret values. Redact secrets from logs, reports, command output, screenshots, generated files, docs, Docker files, CI files, and final responses.
- Configuration should come from the appropriate environment, config files, secret stores, or deployment settings for the stack. Do not hardcode environment-specific values, credentials, machine paths, ports, generated IDs, or provider secrets into source.
- Production-shaped runtime paths should fail clearly when required configuration is missing. Do not silently fall back to fake providers, unsafe defaults, or ephemeral state.

## Dependencies and Generated Files

- **CRITICAL**: Do not edit generated lockfiles directly, including `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `uv.lock`, `Gemfile.lock`, and similar files. Change dependencies through the package manager or generator command and let the tool regenerate the lockfile.
- Treat generated artifacts as outputs, not source, unless the project explicitly tracks and reviews them.
- Default to editing the source-of-generation and running codegen. If generated files are intentionally committed, update them with the repository's documented generator.
- Do not leave coverage reports, build output, temporary files, logs, local runtime state, cache files, smoke-test output, or machine-specific files in the repository unless they are intentionally tracked or ignored.

## CI, PRs, and Review Feedback

- **Default: use the repository's own CI, PR, and failure-inspection scripts first.** They often encode project-specific filtering, annotations, and known provider quirks.
- If CI output, PR comments, or review state look incomplete or misleading, inspect the underlying provider data instead of working around the symptom.
- For GitHub, `gh pr view --comments` is only a partial view: it can omit review summaries and line-level review comments. When responding to reviews, inspect issue comments, reviews, and pull-request review comments, or use the repository's wrapper if one exists.
- Do not mark review feedback addressed until the relevant code, tests, and comments have actually been handled.

## Debugging Failures

- Do not confuse the first visible failure with the root cause. For data bugs, trace the bad value to the earliest point where it became incorrect, reinterpreted, overwritten, lost, exposed, or persisted incorrectly.
- When a command or test fails, preserve the exact command and the actual relevant output. Do not rewrite or paraphrase errors as if they were exact. Redact only secrets.
- If a project tool's output is wrong because the tool/parser is stale or buggy, prefer fixing the tool when it is in scope rather than adding local workarounds.

## Commits

**Default: commit completed code changes automatically after relevant validation.**

**Exception:** do not commit automatically when the user says not to, the repository/harness forbids commits, unrelated worktree changes cannot be separated safely, validation is blocked in a way that makes the commit misleading, or the task is purely exploratory.

- Use semantic/conventional commit messages: `type(scope): subject`.
- Include a commit body when context matters: problem, approach, tradeoffs, migration notes, compatibility notes, operational consequences, and validation performed.
- **CRITICAL**: Never commit secrets, local credentials, build artifacts, logs, caches, temporary files, or unrelated user changes.
- Do not push, force-push, tag, release, or rewrite history unless the user explicitly asks.

## Handoff

Before final handoff, run the relevant validation you can run from the current environment.

Final responses should distinguish:

- what changed;
- what was verified and passed;
- what failed, with actual relevant output;
- what could not be run and why;
- commits created, if any;
- assumptions or remaining risks that matter to future work.

Do not claim success for commands, tests, integrations, deployments, external systems, or runtime behavior that were not actually observed.

## Important Development Notes

1. **Use the project-local toolchain.** Wrong runtime, package manager, or stale build output makes validation invalid.
2. **All behavior changes must be tested.** If you did not run the relevant tests, the code is not proven.
3. **Tests belong beside existing coverage by default.** Do not create scattered new files without a reason.
4. **Do not write flaky tests.** Await conditions instead of sleeping.
5. **Do not fake production integrations.** Missing credentials are blockers, not permission to invent behavior.
6. **Do not edit lockfiles or generated files directly.** Use the package manager or generator.
7. **Do not touch unrelated user changes.** Inspect the worktree before editing and before committing.
8. **Commit completed validated work using semantic commits.** Include a useful body when context matters.
9. **Be humble and honest.** Never overstate what works, what passed, or what was verified.

## Host Configuration

{{HOST_CONFIG}}
