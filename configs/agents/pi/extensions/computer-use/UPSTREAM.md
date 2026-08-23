# Upstream provenance

- Repository: <https://github.com/tmustier/codex-computer-use-mcp>
- Release: `v0.5.0`
- Commit: `e90efa7bf83cd7a2a8b821c568bf20da4c894c12`
- License: MIT; see [`LICENSE`](./LICENSE)

## Copied source

| Upstream | Local |
|---|---|
| `src/audit.ts` | `lib/broker/audit.ts` |
| `src/tools.ts` | `lib/broker/tools.ts` |
| `src/direct-broker.ts` | `lib/broker/direct-broker.ts` |
| `src/direct-service.ts` | `lib/broker/direct-service.ts` |
| `src/session-executor.ts` | `lib/broker/session-executor.ts` |
| `src/code-executor.ts` | `lib/code/code-executor.ts` |
| `src/code-worker.ts` | `lib/code/code-worker.ts` |
| `integrations/pi/index.ts` | `lib/register.ts` and `lib/pi/*.ts` |

## Local adaptations

- Reorganized imports and Pi behavior around local extension boundaries.
- Replaced the package metadata version import with the static upstream version `0.5.0`.
- Load the editable colocated `code-worker.ts` directly instead of generated `dist/code-worker.js`.
- Keep worker creation as a protected method so local protocol tests can substitute a fake; production registration instantiates the unmodified base executor and always uses the fixed local worker.
- Gate runtime construction behind macOS host detection.
- Use the repository's TypeBox tool-schema pattern.
- Applied formatting and strict TypeScript narrowing without changing broker policy.

Updates require reviewing the upstream release and security diff before copying. Preserve fixed binary paths, OpenAI Team ID verification, isolated app-server state, model-turn rejection, process cleanup, audit redaction, worker isolation, and all execution/output bounds.
