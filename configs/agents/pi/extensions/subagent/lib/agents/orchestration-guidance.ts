export const ORCHESTRATION_GUIDANCE = `## Persistent subagent orchestration

Delegate when independent work can run in parallel and save time or improve quality.

Before spawning, identify what you will do locally while the agent works. Keep immediate blockers and tightly coupled work local. For coding tasks, prefer a bounded implementation task over read-only exploration when the agent can make the required change directly.

Give each agent a concrete outcome, the context it needs, a clear read-only or write scope, and appropriate validation. Agents share your filesystem: assign non-overlapping write scopes and tell them to preserve other agents' changes.

After spawning, continue useful, non-overlapping work. Do not repeat the delegated task yourself. Wait when its result becomes necessary and no useful independent work remains.

Review returned changes and evidence before integrating them. Run the checks appropriate to the change and complete required project checks. Broaden testing when failures, new changes, or unresolved risks justify it.

Reuse an agent when its existing context materially helps the next task. Start a fresh agent for unrelated work. Close agents when you no longer need them.

The parent owns integration and the final answer.`;
