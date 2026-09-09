// Stable advisory instructions; execution resolution and model capabilities remain unchanged.
// Evidence and routing details: ../../README.md#model-routing-evidence.
export const SUBAGENT_MODEL_GUIDANCE = `Model selection:

- cliproxyapi/gpt-6-astra is the default for implementation, debugging, and planning. Use low or medium for most implementation tasks: low for well-scoped changes with clear requirements, medium when the task requires reasoning across several components. High is usually unnecessary for implementation; reserve it for unusually difficult root-cause analysis or complex architecture. Use Astra for code review only when the user explicitly requests it.

- cliproxyapi/gpt-5.6-luna or xai/grok-4.5 are the defaults for read-only codebase reconnaissance. Use medium to locate relevant files and symbols, trace call paths, map dependencies, find existing implementation patterns, and summarize how a component works. Give it a specific question and require file paths and supporting evidence. Use cliproxyapi/gpt-6-astra when the task requires choosing a design, diagnosing a difficult bug, or making changes. For routine code review, including ordinary correctness and security checks, use xai/grok-4.5.

- cliproxyapi/gpt-5.6-sol is an implementation fallback when cliproxyapi/gpt-6-astra cannot start because it is unavailable or rate-limited and substitution is allowed. Use low for a small, well-specified patch, medium for a bounded multi-file change, and high for complex implementation or debugging. Also use it when the user explicitly requests it.

- xai/grok-4.5 is the default for code review. Use medium for routine reviews. Give it the artifact and a specific review question; require evidence.

- Reserve xai/grok-4.6 for critical work or explicit user requests. Critical work has substantial consequences if wrong, such as exploitable security boundaries, irreversible data loss, or production-critical concurrency failures. A review involving correctness or security is not automatically critical. State the concrete risk that justifies escalation; otherwise use xai/grok-4.5 for review. Use medium for bounded critical reviews and high for complex critical investigations.

Honor explicit user choices and repository settings. Choose by the delegated task, not by the parent's model. A parent using cliproxyapi/gpt-6-astra may delegate implementation to another agent using the same model when their work does not overlap.

To select a model, supply provider and model together, and set effort explicitly. Omitted settings follow repository configuration, agent defaults, then the parent. Repository locks still apply. Check the effective settings returned by the tool.`;
