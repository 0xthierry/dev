# Resolve Facts Before Asking

When a question can be answered by inspecting, running, measuring, or prototyping, gather that evidence instead of asking the human to guess. Ask the human for intent, preference, scope, or authority that evidence cannot supply.

**Classify the fork before asking:**

- **Observable fact.** Repository structure, current behavior, output, timing, layout, compatibility, or whether an approach works. Inspect the source or run the smallest matching experiment.
- **Human decision.** Product direction, subjective preference, requirement interpretation, acceptable tradeoff, scope change, or permission for an action outside the assignment. Ask a focused question and name the options that evidence cannot choose between.
- **Blocked observation.** The fact is observable, but required access, credentials, infrastructure, or a safe control surface is unavailable. Report what you tried and ask only for the missing input or access.

Proceed with routine, reversible local choices that stay inside the established contract. Present the result and its evidence. Do not ask for approval merely because several implementation details are possible.

**Boundaries:**

- Ambiguity that changes user-visible behavior, compatibility, the requested outcome, or authority is a human decision. Do not silently resolve it as an implementation detail.
- This principle does not grant permission to publish, deploy, send external messages, change tickets, commit, push, delete data, or perform other actions outside the assignment.
- Irreversible or destructive actions require explicit authority. Silence is not approval.
- A prototype answers an empirical question; it does not choose a subjective preference for the human. When a novel design has several viable shapes, use [Exhaust the Design Space](exhaust-the-design-space.md).
