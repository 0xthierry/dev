# Write references and routing instructions

Use a reference for detail the agent needs under a known condition. Use a routing document when the primary task is selecting and composing other procedures.

## Give each reference a job

A useful reference supplies one of the following:

- A specialized procedure for a source, platform, or task subtype.
- A role prompt the caller can instantiate.
- A worked example that resolves an ambiguity.
- A format or rubric that another step actually uses.
- Facts for lookup, such as accepted values and their meanings.

Name the file for that job. At the incoming link, name the condition for reading it and the information it provides. “Read the telemetry guide when the question concerns runtime history” is better than “See additional resources.”

Distinguish facts from instructions. A lookup table describes what values mean. A source-specific procedure tells the agent how to gather evidence. Do not turn either into a general essay.

## Write a source-specific guide

A source guide can answer what the source contains, how to search it, what useful evidence looks like, where the source can mislead, and what to return.

Make examples concrete without claiming that example resources exist. Mark illustrative commands, schema names, selectors, and output as examples. For a real integration, inspect the actual interface before publishing executable instructions.

Include limitations that change interpretation. Expired retention is not evidence that an event never occurred. An inaccessible source is not a completed search with no matches. Put these warnings beside the relevant procedure.

## Make routing selective

Each route should name a recognizable task and the procedure that owns it. Resolve likely overlaps. For example, a request for status is not necessarily permission to repair or merge anything.

Keep shared authority limits in the coordinator. Let the selected workflow own its steps and return contract. Do not repeat the entire workflow in the routing table.

A coordinator can be longer than a narrow skill, but it should remain an index the agent can act on. If choosing a route requires reading every destination, the index has failed.

## Use progressive disclosure without fragmentation

Keep a rule inline when every invocation needs it or missing it would invalidate the task. Extract material when a subset of invocations needs substantial detail. Do not split on an arbitrary word count.

Prefer a main file that links directly to the needed reference. Deeper links are justified when the intermediate file makes a real selection, such as choosing a source-specific guide. Avoid circular instructions that require each document to be read before the other.

Give each rule one authoritative home. A caller may name a critical prerequisite, then link to its definition, without copying the entire rule. Link maintenance gets harder when several files claim to own the same procedure.

Read the link graph as an execution path. Check that files exist, relative paths resolve from the referring file, and the reader knows when to return to the main workflow. A bundled document with no reachable entry point is unlikely to be used.
