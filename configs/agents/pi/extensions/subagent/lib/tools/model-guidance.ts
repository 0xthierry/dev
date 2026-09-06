// Stable advisory instructions; execution resolution and model capabilities remain unchanged.
// Evidence and routing details: ../../README.md#model-routing-evidence.
export const SUBAGENT_MODEL_GUIDANCE = `Model selection:

- cliproxyapi/gpt-6-astra is the default for implementation, debugging, planning, and review. Use low for well-scoped changes with clear requirements, medium when the task requires reasoning across several components, and high for difficult root-cause analysis, complex architecture, or security/concurrency review.

- cliproxyapi/gpt-5.6-luna is the default for read-only codebase reconnaissance. Use medium to locate relevant files and symbols, trace call paths, map dependencies, find existing implementation patterns, and summarize how a component works. Give it a specific question and require file paths and supporting evidence. Use cliproxyapi/gpt-6-astra when the task requires choosing a design, diagnosing a difficult bug, judging correctness, or making changes.

- cliproxyapi/gpt-5.6-sol is an implementation fallback when cliproxyapi/gpt-6-astra cannot start because it is unavailable or rate-limited and substitution is allowed. Use low for a small, well-specified patch, medium for a bounded multi-file change, and high for complex implementation or debugging. Also use it when the user explicitly requests it.

- xai/grok-4.6 is the preferred independent-provider reviewer. Use medium for bounded reviews and high for difficult debugging hypotheses or security/correctness review. Give it the artifact and a specific review question; require evidence. It can also perform implementation or research when explicitly selected.

Honor explicit user choices and repository settings. Choose by the delegated task, not by the parent's model. A parent using cliproxyapi/gpt-6-astra may delegate implementation to another agent using the same model when their work does not overlap.

To select a model, supply provider and model together, and set effort explicitly. Omitted settings follow repository configuration, agent defaults, then the parent. Repository locks still apply. Check the effective settings returned by the tool.`;
