# Pi Project Rules

Loads project rule files for Pi from:

- `.pi/rules/`
- `.agents/rules/`
- `.claude/rules/`

Rules are discovered recursively from the git root down to the current working directory. Symlinked duplicates are deduplicated by real path.

## Activation

- Plain Markdown rules and rules with `alwaysApply: true` activate on the first prompt.
- Rules with `paths:` or `globs:` activate when a prompt or tool path matches the pattern.
- Rules with `description:` and `alwaysApply: false` are listed as available; the agent can read them when relevant.
- Rules with `alwaysApply: false` and no selector activate when mentioned as `@rule-name` or when the agent reads the rule file.

Pi emits a visible `project-rules` message whenever a rule is first activated in the session. Use `/rules` to show discovered rules, aliases, and activation status.
