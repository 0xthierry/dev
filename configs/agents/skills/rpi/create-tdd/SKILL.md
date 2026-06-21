---
name: create-tdd
description: Create a Technical Design Document
disable_model_invocation: true
disable-model-invocation: true

---

# TDD Phase

You are creating a Technical Design Document (TDD): the artifact that turns whatever product context exists into a technical design the team can build from. It answers HOW we build something - not WHAT or WHY. Leave product requirements and UX to the upstream product context.

You run the design as a guided conversation in **two ordered phases**:

1. **System Design** - how the pieces fit together across components.
2. **Program Design** - how the code inside those pieces is shaped.

You fully settle and get the user's sign-off on the System Design before you open the Program Design. Within each phase you grill the user one question at a time and re-work the document after every answer so it always reads as a coherent design - never a transcript of Q&A.

## How the conversation works (read this before you start)

**Exactly one question per message.** End every message with a single question - never a second question, a stacked follow-up, or an "and also...". Offering 2-3 *options to choose between* is still one question; stacking multiple independent decisions into one message is not allowed. Walk down the decision tree one decision at a time: present the decision with its options, tradeoffs, and your recommendation, then stop and wait. If several things feel open, ask only the one that unblocks the rest - the others come after the answer. Never ask for a vague "any feedback?".

**Update the doc after every answer by re-working the relevant section.** Fold the answer in: rewrite prose, redraw a diagram, reorder or remove earlier content as needed. A single answer often revises parts of the section that have already started to emerge - four questions into the program design, the right move may be to restructure two paragraphs you wrote earlier. Capture each decision in whatever form conveys it best - a diagram, signature, or sketch - reaching for one when the decision calls for it, regardless of whether the question itself used one.

**The doc is always a cohesive description of what's known - never a log.** At any point in the conversation, the System Design and Program Design sections should read like a design someone wrote on purpose: high-level, coherent, and current - not a list of answers, and not a changelog of decisions. Treat each answer as a reason to re-paint: restructure, reorder, rebuild, and reorient the section so it stays a clean, unified description of everything decided so far. **Rewriting entire sections as you go is expected, not exceptional.** Favor a smaller, sharper section over an accreting pile of bullet points.

**Show, don't tell.** Reach for a diagram, type signature, or code-shape sketch instead of paragraphs of prose. A quick diagram communicates more than a wall of text. Keep artifacts up to date as decisions evolve.

**Make it read like a document a human designed for other humans.** A reader should be able to skim the headers alone and come away with the shape of the design. Give every section and sub-point a header that states its *takeaway* - the way a good slide title asserts its message ("Sync runs as a background job after the write commits"), not a generic topic label ("Sync"). Keep paragraphs short, and place each diagram, signature, or snippet immediately beside the prose it illustrates - never let the text become a wall with all the visuals piled at the end. Lead with the point, then support it.

**Leverage, not exhaustiveness.** The TDD should let the user decide, align, and re-steer the implementation without loading every detail into their head. Prefer the smallest set of diagrams, signatures, and sketches that reveal the important decisions and tradeoffs.

**Get more context when you need it.** When a decision depends on how the codebase actually works, spawn Agent() calls (codebase-analyzer, codebase-pattern-finder, web-search-researcher, or the library researcher) before presenting options. Fold any new findings back into the research artifact.

---

<step index="1" name="understand-the-context">

<instructions>
- Find the task directory: `ls -La .tasks/TASKNAME` (use Bash `ls -La` - not Grep/Glob - the directory may be a symlink).
- Read every relevant file in the task directory **fully** (Read with no limit/offset), excluding research-questions docs.
- Read the TDD template: `Read({SKILLBASE}/references/tdd_template.md)`.
</instructions>

<guidance>
## Working from whatever inputs exist

There is no required upstream artifact. The product context might be a full PRD, or just a ticket plus a research doc, or only a couple of sentences describing what the user wants inside an existing research document. Work from whatever is present - **a PRD is not required.**

- Ground the design in the inputs you *do* have, and cite them as you write: "Per the ticket...", "The research doc notes...", "As described in the PRD...".
- Don't duplicate upstream content into the TDD - reference it.
- If the product context is thin, don't invent requirements. Surface the gaps as questions during the interview and let the user fill them in.
- The TDD answers HOW to build what those inputs describe. If a technical decision changes product scope or UX, call it out for the user (and update the PRD/mockups if a PRD exists).
</guidance>

</step>

<step index="2" name="write-the-skeleton">

<instructions>
Write the doc to `.tasks/ENG-XXXX-description/NN-tdd-DESCRIPTION.md` (next zero-padded `NN-` index in the task dir; `DESCRIPTION` is a 2-4 word kebab-case slug).

**Keep the skeleton as minimal as possible. No preamble, no setup, no summaries.** The faster you reach the first question, the more the user stays engaged in building the TDD. Write only:
- Frontmatter with `type: design-tdd`, plus the top-level title
- Empty **System Design** and **Program Design** headers - built out through the two phases
- **Patterns to Follow** header

Today's reality and the target both get expressed inside the System Design and Program Design during the interview (Steps 3 and 5), so the skeleton itself stays empty.

Then respond immediately by opening the System Design phase with the **first system-design question** - at most one short orienting line, then the question. For example:

> I've started the TDD. First question: should the new sync run inline in the request, or as a background job after the write commits?
>
> - **Inline** - simplest, but the client waits on the upload...
> - **Background job** - returns fast, but needs a queue and a retry path...
>
> I'd lean background job because the upload shouldn't block the response - which way do you want to go?
</instructions>

<guidance>
## Markdown formatting

When you write markdown that itself contains a code block showing other markdown (for example a fenced block that contains its own fence), use 4 backticks for the outer fence so the inner 3-backtick block doesn't close it early:

````markdown
# Example heading
```bash
npm install example
```
````
</guidance>

</step>

<step index="3" name="system-design">

<instructions>
Design the cross-component architecture. System Design is about behavior *between* components - how services, endpoints, schemas, queues, stores, and external systems interact - not the code inside any one of them.

Convey **how the system changes**: what exists today and what's new or different. Express the delta so the reader understands the change at a glance.

**Ask exactly one question per message, walking down each branch of the design tree.** Resolve one decision, let it inform the next, and only then ask the next. Presenting 2-3 options to choose between is still one question - don't stack multiple decisions into one message, and don't append a second question or an "any feedback?".

For each decision: present a single decision with options (as diagrams / signatures / endpoint shapes when that's the clearest form) and your recommendation -> wait for the answer -> re-work the **System Design** section so it absorbs the answer, keeping it one coherent architecture. Reach for a diagram, signature, or sketch whenever it captures the decision best.

Use the representations in the guidance below; pick the form that makes each decision clearest.
</instructions>

<guidance>
## System Design representations

**Mermaid diagrams** for control flow, data flow, and component interactions:
```mermaid
sequenceDiagram
    participant Client
    participant Service
    participant Store
    Client->>Service: request
    Service->>Store: read/write
    Store-->>Service: result
    Service-->>Client: response
```

**High-level type signatures** for the contracts that define the boundary (use the codebase's language):
```
createResource(input: CreateResourceInput) -> Resource
```

**Endpoint / message shapes** for the interfaces between components - routes, message definitions, or request/response schemas in whatever transport the codebase uses (REST, RPC such as gRPC, GraphQL, queue events, etc.):
```text
PUT /api/resources/:slug
  request:  { destination: string }
  response: { resource: Resource }
```

**Data contracts** when a file format, API payload, or other persisted shape is part of the cross-component agreement:
```json
{
  "id": "resource-id",
  "status": "ready",
  "updatedAt": "2026-06-19T00:00:00Z"
}
```
Use whatever representation matches the project, such as JSON, YAML, TypeScript types, Rust structs, or another concrete file/API shape.

## HTML artifacts for complex concepts

When a concept is too complex for Mermaid or plain text - combining data flow, structure, annotations, or side-by-side comparisons - write a focused HTML artifact and reference its local file path:
- Write to `.tasks/{task-slug}/diagram-{description}.html`
- Keep each artifact focused on the decision at hand; use realistic labels, not lorem ipsum
Artifact path: `.tasks/{task-slug}/diagram-{description}.html`

**If you are writing an HTML artifact, read `{SKILLBASE}/references/artifact_template.html` and follow it.** Copy its `<style>` block and build your content in the body using its prose elements and utility classes (`.card`, `.badge*`, `.stat*`, `.ba`). The artifact must follow the template so it matches this application, not the codebase the TDD is about.
</guidance>

</step>

<step index="4" name="system-design-review-gate">

<instructions>
When the cross-component architecture is settled, stop and hand it back for review. Because you've been fleshing it out section-by-section, the user hasn't read it as a whole yet. Say something like:

> I think the system design is complete. Since we've been building it up decision by decision, can you read the **System Design** section top to bottom and confirm it hangs together before we move on to program design?

Wait for the user's approval. Incorporate any fixes they raise. **Do not open the Program Design phase until the user signs off on the System Design.**
</instructions>

</step>

<step index="5" name="program-design">

<instructions>
Now design the in-code shape under the **Program Design** header.

**Ask exactly one question per message, walking down each branch of the design tree.** Same rhythm as system design: resolve one decision, let it inform the next, re-work the section after each answer. Presenting 2-3 options to choose between is still one question - don't stack multiple decisions into one message, and don't append a second question or an "any feedback?".

**Almost every message should carry a code block.** Program design is a discussion about the shape of code, so visualize it richly rather than describing it in prose: show each option as a concrete code-shape sketch - a `diff`, a call-stack tree, a file-tree diff, a component tree, a type signature, or pseudocode (use the views in the guidance below). When you present 2-3 options, render each one as its own code block so the user compares the actual shapes side by side, not your description of them. A message that asks a program-design question with no code block should be the rare exception - if you catch yourself explaining a code change in words alone, convert it into one of the views before sending.

For each decision: present a single decision with options as concrete code-shape sketches and your recommendation -> wait -> re-work the **Program Design** section so it absorbs the answer, keeping it one coherent description of the code shape. An answer often updates the call tree, file shape, or testing seams you already started, so restructure and redraw those in place.

Use the views in the guidance below that fit the change.
</instructions>

<guidance>
## Program Design views

Be concrete but selective - include the views that clarify the design.

**Call-stack tree** - for services, CLIs, workers, or any orchestration / control-flow change. Show the important calls, not every frame.
```text
entrypoint
  runCommand
    handleCreateResource
      ResourceClient.create(input)
        POST /resources
      renderResult
```
Use `diff` syntax only when it highlights changed/added/removed calls; if most of the snippet is net-new, plain `text` is clearer.
```diff
 entrypoint
   runCommand
+    handleCreateResource
-    legacyCreateFlow
```

**Frontend component tree** - UI changes. Show production components, their state/local data, and module/package boundaries (the example below is React/TSX - adapt to whatever UI framework the codebase uses).
```tsx
<ResourcePage> (apps/example/src/routes/resource.tsx)
  useResourceActions()
  <ResourceToolbar>
    <CreateResourceDialog> (packages/ui)
      useFormState()
```
Use `diff` syntax only when it highlights changed/added/removed components, props, or state.
```diff
 <ResourcePage> (apps/example/src/routes/resource.tsx)
   useResourceActions()
+  useOptimisticResourceState()
   <ResourceToolbar>
+    <CreateResourceDialog> (packages/ui)
```

**File-tree diff** - broad refactors or when file responsibility is a design decision. Format like `tree` output so depth is easy to scan; keep it high-level.
```diff
 src
 └── resource
+    ├── resource-client.ext      # NEW - wraps API contract calls
+    ├── resource-client.test.ext # NEW - covers request/response mapping
~    └── resource-route.ext       # MODIFIED - wires create action into UI
```

**Dependency-injection map** - the seams and injected dependencies that matter, grouped by the object/workflow that receives them. Explain what each dependency lets the code do or fake in tests; avoid raw constructor dumps.
```text
createResourceWorkflow
  receives resourceStore    -> persists resources, fakeable in workflow tests
  receives eventPublisher   -> emits resource-created events after commit
  receives clock            -> makes timestamps deterministic

ResourcePage
  receives createResource   -> UI does not know transport details
  receives queryClient      -> updates cached resource list after success
```

**Testing seam map** - the few seams that prove the risky parts are testable. Connect behavior to the fake/mock boundary and the test location.
```text
Behavior                          Seam / fake                  Test location
rejects invalid resource input    fake resourceStore unused    resource-workflow.test
rolls back publish failure        fake eventPublisher throws   resource-workflow.test
shows optimistic row              fake createResource promise  ResourcePage.test
maps interface validation errors  mocked transport response    resource-client.test
```

**Internal method signatures** for key new functions not captured in system design (use the codebase's language):
```
resolveTarget(items: Item[], cursor: Cursor) -> ItemId | null
```

**Pseudocode** for complex algorithms or logic - english-y, not a programming language:
```text
on(resourceSave)
  write updated content to disk
  update the local index with the new file path and timestamp
  return the generated local path
```

## HTML artifacts for complex concepts

The same HTML-artifact escape hatch from the System Design step applies here - use a focused inline HTML artifact when code shape, data flow, and annotations are clearer together than in plain text. Base any HTML artifact on `{SKILLBASE}/references/artifact_template.html` so it matches this application's visual language.
</guidance>

</step>

<step index="6" name="program-design-review-gate">

<instructions>
When the program design is settled, hand it back for review the same way:

> I think the program design is complete too. Can you review the **Program Design** section and confirm the code shape and testing seams look right?

Wait for the user's approval and incorporate any fixes.
</instructions>

</step>

<step index="7" name="wrap-up">

<instructions>
When both phases are approved, read the final answer template and follow it exactly (it points to the next step - the structure outline): `Read({SKILLBASE}/references/tdd_final_answer_resolved.md)`. Include artifact paths if available.
</instructions>

</step>
