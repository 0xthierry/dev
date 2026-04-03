# Generate project-commands.json

Read the source files listed below, then write a `project-commands.json` file to the target path specified below. Use the Write tool to create the file.

## Schema

```json
{
  "schemaVersion": 1,
  "projectRoot": "<absolute path to project root>",
  "sourceFiles": ["<files you read to generate this>"],
  "scopes": [
    {
      "id": "<short identifier, e.g. 'api', 'web', 'root'>",
      "pattern": "<glob pattern for repo-relative POSIX paths, e.g. 'packages/api/**'>",
      "cwd": "<relative to projectRoot, e.g. 'packages/api' or '.'>",
      "test": [{ "argv": ["pnpm", "vitest", "run"], "mode": "project" }],
      "lint": [{ "argv": ["pnpm", "eslint", "."], "mode": "project" }],
      "typecheck": [{ "argv": ["pnpm", "tsc", "--noEmit"], "mode": "project" }],
      "format": [
        { "argv": ["pnpm", "eslint", "--fix"], "mode": "file", "extensions": ["ts", "tsx", "js", "jsx"] },
        { "argv": ["pnpm", "prettier", "--write"], "mode": "file", "extensions": ["json", "md", "yaml", "yml", "css"] }
      ],
      "testFilePatterns": ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
      "sourceExtensions": ["ts", "tsx", "js", "jsx"]
    }
  ]
}
```

## Rules

1. **Read the actual config files** listed below before writing. Do not guess — base commands on what package.json scripts, Makefile targets, and config files actually contain.

2. **Scope ordering**: Most specific scopes first, least specific last. A root/fallback scope with pattern `**` should be last.

3. **Command argv**: Use the exact command the developer would run. Include the package manager prefix (pnpm, npm, yarn, bun). For Makefile projects, use `make <target>`. Each element of argv is a separate argument — do not join them.

4. **mode**: Use `"file"` for commands that accept a file path as the last argument (formatters, single-file linters). Use `"project"` for commands that operate on the whole scope (test suites, full lint runs, typechecks).

5. **extensions**: Only required for `mode: "file"` format commands. List file extensions (without dot) the formatter handles.

6. **Monorepos**: Create one scope per workspace package with its own test/lint/typecheck/format commands. If the root also has scripts, add a root scope. Check each package's package.json for its specific scripts and dependencies.

7. **Empty arrays**: If a scope has no command for a category (e.g., no tests), use an empty array `[]`.

8. **sourceFiles**: List every file you read to produce this JSON (package.json files, config files, etc.).

9. **Single-package projects**: One scope with `"pattern": "**"` and `"cwd": "."`.

10. **Do not include** development servers, build commands, or deployment scripts — only test, lint, typecheck, and format commands.

11. **testFilePatterns** (optional): Glob patterns for test files in this scope. Examples: `["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"]`. If omitted, defaults to common conventions. Only include if the project uses non-standard test file patterns.

12. **sourceExtensions** (optional): File extensions this scope cares about, without dots. Example: `["ts", "tsx"]`. If omitted, defaults to all common source extensions. Only include if the scope uses a specific language subset.
