# amq-notify

Makes a **pi main** session get notified of AMQ messages without polling, so the
[`use-agent`](../../skills/use-agent) sidecar flow works when you just run `pi`.

## What it does

On startup the extension binds the pi process to an AMQ session and sets `AM_ROOT`
and `AM_ME` in `process.env`. Because an extension's env mutation reaches pi's bash
tool, every `amq` command pi runs — including the `use-agent` launch script — then
inherits the same session with no prefixing.

- **Unset `AM_ROOT` (plain `pi`, the main):** it mints a unique session per process,
  `.agent-mail/pi-<id>`, so multiple pis with their own sidecars stay isolated in one
  repo. It then peeks that inbox and injects each incoming message as a turn via
  `sendUserMessage`, so the worker's replies show up on their own. Messages are only
  acknowledged after the turn is queued, so a failed injection leaves them available
  for the next pass instead of silently dropping them.
- **Inherited `AM_ROOT` (a coop-exec worker, e.g. pi launched by another agent's
  `use-agent`):** it leaves the binding alone and does **not** watch — `amq wake`
  already pushes notifications there, and draining too would steal its messages.

Activation is lazy: nothing is created or watched until the session directory exists
(the `use-agent` skill makes it when it launches a worker), so plain pi stays
clutter-free in repos that never use the sidecar.

## Files

- `lib/binding.ts` — resolve and persist the AMQ binding across reload/resume.
- `lib/monitor.ts` — parse `amq monitor --peek --json` output and format notices.
- `lib/notice.ts` — wrap the injected notice with handling guidance.
- `lib/register.ts` — set env, lazily watch the inbox, inject messages, acknowledge delivery.

## Tests

```bash
bun test configs/agents/pi/extensions/amq-notify
```
