# Foundational Thinking

**Structural decisions** protect option value. **Code-level decisions** protect simplicity.

**Data structures first.** Get the data shape right before writing logic. Define core types early, trace every access pattern, and choose structures that match the dominant paths.

**Caller usage first.** Write the intended call or interaction before settling the interface. Derive types, signatures, and module boundaries from what the caller must accomplish. Keep coordination and representation choices behind the boundary instead of making every caller reconstruct them.

At code level, DRY the structure, not every line. Types and data models should converge. Three similar statements still beat a premature abstraction. Prefer explicit over clever. Test behavior and edge cases, not line counts.

**Architecture friction is evidence.** Repeated deviations of the same shape mean the foundation may be wrong: casts that bypass the model, optional fields that are always required in practice, callers coordinating internal stages, or unrelated cases needing the same workaround. One exception is not a pattern. When the pattern appears, revisit the caller usage and data shape instead of adding another escape hatch.

**Concurrency corollary.** Before sharing state between actors, ask "what happens if another actor modifies this concurrently?" If not "nothing", isolate.

**Scaffold first.** If something helps every later phase, do it first. Ask "does every subsequent phase benefit from this existing?" CI, linting, test infrastructure, and shared types are scaffold. Sequence for option value: setup before features, tests before fixes. Keep commits small and single-purpose.

Each increment should land a coherent abstraction or deepen one that exists. Do not spread a new capability across callers as special-case coordination.

Subtraction comes before scaffolding. Remove dead code first, then lay foundations.
