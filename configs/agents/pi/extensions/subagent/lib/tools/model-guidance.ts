// Stable routing instructions; GPT-5.6 Terra effort is enforced by the execution runtime.
// Evidence and routing details: ../../README.md#model-routing-evidence.
export const SUBAGENT_MODEL_GUIDANCE = `Model selection:

Choose a named agent that fits the task first. Unless the user or assignment needs an override, omit execution and use repository settings and the agent's declared model and effort. The general recommendations below apply when no named profile fits or when choosing a deliberate override; they do not replace matching named-agent defaults.

- cliproxyapi/gpt-6-sol is the default for implementation and debugging at high effort.

- cliproxyapi/gpt-6-astra is the default for planning. Use high effort for planning and design decisions. Use Astra for code review only when the user explicitly requests it.

- cliproxyapi/gpt-6-luna is the default for read-only codebase reconnaissance at xhigh effort. Use it to locate relevant files and symbols, trace call paths, map dependencies, find existing implementation patterns, and summarize how a component works. Require file paths and supporting evidence.

Use cliproxyapi/gpt-6-sol at high effort when the task requires diagnosing a bug or making changes; use cliproxyapi/gpt-6-astra with high effort for planning and design decisions. For routine code review, including ordinary correctness and security checks, use cliproxyapi/gpt-6-luna at xhigh effort.

- cliproxyapi/gpt-6-luna is the default for code review at xhigh effort. Give it the artifact and a specific review question; require evidence.

Honor explicit user choices and repository settings. Choose by the delegated task, not by the parent's model. A parent using cliproxyapi/gpt-6-astra should delegate implementation and debugging to cliproxyapi/gpt-6-sol at high effort with non-overlapping ownership.

Prefer a named agent whose file defaults match the assignment, and omit execution so those defaults can apply. Set execution only when the user or the concrete assignment requests an override. For a model override, supply provider and model together; effort normally resolves independently unless a runtime model policy fixes the effective level. Omitted settings follow repository configuration, agent defaults, then the parent. Repository model locks and non-policy effort locks still apply. Check the effective settings returned by the tool.`;
