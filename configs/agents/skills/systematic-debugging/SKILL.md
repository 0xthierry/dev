---
name: systematic-debugging
description: "Use when investigating bugs, errors, crashes, test failures, regressions, or unexpected behavior before fixing."
effort: max
disable_model_invocation: true
disable-model-invocation: true
---

# Systematic Debugging

## Overview

Systematic debugging applies the scientific method to defect resolution. Instead of guessing and patching, you observe, hypothesize, test, and verify.

**Core principle:** Reproduction first, root cause analysis second, fix third. Never skip steps.

## Required Artifact: Debug Investigation Log

Create and maintain a single investigation document for each issue. This is mandatory.

- Recommended path: `ai_docs/debug/YYYY-MM-DD-short-issue-name.md`
- If user provides a different path, use that path instead
- Start the log before troubleshooting and update it after every experiment

Use `references/debug-investigation-template.md` as the default template.

Minimum logging requirements:
- Symptom, expected vs actual behavior, and scope
- Reproduction steps and repro rate
- Timestamped hypothesis and experiment entries
- Exact change tested and observed result
- Root cause statement with evidence
- Fix plan, rollback plan, and verification status

## Core Constraints

```
IRON LAW #1: NO FIX ATTEMPT WITHOUT REPRODUCTION FIRST
```

If you cannot reproduce the bug, you cannot:
- Verify you understand the triggering conditions
- Prove your fix works
- Create a regression test

**NEVER attempt a fix unless you have a defined reproduction (manual steps OR failing test).**

```
IRON LAW #2: NO FIX WITHOUT ROOT CAUSE ANALYSIS
```

Fixing where the error appears treats symptoms, not causes. The same bug will resurface differently.

**NEVER propose fixes before completing root cause investigation.**

```
IRON LAW #3: ONE CHANGE AT A TIME
```

Multiple simultaneous changes make it impossible to know which one worked (or which one broke something else).

**NEVER make multiple changes to test a hypothesis. One variable only.**

## Incident Mode (Production Outage)

For severe live incidents, prioritize mitigation first, then root cause:

1. Record severity, impact, and owner in the investigation log
2. Propose the smallest reversible mitigation that can restore service
3. State explicit rollback criteria before applying mitigation
4. Verify mitigation outcome with metrics/logs
5. Continue full Phase 1-4 process for permanent fix

Do not skip root cause because service is restored. A mitigation is not closure.

## When to Use

Use for ANY technical issue:
- Test failures
- Runtime errors or exceptions
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues
- "It works on my machine"
- Flaky/intermittent failures

**Use ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried a fix that didn't work
- You don't fully understand why the bug occurs
- Someone says "just add a null check" or similar band-aid

## When NOT to Use

Skip systematic debugging when:
- The "bug" is actually a missing feature (no expected behavior exists)
- Issue is purely cosmetic and the fix is a one-liner with zero side effects
- You're exploring/learning (not fixing production code)

**Even these should have verification after the fix.**

---

# The Process

## Phase 0: Open the Investigation Log (MANDATORY)

Create the log using `references/debug-investigation-template.md`.

Before any fix attempt, record:
- Environment and version/commit
- Exact symptom and impact
- Current hypothesis state (`none` at start)
- Initial evidence (logs/errors/trace IDs)

## Phase 1: Reproduction (MANDATORY)

**You MUST complete this phase before any investigation or fix attempt.**

### Step 1: Define Expected vs Actual Behavior

**WHY:** Without clear expected behavior, you cannot know if a fix works.

```
Expected: User submits form → success message appears
Actual: User submits form → 500 error appears
```

### Step 2: Create Reproduction

**WHY:** Reproduction is proof of understanding. No reproduction = guessing.

**Reproduction hierarchy (most to least valuable):**

| Type | Value | When to Use |
|------|-------|-------------|
| Automated test | Highest | Always prefer this |
| Script/command sequence | High | When test framework unavailable |
| Documented manual steps | Medium | UI-only bugs, integration issues |
| "I saw it once" | **UNACCEPTABLE** | Never - gather more data |

<good-example>
**Reproduction via failing test:**
```typescript
it('should not throw when user has no address', () => {
  const user = createUser({ address: null });
  expect(() => checkout(user)).not.toThrow();
});
```
This test FAILS before the fix, PASSES after. This IS the reproduction.
</good-example>

<good-example>
**Reproduction via documented steps:**
```
1. Login as user without saved address
2. Add item to cart
3. Click checkout
4. Observe: 500 error instead of address prompt
```
Reliable, repeatable, shareable.
</good-example>

<bad-example>
**No reproduction - guessing:**
"The checkout sometimes fails. Let me add a null check for the address field."

**Why bad:** No reproduction means:
- You don't know the actual trigger
- You can't verify the fix
- The bug will return
</bad-example>

### Step 3: Verify Reproduction is Consistent

**WHY:** Flaky reproduction means you don't understand all triggering conditions.

- Run the reproduction 3+ times
- If it fails inconsistently, you have a timing/state issue - investigate that first
- Document the exact conditions: environment, data state, sequence

---

## Phase 2: Root Cause Investigation

**Only after you have reliable reproduction.**

### Step 1: Read Error Messages Completely

**WHY:** Error messages often contain the solution. Most people skim and miss it.

- Read the ENTIRE stack trace, not just the first line
- Note line numbers, file paths, error codes
- Check for "caused by" chains - the root is often at the bottom

### Step 2: Ask "What Changed?"

**WHY:** Most bugs are caused by change. Find what changed.

```bash
git diff HEAD~5        # Recent code changes
git log --oneline -10  # Recent commits
```

Check:
- Code changes
- Dependency updates
- Configuration changes
- Environment differences
- Data changes

### Step 3: Trace Data Flow Backward

**WHY:** Bugs manifest deep in the stack but originate earlier. Fix at origin.

See `references/root-cause-tracing.md` for complete technique.

**Quick version:**
```
Error appears at: checkout.processPayment()
What called it with bad data? → checkout.submit()
What set that bad data? → cart.getTotal() returned null
Why null? → cart.items was undefined
Why undefined? → session.cart not initialized
ROOT CAUSE: Missing cart initialization in session setup
```

### Step 4: Gather Evidence (Multi-Component Systems)

**WHY:** In distributed systems, bugs cross component boundaries. Find WHERE it breaks.

**Add diagnostic logging at each boundary:**
```bash
# Layer 1: Entry point
echo "Request received: $PAYLOAD"

# Layer 2: Service
echo "Processing with data: $DATA"

# Layer 3: Database
echo "Query: $SQL, Result: $RESULT"
```

**Run once to gather evidence → Analyze → Identify failing component → Investigate that component.**

---

## Phase 3: Hypothesis and Testing

### Step 1: Form ONE Specific Hypothesis

**WHY:** Vague hypotheses can't be tested. Specific ones can be proven wrong.

<good-example>
"The cart.items array is undefined because sessionStorage.getItem returns null on first visit, and we don't handle that case in initCart()."

**Specific, testable, points to exact location.**
</good-example>

<bad-example>
"Something is wrong with the cart."

**Why bad:** Untestable. Too vague. Will lead to random changes.
</bad-example>

### Step 2: Predict Observable Outcome

**WHY:** Scientific method requires prediction before testing.

"If my hypothesis is correct, then adding `console.log(sessionStorage.getItem('cart'))` will show `null` on first visit."

### Step 3: Test Minimally (ONE Change)

**WHY:** Multiple changes conflate variables. You won't know which worked.

- Make the SMALLEST possible change to test your hypothesis
- ONE variable at a time
- Observe and compare to prediction

### Step 4: Verify or Iterate

**Hypothesis confirmed?** → Phase 4
**Hypothesis refuted?** → Form NEW hypothesis based on what you learned

**DON'T add more fixes on top of failed hypotheses.**

---

## Phase 4: Fix and Verify

### Step 1: Get User Approval

**WHY:** User may have context you lack. Alignment before implementation.

Present:
- What you found (root cause)
- Why it's the root cause (evidence)
- Proposed fix approach

**WAIT for explicit approval before making changes.**

In Incident Mode, emergency mitigation can be applied first if delay increases impact, but you still must:
- Document the mitigation decision and rollback plan
- Request approval for permanent corrective fix

### Step 2: Write Failing Test (If Not Already Present)

**WHY:** The test IS the reproduction. It proves the fix works.

```typescript
// This test MUST fail before your fix
it('handles null cart gracefully', () => {
  sessionStorage.clear();
  const cart = initCart();
  expect(cart.items).toEqual([]);
});
```

### Step 3: Implement ONE Fix

**WHY:** Fix the root cause, not the symptom. Minimal change reduces risk.

- Address the root cause identified
- ONE change at a time
- No "while I'm here" improvements
- No bundled refactoring

### Step 4: Verify Fix

- [ ] Reproduction no longer reproduces bug
- [ ] Failing test now passes
- [ ] No other tests broken
- [ ] Issue actually resolved in real environment

### Step 5: Consider Defense-in-Depth

After fixing the root cause, add validation at multiple layers.

See `references/defense-in-depth.md` for the four-layer pattern.

---

## Escalation Triggers

### After 2 Failed Hypotheses: Use Tree of Thought

When single-path debugging fails, explore multiple hypotheses in parallel.

See `references/tree-of-thought.md` for the Branch → Score → Prune → Deepen technique.

### After 3 Failed Fixes: Question Architecture

**Pattern indicating architectural problem:**
- Each fix reveals new issues in different places
- Fixes require "massive refactoring"
- Each fix creates new symptoms elsewhere

**STOP and discuss with your human partner:**
- Is this pattern fundamentally sound?
- Should we refactor instead of continuing to fix symptoms?

---

## Common Rationalizations

| Rationalization | Why It's WRONG | Required Action |
|-----------------|----------------|-----------------|
| "Let me just try this quick fix" | Guessing creates technical debt and masks root cause | **Find reproduction first** |
| "The error tells me exactly what to fix" | Errors show symptoms, not root causes. NPE location ≠ NPE origin | **Trace to root cause** |
| "I don't have time for a test" | No test = no proof fix works = will return | **Write the test** |
| "It only happens sometimes, let me retry" | Intermittent bugs are timing/state bugs - they get worse | **Investigate the inconsistency** |
| "I already know what's wrong" | Overconfidence is the #1 debugging trap | **Verify with reproduction first** |
| "Multiple fixes at once is more efficient" | Can't isolate what worked; may hide new bugs | **One change only** |
| "It works now, let me commit" | "Works now" without reproduction is luck, not science | **Verify against reproduction** |
| "This null check will prevent the error" | Band-aids hide bugs; invalid data propagates further next time | **Fix at the source** |

---

## Red Flags - STOP

If you notice yourself:
- Proposing a fix without reproduction steps
- Making multiple changes to "test something"
- Saying "let me just try..." without a hypothesis
- Skipping to the fix because it's "obvious"
- Re-running tests hoping they pass this time
- Adding null checks / try-catch without understanding why
- Feeling frustrated and wanting to "just make it work"

**All of these mean: STOP. Return to Phase 1. Get reproduction first.**

---

## Quick Reference

| Phase | Goal | Gate |
|-------|------|------|
| 0. Investigation Log | Single source of truth for debugging | Log created and initialized |
| 1. Reproduction | Reliable way to trigger bug | Can reproduce 3/3 times |
| 2. Root Cause | Understand WHY bug occurs | Can explain causal chain |
| 3. Hypothesis | Test specific theory | Prediction matched outcome |
| 4. Fix & Verify | Resolve and prove | Test passes, no regressions |

## Workflow Checklist

```
Debugging Progress:
- [ ] Phase 0: Investigation Log
  - [ ] Log file created
  - [ ] Symptom/scope/impact captured
  - [ ] Environment/version/commit captured
  - [ ] First evidence linked
- [ ] Phase 1: Reproduction
  - [ ] Expected vs actual defined
  - [ ] Reproduction created (test or documented steps)
  - [ ] Reproduction is consistent (3/3)
- [ ] Phase 2: Root Cause
  - [ ] Error message read completely
  - [ ] Recent changes checked
  - [ ] Data flow traced backward
  - [ ] Root cause identified (not symptom location)
- [ ] Phase 3: Hypothesis
  - [ ] Specific hypothesis formed
  - [ ] Prediction stated
  - [ ] Minimal test executed
  - [ ] Hypothesis confirmed
- [ ] Phase 4: Fix & Verify
  - [ ] User approval obtained
  - [ ] Failing test written
  - [ ] ONE fix implemented
  - [ ] Reproduction no longer fails
  - [ ] No regressions
```

---

## Relationship to TDD

Use TDD and systematic debugging together:
- TDD drives feature development and regression safety
- Systematic debugging finds root cause when behavior is already broken
- Load `skills/test-driven-development` when you need strict red/green/refactor guidance

If both apply: reproduce failure first, identify root cause, then encode prevention with tests.

## Bundled Resources

| Resource | When to Load | Why |
|----------|--------------|-----|
| `references/debug-investigation-template.md` | At the start of every debugging session | Standardized investigation record and experiment log |
| `references/root-cause-tracing.md` | When bug manifests deep in stack | Complete backward-tracing technique |
| `references/tree-of-thought.md` | After 2+ failed hypotheses | Multi-hypothesis parallel exploration |
| `references/defense-in-depth.md` | After fixing root cause | Four-layer validation pattern |
| `references/condition-based-waiting.md` | For timing/async bugs | Replace sleeps with condition polling |
| `references/find-polluter.sh` | When test pollution suspected | Bisect to find polluting test |

---

## Why Systematic Works

```
Guessing approach:   Unbounded thrashing, weak evidence, frequent regressions
Systematic approach: Bounded experiments, explicit evidence, durable fixes
```

**The difference is not intelligence. It is discipline.**

Systematic debugging feels slower initially but converges faster and produces durable fixes. Every action either narrows the search space or validates/invalidates a hypothesis. Random changes do neither.
