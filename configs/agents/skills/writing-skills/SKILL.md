---
name: writing-skills
description: "Use when creating, editing, reviewing, or testing coding-agent SKILL.md files, especially when reusable behavior should apply across repositories, tools, workflows, or agent sessions."
effort: max
disable_model_invocation: true
---

# Writing Skills

## Goal

Create coding-agent skills that make a future agent do the right thing at the right time with minimal extra context.

A good skill is not a story, checklist dump, or human onboarding guide. It is a compact operating manual for an agent that may load it mid-task, use tools, edit files, validate work, and report evidence.

## Success Criteria

A skill is ready when it is:

- **Discoverable:** the name and description trigger on the right user requests, symptoms, files, tools, or workflows.
- **Actionable:** the body tells an agent what outcome to produce, what constraints matter, what evidence to inspect, and how to stop.
- **Efficient:** common guidance is inline; heavy details move to references, scripts, or existing tool help.
- **Verifiable:** important behavior has scenario tests, validation commands, or a clear reason validation cannot run.
- **Agent-neutral by default:** use coding-agent language unless the skill truly targets one runtime, model, or CLI.
- **Repository-shaped:** follows the local skill format, naming conventions, install behavior, and available tools.

## When to Create or Edit a Skill

Create or edit a skill when reusable agent behavior is missing, unreliable, or too expensive to rediscover each time.

Good triggers:

- A workflow should be reused across projects or sessions.
- Agents repeatedly miss a tool, command, convention, validation step, or stopping condition.
- A specialized API, CLI, file format, or system needs compact operational guidance.
- A discipline matters under pressure, such as testing before claiming success or not exposing secrets.
- The user asks to create, rewrite, tighten, split, or test a skill.

Skip a skill when:

- The information belongs in project docs, `AGENTS.md`, or local setup instructions.
- A script, lint rule, test, or pre-commit hook can enforce the behavior better than prose.
- The content is a one-off solution, transcript, postmortem, or narrative history.
- The agent already has enough general knowledge and no local/tool-specific behavior changes.

## Skill Shapes

Choose the smallest shape that fits the outcome.

| Shape | Use for | Include |
| --- | --- | --- |
| **Discipline** | Behavior that must hold under pressure | invariant rules, rationalizations, red flags, verification |
| **Workflow** | Multi-step coding-agent tasks | goal, decision rules, tool/evidence budget, validation loop |
| **Reference** | CLI/API/file-format usage | commands, examples, when to read references, failure handling |
| **Pattern** | Reusable way to recognize or solve a class of problems | recognition cues, counterexamples, before/after examples |

Avoid turning every skill into a rigid process. Use absolute language only for true invariants: safety, secrets, destructive actions, required output fields, or validation claims.

## Frontmatter

Use the target runtime's supported frontmatter. Keep it small and trigger-focused.

```yaml
---
name: lower-hyphen-name
description: "Use when [specific trigger, symptom, tool, file type, or workflow]."
---
```

Guidelines:

- `name`: lowercase words separated by hyphens; choose the action or core capability, not a vague category.
- `description`: describe **when to load the skill**, not the skill's internal workflow.
- Start descriptions with `Use when...` unless the local ecosystem uses a different convention.
- Mention concrete triggers: commands, tools, file types, error text, symptoms, integrations, or workflows.
- Do not pack a procedure into the description; agents may shortcut from metadata and skip the body.
- Keep extra metadata only when this repository or runtime actually uses it, such as allowed tools or model-invocation controls.

## Recommended Structure

Use this as a default, then remove sections that do not change behavior.

```markdown
# Skill Title

## Goal
What outcome should the agent produce?

## When to Use
Concrete triggers and symptoms.

## When Not to Use
Boundaries and counterexamples.

## Success Criteria
What must be true before final response or handoff?

## Operating Rules
Only true invariants and important constraints.

## Workflow
Outcome-first steps, decision rules, retrieval/tool budget, and stopping conditions.

## Validation
Commands, scenario checks, smoke tests, or evidence requirements.

## Output
Expected final response, artifact, patch, report, or handoff shape.

## Common Mistakes
Likely failure modes and how to avoid them.

## Resources
When to read references, run scripts, or use assets.
```

## Writing Rules for Coding-Agent Skills

### Lead with the outcome

Tell the agent what good looks like before telling it how to work.

Prefer:

```markdown
Resolve the bug to the root cause and leave executable evidence that the fix works.
```

Avoid:

```markdown
First inspect A, then inspect B, then think through every possible cause, then...
```

### Use decision rules instead of ritual

For judgment calls, describe when to continue, stop, ask, or fall back.

```markdown
Read more files only when the current evidence does not explain the behavior, a public API is unclear, or a validation failure points to another component.
```

Use `must`, `never`, and `always` for invariants, not preferences.

### Include a retrieval and tool budget

Skills for coding agents should prevent both under-inspection and endless spelunking.

```markdown
Start with the smallest evidence set likely to answer the question: relevant file, nearby tests, and project docs. Expand search only when the first pass leaves a material unknown, a command fails unexpectedly, or a referenced API/config is not defined.
```

### Make validation part of the skill

State the repeatable checks that prove the behavior.

```markdown
After changes, run the narrowest useful validation first: targeted test, typecheck, lint, build, smoke test, or parser check. If validation cannot run, record the exact blocker and the next best check.
```

Do not let a skill teach agents to claim success from source inspection alone when executable validation is practical.

### Keep formatting light

Use headers, bullets, tables, and examples when they improve scanning. Avoid decorative structure, long preambles, and repeated rules.

One strong example is usually better than many shallow examples.

### Preserve uncertainty

Tell agents how to handle missing evidence.

```markdown
If required configuration, credentials, target files, or external systems are unavailable, implement only the safe environment-driven path and report the live-validation blocker. Do not invent fake production behavior.
```

## Progressive Disclosure

Keep `SKILL.md` focused. Add supporting resources only when they reduce context or improve reliability.

| Resource | Use when | Rule |
| --- | --- | --- |
| `references/` | Large docs, schemas, API notes, examples | Say exactly when to read each file. |
| `scripts/` | Repeatable checks, transforms, generators | Prefer deterministic scripts over prose for fragile work. |
| `assets/` | Templates or files copied into outputs | Do not load into context unless needed. |

Do not create human-maintenance clutter such as `README.md`, `CHANGELOG.md`, or `INSTALLATION_GUIDE.md` inside a skill unless the local skill runtime explicitly requires it.

## Testing and Review

Use enough testing to prove the behavior changed. Baseline testing is valuable for new or high-risk behavioral skills, but small metadata or wording edits may only need static validation and targeted scenario review.

Recommended checks:

1. **Static validity:** frontmatter parses; file paths and referenced resources exist; commands are current.
2. **Activation scenario:** a realistic user request should trigger this skill from its description.
3. **Non-activation scenario:** an adjacent request should not trigger it.
4. **Application scenario:** with the skill loaded, an agent can complete the intended workflow or produce the intended artifact.
5. **Pressure scenario:** for discipline skills, test likely rationalizations such as time pressure, sunk cost, authority, missing credentials, or partial validation.
6. **Regression check:** if editing an existing skill, verify the original important behavior still works unless intentionally changed.

When possible, run repeatable checks from the repository. Example static check:

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
for path in Path('configs/agents/skills').glob('*/SKILL.md'):
    text = path.read_text()
    assert text.startswith('---\n'), path
    yaml.safe_load(text.split('---', 2)[1])
print('skill frontmatter parsed')
PY
```

## Common Mistakes

| Mistake | Why it hurts | Fix |
| --- | --- | --- |
| Description summarizes the workflow | Agents may follow metadata and skip the body | Make the description trigger-only. |
| Skill reads like a blog post | Agents need operational guidance, not history | Replace narrative with goals, rules, examples, validation. |
| Too many absolute rules | The agent becomes mechanical or fights the task | Reserve absolutes for invariants. |
| No stopping condition | Agents over-search or under-validate | Add retrieval budget and done criteria. |
| No validation path | Future agents cannot prove the skill works | Add scenario tests, commands, or explicit blockers. |
| Runtime-specific assumptions | Skill fails in other coding agents | Name target runtimes explicitly or write agent-neutral instructions. |
| Repeating tool docs inline | Wastes context and drifts stale | Link to `--help`, references, or source docs with when-to-read guidance. |

## Final Handoff for Skill Work

When finished, report:

- changed skill files and supporting resources;
- validation run and pass/fail result;
- scenario coverage, if tested;
- anything not validated and why;
- assumptions that matter for future agents.
