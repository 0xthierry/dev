# Integration

Wiring this codebase to an external or separate system. The risk is wrong assumptions about how that system behaves — so verify its behavior from its docs, don't recall the typical shape.

## Cover in the interview

Derive the actual questions from the task; these are the axes to make sure you hit, not a script.

- What it must do, and what triggers it.
- Expected volume, and how critical it is. This sizes everything below.
- Where it runs — one node or many. Decides in-memory vs distributed for anything stateful.
- How the external system authenticates / signs / delivers. **Verify from its docs.** What exactly does the signature cover — raw bytes, a canonical form, specific fields?
- Its failure and retry semantics: what does it treat as "stop retrying" vs "retry"?
- Can it deliver the same thing twice? (→ idempotency.) Can it silently drop or fail to deliver? (→ a recovery path that does not depend on the live channel.)
- Is a second provider real and contracted, or speculative? Speculative → no abstraction.

## Assert before writing — unconditional

These do not reliably surface from an interview even when you ask well; across testing, models skipped them even when handed an explicit decision list. Assert each. Carry it as an acceptance criterion tied to a seam, or an explicit, justified N/A.

- **Authenticity** — every inbound message is verified with that system's *actual* scheme (from its docs, not the common one). Unverified messages are rejected. Confirm what representation the signature covers (raw body / canonical form / specific fields).
- **Idempotency** — if the system can redeliver, processing is keyed on the event's stable id and a duplicate has no second effect. The idempotency record is durable — survives restart — not in-memory.
- **Missed-event recovery** — if the system can drop while you're down, there is a recovery path independent of the live channel: a replay/events API if one exists, otherwise scheduled polling of resource state. Confirm which exists before specifying it.
- **Unhandled-input tolerance** — inputs you don't handle (unknown types, unsubscribed kinds) return success and are ignored, not errored — otherwise the sender retries them forever.
- **Retry semantics** — your success/failure responses match what the sender treats as stop vs retry. Genuine processing failures signal retry; ignored or successful ones signal stop.
- **No unauthenticated mutation** — no endpoint other than the verified inbound channel mutates state without auth. Audit every route the change adds.
- **Right-sizing (forbid)** — no rate limiter, broker/queue, circuit breaker, cache, or multi-node coordination unless a stated constraint demands it. Single node + low volume → in-process and synchronous.
- **No speculative abstraction (forbid)** — no provider/strategy interface for a second implementation that isn't concretely contracted.

## Seams — where each assertion gets verified

Name the seam in the prompt; prefer an existing seam, choose the highest one possible, and confirm it with the user.

- Authenticity → at the inbound handler boundary: a bad/forged signature is rejected; a valid one whose raw bytes differ from the signed representation is accepted.
- Idempotency → at the dedup seam: deliver the same id twice → exactly one effect; persists across restart.
- Recovery → at the reconcile seam: an event the live channel never delivered is recovered.
- Unhandled-input + retry → at the handler: unknown type → success/ignored; genuine failure → the retry-triggering response.
