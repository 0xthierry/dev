---
name: asking-oracle
description: Use when facing complex analysis, architecture decisions, debugging that requires deep reasoning, or when you need senior-level code review. Use when uncertain about build-vs-buy, system design trade-offs, or need research synthesis. Triggers on "ask oracle", "get oracle opinion", multi-step reasoning problems.
disable_model_invocation: true
disable-model-invocation: true
---

# Asking Oracle

## Overview

Oracle is an independent second-opinion agent for deep analysis. Sessions can be **resumed for follow-up** — Oracle retains context from previous interactions within the same session.

## When to Use

Use when ANY of these apply:
- Senior-level code review needed (security, performance, architecture)
- Architecture trade-offs require deep analysis
- Complex debugging beyond surface symptoms
- Build-vs-buy decisions requiring committed recommendation
- Research synthesis across multiple domains
- Strategy decisions needing definitive verdict

## When NOT to Use

Skip Oracle when:
- Simple file lookups or codebase navigation
- Questions with obvious answers
- Tasks you can complete yourself with confidence
- Quick syntax questions or API lookups

## Modes

| Mode | When | System prompt loaded from |
|------|------|--------------------------|
| **Code** (default) | Reviews, architecture, debugging | `references/prompt-code.md` |
| **General** | Strategy, decisions, research | `references/prompt-general.md` |
| **Plan review** | Implementation plan review | `references/prompt-plan-review.md` |

## Invocation

Spawn the oracle sub-agent via Agent tool. **Do NOT invoke codex directly** — the oracle agent handles all codex interaction.

### New Session

```
Agent tool parameters:
  subagent_type: "oracle"
  description: "Oracle: <brief description>"
  prompt: |
    <query type: one of "code review", "architecture", "debugging", "strategy", "plan review", etc.>

    <your complete query with all context>

    Context files:
    - /absolute/path/to/file1
    - /absolute/path/to/file2
```

### Resume Session (Follow-Up)

When resuming a previous oracle session for follow-up analysis:

```
Agent tool parameters:
  subagent_type: "oracle"
  description: "Oracle: resume <brief description>"
  prompt: |
    Resume the oracle session.

    <what changed since last interaction>
    <your follow-up question or request>

    Context files (if new):
    - /absolute/path/to/new/file
```

**When to resume vs start new:**

| Situation | Action |
|-----------|--------|
| Follow-up on the same topic | Resume |
| Re-review after plan changes | Resume |
| Asking Oracle to reconsider | Resume |
| Completely different topic | New session |
| Different mode needed | New session |

## Steps

**Step 1: Identify query type**

- Code review, architecture, debugging → default (no flag needed in prompt)
- Strategy, decisions, build-vs-buy, research synthesis → mention "strategy" or "general" in prompt
- Plan review → mention "plan review" or include plan path

**Step 2: Resolve context file paths**

- Convert relative paths to absolute
- **Do NOT read files yourself** — Oracle reads them in its sandbox
- Pass paths in the prompt

**Step 3: Compose complete query**

Include in query:
- Specific question to answer
- Constraints or requirements
- What kind of output you need (verdict, code, analysis)

**Step 4: Spawn oracle sub-agent**

Use the Agent tool with `subagent_type: "oracle"`.

**Step 5: Critically evaluate the response**

See [Critical Evaluation](#critical-evaluation-of-oracle-output) below.

**Step 6: Return full response and report path**

- Return complete Oracle response
- Report the saved file path
- Inform the user: **"You can resume this Oracle session for follow-up analysis."**

## Critical Evaluation of Oracle Output

Oracle is powered by a different model with its own knowledge cutoffs and limitations. Treat Oracle as a **colleague, not an authority**.

### Guidelines

- **Trust your own knowledge** when confident. If Oracle claims something you know is incorrect, push back directly.
- **Research disagreements** using WebSearch or documentation before accepting Oracle's claims.
- **Remember knowledge cutoffs** — Oracle may not know about recent releases, APIs, or changes.
- **Don't defer blindly** — Oracle can be wrong. Evaluate suggestions critically, especially regarding:
  - Model names and capabilities
  - Recent library versions or API changes
  - Best practices that may have evolved

### When Oracle is Wrong

1. State your disagreement clearly to the user
2. Provide evidence (your own knowledge, web search, docs)
3. Optionally resume the Oracle session to discuss the disagreement:

```
Agent tool parameters:
  subagent_type: "oracle"
  description: "Oracle: resume - discuss disagreement"
  prompt: |
    Resume the oracle session.

    Following up on your previous analysis. I disagree with [X] because [evidence].
    What's your take on this?
```

4. Frame disagreements as discussions, not corrections — either AI could be wrong
5. Let the user decide how to proceed if there's genuine ambiguity

## Examples

<good-example>
**New Code Review:**
```
Agent(
  subagent_type="oracle",
  description="Oracle: review auth flow",
  prompt="Review authentication flow for security issues.\n\nContext files:\n- /home/thierry/project/src/auth/login.ts\n- /home/thierry/project/src/auth/session.ts"
)
```
</good-example>

<good-example>
**Resume for Follow-Up:**
```
Agent(
  subagent_type="oracle",
  description="Oracle: resume - clarify auth recommendation",
  prompt="Resume the oracle session.\n\nYour review recommended replacing the JWT strategy. Can you elaborate on the migration path? The current token format is used by 3 downstream services.\n\nContext files:\n- /home/thierry/project/src/auth/jwt.ts"
)
```
</good-example>

<good-example>
**Strategy Decision:**
```
Agent(
  subagent_type="oracle",
  description="Oracle: build vs buy auth",
  prompt="Strategy decision: Should we build vs buy authentication? 5-person startup, B2B SaaS, expect 500 users in 6 months. Need a committed recommendation with reasoning."
)
```
</good-example>

<bad-example>
```
Agent(
  subagent_type="oracle",
  description="Oracle: review",
  prompt="Review auth"
)
```
**Why bad:** Vague query, no context paths, no specifics
</bad-example>

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Reading files yourself | Pass paths in prompt; Oracle reads them in sandbox |
| Using default mode for strategy | Mention "strategy" or "general" in prompt |
| Vague query | Include constraints, context, desired output type |
| Summarizing response | Return complete response verbatim |
| Relative paths | Convert to absolute paths |
| Starting new session for follow-up | Resume the existing session instead |
| Accepting Oracle claims blindly | Critically evaluate, research disagreements |

## Common Rationalizations

| Rationalization | Why It's WRONG | Required Action |
|-----------------|----------------|-----------------|
| "I'll just give a quick answer" | Quick answers lose senior-level depth | **Return full response** |
| "File is small, I'll embed it" | Oracle reads files in sandbox | **Pass paths as arguments** |
| "I can answer this myself" | If Oracle was invoked, the depth is needed | **Run the query, then critically evaluate** |
| "Oracle is always right" | Oracle has knowledge cutoffs and can be wrong | **Evaluate critically, research disagreements** |
| "No need to mention resume" | User should know follow-up is possible | **Always inform about resume capability** |
