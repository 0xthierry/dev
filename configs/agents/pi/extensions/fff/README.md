# fff

Pi extension that overrides Pi's built-in `grep`, `find`, and `multi_grep` tools with local [FFF](https://github.com/dmtrKovalenko/fff) search.

## What it does

- `grep` — FFF content search with smart-case, regex auto-detection, fuzzy fallback, frecency ordering, context, excludes, and cursor pagination.
- `find` — FFF fuzzy path search over whole repo-relative paths with frecency/git-aware ranking and cursor pagination.
- `multi_grep` — FFF multi-pattern literal OR search via Aho-Corasick.
- `@` autocomplete — FFF-backed file/directory suggestions in interactive Pi sessions.
- `/fff-health` — show picker, git, frecency, query tracker, and scan status.
- `/fff-rescan` — trigger an async rescan.

There is intentionally no mode switch: this repository's convention is to install this extension as the overriding implementation.

## Frecency and history storage

By default, frecency and query history are scoped per project under:

```text
~/.cache/pi/fff/projects/<project-name>-<hash>/frecency.sqlite
~/.cache/pi/fff/projects/<project-name>-<hash>/history.sqlite
```

The project root is the nearest parent containing `.git`; outside Git repositories, the current working directory is used. This keeps useful ranking shared between Pi sessions in the same repository without making unrelated projects contend on one global LMDB reader table.

## Flags and env

- `--fff-frecency-db` / `FFF_FRECENCY_DB` — override the frecency database path.
- `--fff-history-db` / `FFF_HISTORY_DB` — override the query history database path.
- `--fff-enable-root-scan` / `FFF_ENABLE_ROOT_SCAN=1` — allow indexing `/`.

## Install

From this repository root:

```bash
pi install ./configs/agents/pi/extensions/fff
```

Thierry's machine setup symlinks the whole extensions directory into `~/.pi/agent/extensions`, so normal setup installs it automatically.
