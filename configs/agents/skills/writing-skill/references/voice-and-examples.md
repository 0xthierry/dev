# Write direct instructions

Aim for an experienced engineer giving a capable colleague a precise assignment. Assume competence without assuming knowledge of this task's hidden constraints. Be candid about a mistake or blocker. Do not make the voice hostile.

## Name the action

Use commands for instructions. State who does what when responsibility could be unclear. Prefer the real symbol, command, file, or action over an abstract description.

Before:

> Ensure that appropriate validation is performed to facilitate a robust outcome.

After:

> Parse the configuration before starting the worker. Reject an invalid port and report the field that failed.

The revision replaces an aspiration with an action, an ordering constraint, and an observable error. These examples are illustrative, not instructions for a real repository.

## Be concise without becoming cryptic

Use short, familiar words. Keep articles and verbs. Give each thing one name. Do not replace a precise technical term with a vague everyday synonym.

Keep one main thought per sentence, but vary sentence length. A condition and its consequence may belong together. Several independent actions usually do not.

Before:

> Auth stale → refresh, retry once, still bad → block.

After:

> If authentication has expired, refresh it and retry once. If the retry fails, report the blocker and stop.

The second version is longer and easier to execute correctly. Word count is not the objective.

## Keep reasons that resolve ambiguity

Routine commands need little explanation. A surprising rule may need a short reason so the agent does not apply it mechanically.

Before:

> Never delete artifacts. Evidence preservation is essential for maintaining comprehensive auditability.

After:

> Remove the temporary instance, but keep its screenshots and logs. The reviewer needs them after cleanup.

The revision defines which artifacts survive and why. It does not turn a local cleanup rule into a universal ban on deletion.

## Specify what does not count

Name a shortcut only when it is plausible and would defeat the task. Pair the prohibition with the required alternative.

Before:

> Be rigorous. Do not make unsupported claims about persistence.

After:

> Reopen the saved record and compare its values. A success notification alone does not prove persistence.

Use this technique sparingly. A page of repeated prohibitions is harder to follow than a clear positive path with a few well-placed boundaries.

## Preserve uncertainty

Write observed facts plainly. Mark interpretations as interpretations and missing evidence as missing. Remove redundant hedges, not the limits of the finding.

Before:

> This was clearly designed to improve performance.

After, when the history supplies no rationale:

> The change removes a repeated query. The reviewed commits do not say whether performance motivated it.

The revision separates a mechanical observation from a claim about intent. Do not make prose sound more certain than its sources.

## Use formatting for navigation

Use sentence-case headings that name an action, decision, or subject precisely. Number sequences. Use bullets for independent items and tables for genuine comparisons or mappings. Put commands and symbols in code font.

Keep paragraphs short enough to scan. Use periods instead of long-dash asides. Use colons to introduce lists or examples rather than to join several thoughts. Bold a boundary or a useful lead-in, not every noun.

Do not force symmetry. An optional section with no content should disappear. A four-line correction should not acquire eight headings.

## Remove performance from the prose

Cut greetings, praise, dramatic announcements, stock conclusions, and explanations of how thorough the agent intends to be. State the action or finding instead.

Avoid invented metaphors when the mechanism has a name. Bluntness is useful when it establishes a boundary. It is not a substitute for precision.

Read the final text aloud or as a cold-start executor. If a sentence is grammatical but requires rereading to identify the action, revise it. If following a style rule makes the instruction harder to understand, keep the clearer instruction.
