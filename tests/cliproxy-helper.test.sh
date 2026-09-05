#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" CAPTURE="$tmp/args" CAPTURE_ENV="$tmp/env"
mkdir -p "$HOME/.config/cliproxyapi" "$HOME/.local/bin" "$tmp/bin"
printf '%064d\n' 1 > "$HOME/.config/cliproxyapi/api-key"
touch "$HOME/.config/cliproxyapi/config.yaml"
cat > "$tmp/bin/mock" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$CAPTURE"
printf '%s' "${CLIPROXY_API_KEY:-}" > "$CAPTURE_ENV"
EOF
chmod +x "$tmp/bin/mock"
ln -s "$tmp/bin/mock" "$tmp/bin/pi"
ln -s "$tmp/bin/mock" "$tmp/bin/codex"
ln -s "$tmp/bin/mock" "$HOME/.local/bin/cli-proxy-api"
export PATH="$tmp/bin:$PATH"
"$ROOT/scripts/cliproxy" login
 grep -qx -- '--codex-device-login' "$CAPTURE"
"$ROOT/scripts/cliproxy" pi --model gpt-5.6-sol
 grep -qx -- 'cliproxyapi' "$CAPTURE"
 grep -qx -- 'gpt-5.6-sol' "$CAPTURE"
"$ROOT/scripts/cliproxy" codex exec 'hello world'
 grep -qx -- 'model_provider="cliproxyapi"' "$CAPTURE"
 grep -qx -- 'hello world' "$CAPTURE"
[[ "$(head -1 "$CAPTURE")" == exec ]]
[[ "$(tail -1 "$CAPTURE")" == 'model_provider="cliproxyapi"' ]]
[[ ! -s "$CAPTURE_ENV" ]]
if grep -Fq "$(< "$HOME/.config/cliproxyapi/api-key")" "$CAPTURE"; then
  echo 'not ok: proxy key exposed in arguments' >&2
  exit 1
fi
printf 'bad-key\n' > "$HOME/.config/cliproxyapi/api-key"
if "$ROOT/scripts/cliproxy" codex 2>/dev/null; then
  echo 'not ok: accepted invalid proxy key' >&2
  exit 1
fi
printf 'ok: helper device login, provider selection, argument forwarding, secret handling\n'
