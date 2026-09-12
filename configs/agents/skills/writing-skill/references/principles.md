# Write a principle or correction

Use a principle for a decision that recurs across tasks. Use a small correction for one narrow change in behavior. Neither needs a full workflow by default.

## State the decision

Open with the rule and the situation in which it applies. A principle should help the agent choose between plausible actions, not announce a virtue.

Weak:

> Prioritize simplicity and maintainability.

More useful:

> Before adding a wrapper, identify the decision it hides from callers. If it only forwards the same arguments, keep the direct call unless the boundary has another concrete purpose.

The second version supplies a trigger, a test, and an exception. It can change a design decision.

## Explain only what helps application

A short rationale is useful when the rule is counterintuitive or could be applied too broadly. Explain the consequence, not the importance of the principle.

For example, duplicating a decision across modules requires coordinated changes. That explains why concentrating the decision can help. Saying that concentration is “crucial for robust architecture” adds nothing.

Use one concrete example when the reader might otherwise misclassify a case. A counterexample can show where the rule stops.

## Give the rule a boundary

Distinguish a default from an invariant. “Prefer” leaves room for a justified alternative. “Never” excludes it. Choose deliberately.

Name conditions that would reverse the recommendation. Removing an internal compatibility layer is different from breaking an API with external consumers. Do not hide that distinction behind an absolute slogan.

If the principle needs a long sequence of commands to apply, move that sequence into a workflow. Let the principle own the decision and the workflow own the execution.

## Keep corrections small

A correction can be metadata plus one paragraph. It does not need a title hierarchy, rationale, checklist, and output schema merely to resemble larger skills.

Illustrative correction:

> Rewrite the previous answer in plain language. Keep the facts, limitations, and next action. Replace unexplained terms with their meaning. Return the rewritten answer, not an account of the rewrite.

A principle is finished when its trigger, decision, and limits are understandable. A correction is finished when the requested behavior is unambiguous. Neither benefits from padding.
