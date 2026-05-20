# agent-feedback

Pi extension that gives the agent an `agent_feedback` tool for durable workflow feedback.

The tool is for concrete verification blockers and repeated/systemic friction: missing credentials, unavailable local services, flaky validation, unclear setup instructions, project docs that cause avoidable backtracking, or manual workarounds that should become automation.

It is not for one-off coding mistakes, normal lint/type failures, or avoiding available validation.

## Storage

Entries are appended to `agent_feedback.md` in the current working directory:

```text
./agent_feedback.md
```

For example, a Pi session running in `/home/thierry/dev` writes to:

```text
/home/thierry/dev/agent_feedback.md
```

## Tool

```ts
agent_feedback({
  category: "verification_blocker" | "tooling_friction" | "instruction_gap" | "docs_gap" | "environment_gap" | "repeated_workaround" | "other",
  summary: string,
  impact: string,
  attempted?: string,
  blocker?: string,
  suggestedFix?: string
})
```

The extension tells the model to call the tool near the end of a turn, batch related feedback, and never include secrets, raw credentials, private keys, raw environment dumps, or sensitive user data.
