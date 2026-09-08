#!/bin/sh
# Browser services need the existing ChatGPT OAuth login, not the user's model proxy.
# This override is local to the sidecar's app-server; it never rewrites Codex config.
set -eu
: "${BROWSER_USE_CODEX_CLI:?Browser Use requires the bundled Codex CLI}"
exec "$BROWSER_USE_CODEX_CLI" -c 'model_provider="openai"' "$@"
