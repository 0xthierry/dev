// Stable advisory instructions; execution resolution and model capabilities remain unchanged.
// Evidence and routing details: ../../README.md#model-routing-evidence.
export const SUBAGENT_MODEL_GUIDANCE = `Model selection:

Choose a named agent that fits the task first. Unless the user or assignment needs an override, omit execution and use repository settings and the agent's declared model and effort. The general recommendations below apply when no named profile fits or when choosing a deliberate override; they do not replace matching named-agent defaults.

- cliproxyapi/gpt-5.6-sol is the default for implementation and debugging. Use low for a small, well-specified patch, medium for a bounded multi-file change, and high for complex implementation or debugging.

- cliproxyapi/gpt-6-astra is the default for planning. Use high effort for planning and design decisions. Use Astra for code review only when the user explicitly requests it.

- cliproxyapi/gpt-5.6-luna or xai/grok-4.5 are the defaults for read-only codebase reconnaissance. Use medium to locate relevant files and symbols, trace call paths, map dependencies, find existing implementation patterns, and summarize how a component works. Give it a specific question and require file paths and supporting evidence. Use cliproxyapi/gpt-5.6-sol when the task requires diagnosing a bug or making changes; use cliproxyapi/gpt-6-astra with high effort for planning and design decisions. For routine code review, including ordinary correctness and security checks, use xai/grok-4.5.

- xai/grok-4.5 is the default for code review. Use medium for routine reviews. Give it the artifact and a specific review question; require evidence.

Honor explicit user choices and repository settings. Choose by the delegated task, not by the parent's model. A parent using cliproxyapi/gpt-6-astra should delegate implementation and debugging to cliproxyapi/gpt-5.6-sol with non-overlapping ownership.

Prefer a named agent whose file defaults match the assignment, and omit execution so those defaults can apply. Set execution only when the user or the concrete assignment requests an override. For a model override, supply provider and model together; effort may be overridden independently. Omitted settings follow repository configuration, agent defaults, then the parent. Repository locks still apply. Check the effective settings returned by the tool.`;
