---
name: librarian
description: Research open-source libraries with evidence-backed answers and GitHub permalinks. Use when the user asks about library internals, implementation details, source references, change history, or authoritative answers backed by actual code.
---

# Librarian

Research open-source libraries by combining `web_search`, `fetch_content`, repository inspection, and git history. Every important code claim should be backed by a permalink to exact source lines.

## Workflow

1. Classify the request:
   - Conceptual usage: search docs/articles, then verify with official docs or repo examples.
   - Implementation details: fetch/clone the repository, search locally, read files.
   - History/context: inspect `git log`, `git blame`, PRs/issues via `gh`.
   - Comprehensive research: combine all of the above.
2. Use `web_search` with varied queries for current context.
3. Use `fetch_content` on GitHub repository URLs to clone repos locally.
4. Inspect the clone with `bash`/`read`.
5. Get the exact commit SHA and construct permalinks.
6. Answer directly with citations.

## Repository research

Start by cloning/fetching the repository:

```typescript
fetch_content({ url: "https://github.com/owner/repo" })
```

Then inspect the returned local path:

```bash
cd /tmp/pi-github-repos/owner/repo
grep -rn "symbol_or_concept" .
find . -name "*.ts" | head
git rev-parse HEAD
```

Construct permalinks with the full commit SHA:

```text
https://github.com/<owner>/<repo>/blob/<commit-sha>/<path>#L<start>-L<end>
```

Never use branch links for evidence when a stable permalink is practical.

## History research

```bash
cd /tmp/pi-github-repos/owner/repo
git log --oneline -n 20 -- path/to/file.ts
git blame -L 10,30 path/to/file.ts
git show <sha> -- path/to/file.ts
git log --oneline --grep="keyword" -n 10
```

For GitHub issues and PRs:

```bash
gh search issues "keyword" --repo owner/repo --state all --limit 10
gh search prs "keyword" --repo owner/repo --state merged --limit 10
gh issue view <number> --repo owner/repo --comments
gh pr view <number> --repo owner/repo --comments
```

## Video research

Use `fetch_content` for YouTube tutorials, conference talks, and screen recordings published on YouTube:

```typescript
fetch_content({ url: "https://youtube.com/watch?v=abc" })
fetch_content({ url: "https://youtube.com/watch?v=abc", prompt: "What libraries are imported in the tutorial?" })
fetch_content({ url: "https://youtube.com/watch?v=abc", timestamp: "23:41" })
fetch_content({ url: "https://youtube.com/watch?v=abc", timestamp: "23:41-25:00", frames: 4 })
fetch_content({ url: "https://youtube.com/watch?v=abc", frames: 6 })
```

Use timestamps for known moments, ranges for visual scanning, and `frames` alone for a quick overview. Local video files are not supported by this setup.

## Citation rules

- Every implementation claim needs a permalink.
- Quote short code snippets only when they clarify the answer.
- Distinguish verified evidence from inference.
- Prefer official docs and source code over blog posts.
- If a search result and source code disagree, trust source code and note the discrepancy.

## Failure recovery

| Failure | Recovery |
| --- | --- |
| Search is too broad | Run 2-4 varied `web_search` queries with different terms. |
| Clone failed | Check repo URL, auth, `gh` availability, or use web docs as weaker evidence. |
| Grep finds nothing | Search for concepts, exported names, tests, and docs. |
| Branch/tag path fails | Fetch repo root, inspect actual tree, then navigate manually. |
| Need exact current code | Use `git rev-parse HEAD` and permalinks from that SHA. |
| Video extraction fails | Ensure Brave/Chromium is signed into gemini.google.com; install `yt-dlp`/`ffmpeg` for frames. |

Answer directly and keep the evidence easy to audit.
