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
  repo. It then watches that inbox and injects each incoming message as a turn via
  `sendUserMessage`, so the worker's replies show up on their own.
- **Inherited `AM_ROOT` (a coop-exec worker, e.g. pi launched by another agent's
  `use-agent`):** it leaves the binding alone and does **not** watch — `amq wake`
  already pushes notifications there, and draining too would steal its messages.

Activation is lazy: nothing is created or watched until the session directory exists
(the `use-agent` skill makes it when it launches a worker), so plain pi stays
clutter-free in repos that never use the sidecar.

## Files

- `lib/session.ts` — resolve the AMQ binding (inherited vs. derived). Pure, tested.
- `lib/notice.ts` — format the injected notice; detect empty `amq monitor` output.
- `lib/register.ts` — set env, lazily watch the inbox, inject messages.

## Tests

```bash
bun test configs/agents/pi/extensions/amq-notify
```
