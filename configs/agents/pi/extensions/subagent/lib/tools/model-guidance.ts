// Stable routing instructions; GPT-5.6 Terra effort is enforced by the execution runtime.
// Evidence and routing details: ../../README.md#model-routing-evidence.
export const SUBAGENT_MODEL_GUIDANCE = `Model and reasoning selection:

Choose a named agent for its role and instructions, then choose execution settings for the concrete assignment. Repo-managed agent profiles do not pin a model or effort. Do not infer reasoning effort from the agent name, the parent's effort, or read-only versus write access alone.

Model guidance:
- Prefer cliproxyapi/gpt-6.1-sol for read-only codebase reconnaissance: locating files, tracing call paths, mapping dependencies, finding patterns, and explaining existing code. Require file paths and supporting evidence.
- Prefer cliproxyapi/gpt-6-astra for implementation, debugging, planning, design decisions, and code review. Give reviewers an artifact and a specific review question; require evidence.

Choose reasoning effort by difficulty, uncertainty, and consequences of a wrong answer:
- low: a narrow lookup, a straightforward code explanation, or a small change with a clear pattern and direct verification.
- medium: several connected files, moderate branching, or a bounded implementation or investigation requiring comparison of alternatives.
- high: ambiguous behavior, complex cross-component reasoning, difficult debugging, or consequential design and correctness decisions.
- xhigh: exceptionally difficult or high-risk work with unresolved interacting constraints; not a default for reconnaissance or review.

Use the lowest effort adequate for the assignment. Read-only analysis can require high effort when the code or question is difficult; writing code does not automatically require high effort. Increase effort when investigation reveals deeper uncertainty or complexity, not merely because an agent is an analyzer or reviewer. State a brief task-specific reason when selecting high or xhigh.

Pass the chosen effort in execution when spawning; use agent_followup with execution to change it for a later task. For a model override, supply provider and model together. Omitted settings inherit repository configuration, any external agent defaults, then the parent; omission does not dynamically choose effort. Honor explicit user choices and repository locks. Model-specific runtime policies can override the requested effort, so inspect the effective settings returned by the tool. Assign non-overlapping ownership for parallel implementation.`;
