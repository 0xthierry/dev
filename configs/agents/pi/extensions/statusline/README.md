# Pi Statusline

Adds a compact custom segment to Pi's existing footer with:

- Clickable GitHub PR number from `gh pr view`, falling back to PR markers in the branch name (`pr-123`, `pull/123`, `#123`) plus the repository's GitHub remote.
- Working-tree changes as added/removed lines, changed tracked files, untracked files, and binary files.
- Cloudflare BDR quote from Yahoo Finance (`N2ET34.SA`) in BRL, always shown by default when a quote is available.

The extension uses `ctx.ui.setStatus()`, so it appends to the normal Pi footer instead of replacing it.

## Configuration

Environment variables:

| Variable | Default | Description |
|---|---:|---|
| `PI_STATUSLINE_REFRESH_MS` | `60000` | Polling interval for footer refreshes. |
| `PI_STATUSLINE_STOCK_SYMBOL` | `N2ET34.SA` | Yahoo Finance symbol. Set to `off`, `false`, `0`, `none`, or an empty string to disable stock quotes. |
| `PI_STATUSLINE_STOCK_LABEL` | `NET` | Label shown before the quote. |
| `PI_STATUSLINE_STOCK_MAX_PRICE` | `off` | Hide the stock segment unless the quote is below this price. The default has no price threshold, so fetched quotes are always shown. |
| `PI_STATUSLINE_STOCK_TTL_MS` | `300000` | In-memory quote cache TTL. |
| `PI_STATUSLINE_STOCK_TIMEOUT_MS` | `2000` | Quote fetch timeout. |

Examples:

```bash
# Defaults: Cloudflare BDR, BRL, always shown when fetched
pi

# Only show the BDR quote while it is below R$50
PI_STATUSLINE_STOCK_MAX_PRICE=50 pi

# Disable stock quote, keep PR/change segments
PI_STATUSLINE_STOCK_SYMBOL=off pi
```
