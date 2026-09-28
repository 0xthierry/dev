#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CAPTURE="$tmp/args" CAPTURE_ENV="$tmp/env" SERVICE_CAPTURE="$tmp/service"
mkdir -p "$HOME/.config/cliproxyapi" "$HOME/.local/bin" "$tmp/bin"
printf '%064d\n' 1 > "$HOME/.config/cliproxyapi/api-key"
touch "$HOME/.config/cliproxyapi/config.yaml"
cat > "$tmp/bin/mock" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE"
printf '%s' "${CLIPROXY_API_KEY:-}" > "$CAPTURE_ENV"
EOF
cat > "$tmp/bin/uname" <<'EOF'
#!/bin/sh
[ "$1" = -s ] && printf 'Linux\n'
EOF
cat > "$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
if [ "$1 $2 $3" = "--user is-active --quiet" ]; then
  exit 0
fi
printf '%s\n' "$*" >> "$SERVICE_CAPTURE"
EOF
chmod +x "$tmp/bin/mock" "$tmp/bin/uname" "$tmp/bin/systemctl"
ln -s "$tmp/bin/mock" "$tmp/bin/pi"
cat > "$tmp/bin/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$CAPTURE"
[[ "$ANTHROPIC_BASE_URL" == http://127.0.0.1:8317 ]]
[[ "$ANTHROPIC_AUTH_TOKEN" == "$(< "$HOME/.config/cliproxyapi/api-key")" ]]
[[ ! -v ANTHROPIC_API_KEY && ! -v CLAUDE_CODE_OAUTH_TOKEN ]]
[[ ! -v CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR ]]
[[ ! -v CLAUDE_CODE_USE_BEDROCK && ! -v CLAUDE_CODE_USE_VERTEX && ! -v CLAUDE_CODE_USE_FOUNDRY ]]
EOF
chmod +x "$tmp/bin/claude"
ln -s "$tmp/bin/mock" "$HOME/.local/bin/cli-proxy-api"
export PATH="$tmp/bin:$PATH"
"$ROOT/scripts/cliproxy" login
 grep -qx -- '--codex-device-login' "$CAPTURE"
 grep -qx -- '--user restart cliproxyapi.service' "$SERVICE_CAPTURE"
"$ROOT/scripts/cliproxy" login-claude --no-browser
 grep -qx -- '--claude-login' "$CAPTURE"
 grep -qx -- '--no-browser' "$CAPTURE"
 grep -qx -- "$HOME/.config/cliproxyapi/config.yaml" "$CAPTURE"
[[ $(wc -l < "$SERVICE_CAPTURE") -eq 2 ]]
# A failed OAuth login must not restart the service.
rm "$HOME/.local/bin/cli-proxy-api"
printf '#!/bin/sh\nexit 1\n' > "$HOME/.local/bin/cli-proxy-api"
chmod +x "$HOME/.local/bin/cli-proxy-api"
if "$ROOT/scripts/cliproxy" login-claude; then
  echo 'not ok: ignored failed Claude login' >&2
  exit 1
fi
[[ $(wc -l < "$SERVICE_CAPTURE") -eq 2 ]]
rm "$HOME/.local/bin/cli-proxy-api"
ln -s "$tmp/bin/mock" "$HOME/.local/bin/cli-proxy-api"
ANTHROPIC_API_KEY=unwanted CLAUDE_CODE_OAUTH_TOKEN=unwanted \
CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=9 \
CLAUDE_CODE_USE_BEDROCK=1 CLAUDE_CODE_USE_VERTEX=1 CLAUDE_CODE_USE_FOUNDRY=1 \
ANTHROPIC_BASE_URL=https://example.invalid ANTHROPIC_AUTH_TOKEN=unwanted \
  "$ROOT/scripts/cliproxy" claude --model sonnet -p 'Reply with OK'
 grep -qx -- 'sonnet' "$CAPTURE"
 grep -qx -- 'Reply with OK' "$CAPTURE"
if grep -Fq "$(< "$HOME/.config/cliproxyapi/api-key")" "$CAPTURE"; then
  echo 'not ok: Claude proxy key exposed in arguments' >&2
  exit 1
fi
"$ROOT/scripts/cliproxy" pi
 grep -qx -- 'cliproxyapi' "$CAPTURE"
 grep -qx -- 'gpt-6-sol' "$CAPTURE"
 grep -qx -- 'high' "$CAPTURE"
"$ROOT/scripts/cliproxy" pi --model gpt-6-luna
 grep -qx -- 'gpt-6-luna' "$CAPTURE"
if "$ROOT/scripts/cliproxy" codex 2>/dev/null; then
  echo 'not ok: helper still accepts Codex as a proxy client' >&2
  exit 1
fi
[[ ! -s "$CAPTURE_ENV" ]]
if grep -Fq "$(< "$HOME/.config/cliproxyapi/api-key")" "$CAPTURE"; then
  echo 'not ok: proxy key exposed in arguments' >&2
  exit 1
fi
printf 'bad-key\n' > "$HOME/.config/cliproxyapi/api-key"
if "$ROOT/scripts/cliproxy" pi 2>/dev/null; then
  echo 'not ok: accepted invalid proxy key' >&2
  exit 1
fi
if "$ROOT/scripts/cliproxy" claude 2>/dev/null; then
  echo 'not ok: Claude launcher accepted invalid proxy key' >&2
  exit 1
fi
printf 'ok: Codex/Claude login, failed-login handling, Pi/Claude routing, argument forwarding, secret handling\n'
