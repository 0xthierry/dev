# Retired setup material

**Historical reference only — not supported installation or recovery instructions.**
Use the current [machine setup guide](../../INSTALL.md) from the canonical
`~/dev` checkout. Normal setup targets a working packaged Quattro desktop and
needs none of the retired material below.

The completed Omarchy 3.x → Quattro cutover tooling and the obsolete Apple
Silicon/ARM Parallels installation guide are preserved in immutable Git commit
`ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9`. The files were removed from active
scripts, tests, and documentation together so a retired runbook cannot be
mistaken for a current setup prerequisite. No historical executable is copied
into this checkout. Follow the links only to inspect the historical record;
do not execute those procedures against a current machine. Their assumptions,
paths, package versions, and hardware instructions are obsolete.

| Retired path | Immutable historical source |
|---|---|
| `scripts/omarchy-quattro-preflight.py` | [Preflight](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/scripts/omarchy-quattro-preflight.py) |
| `scripts/omarchy-quattro-preflight-rehearse.py` | [Rehearsal](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/scripts/omarchy-quattro-preflight-rehearse.py) |
| `tests/omarchy-quattro-preflight.test.py` | [Cutover tests](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/tests/omarchy-quattro-preflight.test.py) |
| `docs/omarchy-quattro-links.md` | [Link protection runbook](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/docs/omarchy-quattro-links.md) |
| `docs/omarchy-quattro-cutover.md` | [Cutover checklist](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/docs/omarchy-quattro-cutover.md) |
| `parallel/INSTALL.md` | [Obsolete ARM Parallels guide](https://github.com/0xthierry/dev/blob/ee5fd0c8aba3b55aa86d770fe0c3e8e0b2ea7de9/parallel/INSTALL.md) |

The original relative links remain in their original Git tree; the archive
index does not relocate those files and break their relative relationships.
If reading locally, the same commit and paths are available in Git history;
a shallow clone may need the historical commit before inspecting it.

Run `python3 docs/history/verify-archive.py` from this repository to verify the
six historical blobs, their absence from the working tree, and the absence of
active references to retired paths. This read-only check does not run any
historical code or access the live desktop.
