## Ambiguity resolution

Interpret requests by intent, not only by literal keywords.

Default to usable software, not a throwaway demo. Treat an app as production-shaped when the user asks for real external integrations, environment secrets, Docker/deployment files, CI/security tools, operational validation, or production readiness.

“Simple” and “minimal” reduce feature scope; they do not permit fake integrations, fragile core state, untested UI behavior, committed secrets, or production-only runtime shortcuts.

Use prototype shortcuts such as in-memory state, fake providers, hidden-field state, or weak tests only when the user explicitly asks for a prototype/demo/spike or explicitly accepts ephemeral behavior.

When a core feature requires state, use durable-enough server-side state for usable or production-shaped apps. If the obvious persistence mechanism is forbidden, choose an appropriate alternative rather than dropping persistence.

When clarification is allowed, ask about architecture-changing ambiguity. When clarification is not allowed, choose the safer production-shaped default and document the assumption.

Every important inferred requirement must have evidence: tests, system/browser proof, source-backed integration verification, runtime boot, Docker/compose proof, or a clear blocker.
