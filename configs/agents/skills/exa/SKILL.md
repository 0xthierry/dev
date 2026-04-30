---
name: exa
description: "Use for Exa web/code search, page contents, similar links, citation answers, or async research via Exa API."
---

# Exa

Use this skill when the user wants to work with Exa's official API. Favor official Exa docs and examples over memory. Assume `EXA_API_KEY` is already available in the environment unless the user says otherwise.

## Default stance

- Pick the narrowest Exa interface that matches the job.
- Prefer direct API calls or SDK usage when the user wants explicit control over requests and outputs.
- Do not guess endpoint names, fields, limits, or model names. Check the references when uncertain.
- Keep citations and source URLs when returning factual answers derived from Exa output.

## Start here

Classify the request before acting:

1. Use `/search` when you need ranked web results and optional page contents.
2. Use `/contents` when you already know the URLs and want text, highlights, or summaries.
3. Use `/findSimilar` when you want pages similar to a known URL.
4. Use `/answer` when you want Exa to generate an answer backed by search results and citations.
5. Use `/research/v1` when the task is long-running, multi-step, or needs structured output from an asynchronous research agent.
6. Use `/context` only for code-focused retrieval through Exa Code.

## Workflow

1. Decide whether the user needs direct REST or an SDK example.
2. Choose the endpoint from the decision list above.
3. Load [references/endpoints.md](references/endpoints.md) for the verified endpoint, auth, rate-limit, and example details.
4. Write examples using `EXA_API_KEY` from the environment.
5. Keep examples minimal and working. Prefer `curl` for transport clarity unless the user asked for a specific language.

## Output rules

- Use `x-api-key: $EXA_API_KEY` in raw HTTP examples.
- If you provide SDK examples, prefer showing the SDK reading `EXA_API_KEY` from the environment where the official SDK supports it.
- When using `/answer` or `/research`, preserve citations or returned source lists in your downstream output.
- When using `/research/v1`, make the asynchronous lifecycle explicit: create task, poll task, optionally list tasks.
- When using `/context`, state that it is Exa Code specific, not a generic web-search replacement.

## What to avoid

- Do not present `/answer` as equivalent to `/research`.
- Do not use `/research` for trivial single-shot lookup when `/answer` or `/search` is enough.
- Do not claim unsupported parameters or undocumented limits.
- Do not silently drop citations when Exa returns them.

## References

- Read [references/endpoints.md](references/endpoints.md) for endpoint selection, verified request paths, examples, and rate limits.
