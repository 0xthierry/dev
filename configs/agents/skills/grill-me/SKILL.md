---
name: grill-me
description: Relentlessly interview the user about a plan, idea, or design until every decision branch is resolved and shared understanding is reached. Use when user wants to stress-test thinking, sharpen a vague idea, or says "grill me". Do not invoke unless explicitly asked by the user.
disable_model_invocation: true
effort: max
---

# Grill Me

Interview the user relentlessly about every aspect of their plan or idea. Walk down each branch of the decision tree, resolving dependencies between decisions one by one.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

Do not accept vague answers. Push for specifics. When the user says "I think maybe X," ask why X and not Y. When the user says "it depends," ask on what.

When all branches are resolved, summarize the decisions reached and save to `ai_docs/grills/YYYY-MM-DD-description.md`.

Before wrapping up, ask one final round about **cross-cutting design preferences** — code organization style (classes vs functions, module cohesion), naming conventions, error handling approach, or any other stylistic constraints the user wants applied uniformly across the task. These aren't per-decision choices — they're preferences that affect how every module is written. Capture them in a dedicated "Design Preferences" section at the end of the grill document. (The design discussion skill will also ask about these — capturing them here gives them an early anchor.)
