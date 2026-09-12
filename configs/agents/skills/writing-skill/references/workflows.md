# Write a workflow

Use this shape when the agent must perform actions in an order, choose between paths, or recover from failure. The document should make the next action clear without pretending every case follows one straight line.

## Open with the responsibility

Name what the agent must deliver. Add a boundary if a nearby task is easy to confuse with this one.

For example, a diagnosis skill produces a supported explanation of a failure. It does not also authorize a fix. A refactoring skill changes structure while preserving behavior.

An ownership sentence helps when responsibilities are split. Otherwise start with the action. Do not manufacture a role for a three-step procedure.

## Order the work

Put prerequisites before the work they enable. Number steps when sequence matters. Use named phases only when each phase has a distinct result.

A useful step contains an action and enough information to judge its result. Add a branch or recovery instruction when failure changes what happens next.

Prefer this illustrative instruction:

> Run the focused test before editing production code. Confirm that it fails on the reported behavior. If it fails during setup, fix the setup before treating the run as reproduction evidence.

Over this:

> Follow best practices for test-driven development and ensure the failure is properly understood.

The first instruction defines what to run, what to inspect, and which result does not count.

## Put decisions where they occur

Keep the common case first. Place an exception beside the step it changes. Name the deciding fact instead of writing “use judgment” on its own.

For a branch, answer the questions that matter:

- What condition selects this path?
- What does the agent do on that path?
- Where does it continue, or when does it stop?

Do not add a fallback merely to avoid reporting a blocker. A substitute that cannot produce the requested evidence is an incomplete result, not a successful alternate path.

## Define proof at the task's level

Name the observable result that establishes completion. A build can prove compilation. It cannot by itself prove a user interaction works. A screenshot can show rendered state. It may not prove persistence.

When the skill generates another procedure, ask the author to execute the generated procedure before calling it ready. When execution requires unavailable access, report the missing prerequisite and the untested steps.

Keep verification proportional. A small deterministic operation may need one command. A broad migration may need a baseline, checks for each unit, and final integration evidence. Do not copy a large workflow's ceremony into a small task.

## Specify the handoff

Name only the information the recipient needs to use or review the result. For example, a bug-fix handoff can state the broken behavior, the cause, the fix, and the failing-before and passing-after evidence.

Use fixed fields when another process consumes them. Otherwise allow natural prose and omit empty sections.

A possible structure is outcome, scope, ordered steps, completion evidence, and handoff. It is a starting point, not a required set of headings.
