# Pi Nested Agents

Loads nested `AGENTS.md` / `CLAUDE.md` files on demand as the agent works in descendant directories.

Pi already loads context files from the session cwd and its parents at startup. This extension keeps that behavior unchanged and adds Claude-style dynamic loading for files below the project root:

- No rule catalog or descendant file list is added to the system prompt.
- When a tool touches a file or directory, Pi checks directories from the project root down to that path.
- Newly applicable `AGENTS.md` / `CLAUDE.md` content is injected once as hidden `nested-agents` context.
- Parent context appears before child context, so more specific files are later in context.
- Files already loaded by Pi's actual startup context list are skipped, and symlink duplicates are deduplicated by real path.

The extension recognizes the same direct context filenames Pi uses natively: `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`.
