# Tree of Thought for Complex Bugs

**When to use:** After 2+ failed hypotheses, or when the bug could have multiple independent causes.

Standard debugging follows one path at a time. Tree of Thought (ToT) explores **multiple hypotheses in parallel**, evaluates each, and prunes dead ends early.

## When ToT Beats Single-Path

| Scenario | Single-Path | Tree of Thought |
|----------|-------------|-----------------|
| Simple bug, clear cause | Faster | Overkill |
| Complex bug, unclear cause | Tunnel vision risk | Explores alternatives |
| 2+ failed fixes | Keep retrying same area | Forces broader search |
| Multi-factor bug | Miss interactions | Tests combinations |

## The ToT Structure

```
                     [Bug Symptom]
                    /      |      \
           [Hyp A]      [Hyp B]      [Hyp C]
           /    \          |            \
       [A1]    [A2]      [B1]          [C1]
        ✗       ↓         ✗             ↓
             [A2a]                   [C1a] ← Root cause found
```

## ToT Debugging Workflow

**Step 1: Branch — Generate 3 hypotheses minimum**

After Phase 1 evidence gathering, instead of forming ONE hypothesis:

```
Evidence: API returns 500 on user save

Hypothesis A: Database constraint violation
Hypothesis B: Validation middleware rejecting payload
Hypothesis C: Downstream service timeout
```

**Step 2: Score — Quick-test each branch (1-2 minutes max)**

| Hypothesis | Quick Test | Result | Score |
|------------|------------|--------|-------|
| A: DB constraint | Check DB logs | No constraint errors | ✗ Prune |
| B: Validation | Log middleware input/output | Payload passes | ✗ Prune |
| C: Downstream timeout | Check service health | 503 errors in logs | ✓ Pursue |

**Step 3: Prune — Abandon low-score branches immediately**

Don't deep-dive branches that quick-test negative. Move on.

**Step 4: Deepen — Explore promising branch**

Now apply standard Phase 3-4 to the surviving hypothesis.

**Step 5: Backtrack — If deepening fails, return to Step 1**

Generate NEW hypotheses informed by what you learned:

```
Hypothesis C failed (timeout was symptom, not cause)
New hypotheses:
  D: Network partition between services
  E: Resource exhaustion on downstream host
  F: Configuration drift after deploy
```

## ToT Checklist

```
Tree of Thought Progress:
- [ ] Generated 3+ hypotheses from evidence
- [ ] Quick-tested each (< 2 min per branch)
- [ ] Scored and pruned non-viable branches
- [ ] Deep-dived most promising branch
- [ ] If failed: generated new hypotheses (not retried same ones)
```

## Example: Authentication Bug

**Symptom:** Users randomly logged out

**Branch generation:**
```
A: Session expiry misconfigured
B: Load balancer not sharing sessions
C: Token refresh race condition
D: Redis session store eviction
```

**Quick-test results:**
```
A: Checked config → 24h expiry, correct → ✗ Prune
B: Checked LB config → sticky sessions enabled → ✗ Prune
C: Added logging → no race detected → ✗ Prune
D: Checked Redis → maxmemory-policy = allkeys-lru 🚨 → ✓ Pursue
```

**Root cause:** Redis evicting sessions under memory pressure. Single-path debugging might have spent hours on A before checking D.

## When NOT to Use ToT

- **Bug is already clear** — Don't branch for the sake of branching
- **First hypothesis** — Try single-path first; ToT is for when you're stuck
- **Simple reproduction** — If you can reproduce in 1 step, just trace it

## Integration with Standard Process

```
Phase 1: Gather evidence
    ↓
Phase 2: Pattern analysis
    ↓
Phase 3: Form hypothesis → Test → Pass? → Phase 4
                             ↓
                           Fail?
                             ↓
                    Failed 2+ times?
                    /            \
                  No              Yes
                   ↓               ↓
            New hypothesis    Switch to ToT
                               ↓
                         Branch → Score → Prune → Deepen
                               ↓
                         All branches failed?
                               ↓
                         Question architecture
```
