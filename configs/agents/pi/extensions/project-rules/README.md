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

Pi keeps a stable rule catalog in the system prompt, then injects activated rule bodies as append-only hidden `project-rules` context messages. Interactive sessions also show a UI notification whenever a rule first activates. Use `/rules` to show discovered rules, aliases, and activation status.
