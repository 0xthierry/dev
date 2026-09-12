---
name: writing-skill
description: >-
  Use when creating, rewriting, or reviewing an agent skill, a SKILL.md file,
  or its linked reference documents. Covers instructional voice, skill structure,
  scope, examples, output contracts, and progressive disclosure. Not for executing
  the workflow a skill describes or editing unrelated prose.
---

# Write a skill

Write instructions a capable agent can read cold and act on. State the task, the decisions it must make, and what counts as finishing. Keep prose that changes an action, a decision, or the interpretation of evidence. Cut the rest.

## Establish the task

Before drafting, identify the requested outcome, the situations that trigger the skill, its boundaries, and the result it must return. Use the user's requirements and the material supplied for this task. Do not invent a preference or turn one incident into a universal rule.

If an unresolved choice would change the outcome or the agent's authority, ask a focused question. Leave ordinary wording and organization decisions to the author.

For an existing skill, identify the behavior that must survive the edit. A shorter file that drops a required outcome is not an improvement.

## Choose the shape

Read only the reference that matches the document you are writing. Combine shapes only when the task needs both.

| You are writing | Read |
| --- | --- |
| A sequence of actions with branches and verification | [Workflows](references/workflows.md) |
| A reusable decision rule or a small behavioral correction | [Principles and corrections](references/principles.md) |
| Instructions for an investigator, reviewer, or other assigned role | [Role prompts](references/role-prompts.md) |
| A lookup guide, source-specific procedure, or coordinator that routes to other skills | [References and routing](references/references-and-routing.md) |

For sentence-level guidance and worked rewrites, read [Voice and examples](references/voice-and-examples.md). Read [Source notes](references/source-notes.md) only when the origin or limits of this approach matter.

## Draft the instructions

Start with the outcome or responsibility. Use commands for actions and declarative sentences for facts. Name the actor, the object, and the observable result when they could be misunderstood.

Write concrete steps rather than requests to be careful or thorough. Where a tempting shortcut would defeat the task, name it and give the required alternative. Explain a rule when its reason helps the agent apply it correctly. Do not attach a justification to every command.

Put a condition beside the instruction it controls, preferably before it. Give defaults and exceptions where a real decision exists. Use strong prohibitions for actual boundaries, not to make preferences sound important.

Define completion and the handoff. A procedural skill needs evidence appropriate to its task. An investigation must distinguish findings from inference. A subjective writing task can finish with a draft for human review. Do not force every skill into a testing or reporting ceremony.

## Split by need

Keep the common path, authority limits, and completion rules in `SKILL.md`. Move specialized procedures, optional examples, and role prompts into references. Material needed on every invocation usually stays inline.

At each link, say when to read the file and what it supplies. Give each rule one authoritative home. A reference must contain useful detail, not a stub that sends the reader elsewhere. Do not make the agent read every reference to discover which one applies.

## Check the result

Read the draft as an agent with no access to this conversation.

- Can it recognize when the skill applies and choose the next action?
- Are its scope, authority, and stop conditions clear where they matter?
- Does every required outcome survive, including inconvenient exceptions?
- Are commands, paths, examples, and linked files accurate or explicitly illustrative?
- Can it distinguish completed, blocked, and unproven work without inventing a success?
- Does each reference add something the main file does not already own?

Use the target harness's supported metadata. Include `name` and a `description` that names the task and its triggers. Do not copy another harness's flags or tool names without checking support. Validate frontmatter and links. Exercise executable procedures when practical; otherwise state what remains untested. For voice and organization changes, compare the before and after against the intended behavior rather than pinning exact wording in tests.

Hand back the skill path, the structural choices worth explaining, and the validation performed. Name any open decision. Do not narrate every edit.
