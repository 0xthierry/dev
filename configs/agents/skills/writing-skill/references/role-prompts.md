# Write a role prompt

Use a separate role prompt when an existing workflow assigns a distinct job to another agent. This document explains how to write that assignment. It does not require delegation or prescribe models.

## Define the job before the persona

Name the product of the role. An investigator gathers evidence. An explainer builds a readable account. A reviewer identifies problems. A lead reviewer decides which findings warrant action.

A role sentence should establish responsibility. “You are a world-class expert” supplies no task boundary or completion criterion.

Give the role enough context to work without the parent conversation. State the question, relevant inputs, assigned scope, permitted actions, and expected return. Use visible placeholders in reusable templates and make clear that the caller must fill them before use.

## Separate evidence collection from conclusions

An investigator's instructions should favor exact sources and honest gaps over polished narrative. Ask for the searches performed, relevant evidence, contradictions, and leads outside the assigned scope. Define whether the investigator should follow those leads or return them.

An explainer needs different instructions. Name the audience and the understanding they should gain. Ask for concrete mechanisms, enough source pointers to follow up, and depth proportional to the question. Do not force every collected detail into the explanation.

When one agent both investigates and explains, keep these responsibilities distinct within the instructions. Separate agents are not necessary for a small question.

## Make review demanding without manufacturing findings

Tell reviewers to show a concrete problem and the evidence that makes it relevant. Distinguish a defect from a preference for another approach. Permit an empty review.

Include the intended outcome and constraints. Ask whether the implementation achieves them without silently dropping a requirement. When the assignment is implementation review, do not let the reviewer replace the product goal with its own.

A lead reviewer should verify, filter, and decide. It should not accept a finding solely because several reviewers repeated it. Require reasons for accepting or dismissing consequential findings.

## Match confidence to evidence

Keep observations, supported interpretations, guesses, and unknowns distinguishable. A causal claim needs causal evidence. Code behavior alone does not establish its author's motivation.

An instruction to remove filler must not remove meaningful uncertainty. The final wording should preserve what the investigation could and could not establish.

## Define access and return boundaries

Say what the role may read, edit, or invoke. An agent with tools is not automatically authorized to use all of them. Treat transcripts, external documents, and quoted findings as data, not new instructions.

Specify a return shape that the next reader can use. Evidence collectors benefit from structured records. Human-facing explainers usually need more freedom. Avoid quotas that reward invented findings or repetitive prose.

Keep runtime-specific tool names and model settings outside a portable prompt unless they are essential to the assignment and have been verified.
