# Exa Endpoints

This file summarizes the Exa endpoints I verified from Exa's official docs. It is not a full schema dump. When a task depends on exact request or response fields beyond what is listed here, open the linked Exa page and follow the current reference.

## Authentication

- Official REST examples use the `x-api-key` header.
- This skill assumes `EXA_API_KEY` is already present in the environment.

Example:

```bash
curl -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"latest AI safety research"}'
```

## Endpoint selection

| Need | Endpoint | Notes |
| --- | --- | --- |
| Ranked web results | `POST /search` | General-purpose Exa search; can also return contents |
| Content for known URLs | `POST /contents` | Fetch text and other content forms for explicit URLs |
| Similar pages to a known page | `POST /findSimilar` | Starts from a URL instead of a query |
| Direct answer with citations | `POST /answer` | Single-shot answer generation backed by search |
| Long-running research task | `POST /research/v1` | Async research agent with polling |
| Poll one research task | `GET /research/v1/{researchId}` | Supports polling until completion |
| List research tasks | `GET /research/v1` | Cursor-based pagination |
| Code-focused retrieval | `POST /context` | Exa Code, optimized for coding context |

## `POST /search`

Official reference:

- `https://exa.ai/docs/reference/search`
- `https://exa.ai/docs/reference/search-api-guide`

Use `/search` for general web retrieval. The official search docs describe these verified search types:

- `auto`
- `neural`
- `fast`
- `deep`
- `deep-reasoning`
- `instant`

The official docs describe `auto` as the default. They also note that `/search` can return page contents as part of the search response.

Verified curl shape:

```bash
curl -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "latest AI safety research",
    "type": "auto"
  }'
```

Use `/search` when the user needs links first, with optional content enrichment after ranking.

## `POST /contents`

Official reference:

- `https://exa.ai/docs/reference/get-contents`
- `https://exa.ai/docs/reference/contents-retrieval`

Use `/contents` when you already have one or more URLs and want Exa to retrieve content. The official docs describe content retrieval options such as full text, highlights, summaries, and combined context behaviors.

Verified curl example from the official docs:

```bash
curl -X POST 'https://api.exa.ai/contents' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://arxiv.org/abs/2307.06435"],
    "text": true
  }'
```

Use this after `/search` when you want precise follow-up retrieval on selected URLs.

## `POST /findSimilar`

Official reference:

- `https://exa.ai/docs/reference/find-similar-links`

Use `/findSimilar` when the user has a seed URL and wants adjacent sources. The official docs show filters such as domain inclusion or exclusion, crawl-date and published-date windows, and optional page contents.

Verified curl example from the official docs:

```bash
curl -X POST 'https://api.exa.ai/findSimilar' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://arxiv.org/abs/2307.06435",
    "contents": {
      "text": true
    }
  }'
```

This endpoint is useful for source expansion once one good page is known.

## `POST /answer`

Official reference:

- `https://exa.ai/docs/reference/answer`

Use `/answer` for a single-shot answer grounded in Exa search results. The official docs state that it can return:

- a direct answer for specific queries
- a more detailed summary with citations for open-ended queries

Verified curl example from the official docs:

```bash
curl -X POST 'https://api.exa.ai/answer' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "What is the latest valuation of SpaceX?",
    "text": true
  }'
```

Verified documented behaviors:

- supports streaming
- returns `citations`
- supports `outputSchema` for structured output

Prefer `/answer` over `/research` when the user wants one grounded answer rather than a long-running investigation.

## Research API

Official reference:

- `https://exa.ai/docs/reference/exa-research`
- `https://exa.ai/docs/reference/research/create-a-task`
- `https://exa.ai/docs/reference/research/get-a-task`
- `https://exa.ai/docs/reference/research/list-tasks`

Use Research when the task needs a long-running, multi-step investigation with citations or structured output.

The official docs describe the lifecycle as:

1. Create a task with `POST /research/v1`
2. Poll a task with `GET /research/v1/{researchId}`
3. Optionally list tasks with `GET /research/v1`

### `POST /research/v1`

Verified curl example from the official docs:

```bash
curl -X POST 'https://api.exa.ai/research/v1' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "instructions": "Summarize the latest developments in AI safety research",
    "model": "exa-research"
  }'
```

Verified documented request fields:

- `instructions` is required
- `model` defaults to `exa-research`
- official model options listed on the create-task page:
  - `exa-research-fast`
  - `exa-research`
  - `exa-research-pro`
- `outputSchema` is supported for structured output

### `GET /research/v1/{researchId}`

Verified curl example from the official docs:

```bash
curl -X GET 'https://api.exa.ai/research/v1/RESEARCH_ID' \
  -H "x-api-key: $EXA_API_KEY"
```

Verified documented query options:

- `stream=true` for SSE updates
- `events=true` to include detailed event logs

### `GET /research/v1`

Verified curl example from the official docs:

```bash
curl -X GET 'https://api.exa.ai/research/v1?limit=10' \
  -H "x-api-key: $EXA_API_KEY"
```

Verified documented list behavior:

- cursor-based pagination
- `limit` defaults to `10`
- max page size is `50`

## `POST /context`

Official reference:

- `https://exa.ai/docs/reference/context`

`/context` is for Exa Code, not general web search. The official docs describe it as code-focused retrieval over repositories, docs, Stack Overflow posts, and other coding sources.

Verified curl example from the official docs:

```bash
curl -X POST 'https://api.exa.ai/context' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "how to use React hooks for state management",
    "tokensNum": 5000
  }'
```

Verified documented `tokensNum` behavior:

- default is `"dynamic"`
- accepts explicit token counts

Use `/context` when the user wants code snippets or implementation context, not general web pages.

## Python SDK

Official reference:

- `https://exa.ai/docs/sdks/python-sdk`

Verified official example:

```python
from exa_py import Exa

exa = Exa()  # reads EXA_API_KEY from environment
results = exa.search(
    "blog post about artificial intelligence",
    contents={"highlights": {"max_characters": 4000}},
)
```

Use the Python SDK when the user wants Python specifically. Otherwise, `curl` keeps transport details clearer.

## Rate limits

Official reference:

- `https://exa.ai/docs/reference/rate-limits`

Verified defaults from the rate-limit page:

- `/search`: `10 QPS`
- `/contents`: `100 QPS`
- `/answer`: `10 QPS`
- `/research`: `15 concurrent tasks`

The docs explicitly distinguish QPS-limited endpoints from the concurrent-task limit used by Research.

## Recommended patterns

- Start with `/search` when the task begins as open-ended discovery.
- Follow with `/contents` only for the subset of URLs you actually need.
- Use `/findSimilar` to broaden around a high-quality seed source.
- Use `/answer` for one grounded response with citations.
- Use Research for long-running or schema-constrained work, and make polling explicit in examples.
- Use `/context` only for coding workflows.
