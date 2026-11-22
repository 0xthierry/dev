#!/usr/bin/env bash
# Fixture commands are invoked by the sourced installers.
# shellcheck disable=SC2329
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_TMP_DIR"' EXIT
export HOME="$TEST_TMP_DIR/home"
export PATH="$TEST_TMP_DIR/bin:/usr/bin:/bin"
mkdir -p "$HOME" "$TEST_TMP_DIR/bin"
# shellcheck source=install/ai-cli.sh
source "$REPO_ROOT/install/ai-cli.sh"
cat > "$TEST_TMP_DIR/bin/pinned-tool" <<'EOF'
#!/usr/bin/env bash
printf 'pinned-tool 1.2.3\n'
EOF
chmod +x "$TEST_TMP_DIR/bin/pinned-tool"
installed_binary_is_pinned pinned-tool 1.2.3
if installed_binary_is_pinned pinned-tool 2.0.0; then exit 1; fi
printf 'ok: pinned version detection accepts matching and rejects other versions\n'

# Exercise the actual integration reconciliation with installed retired binaries
# AND previously configured retired hooks. Only retained agents may be refreshed.
# shellcheck source=install/herdr.sh
source "$REPO_ROOT/install/herdr.sh"
# shellcheck source=install/moshi.sh
source "$REPO_ROOT/install/moshi.sh"
cat > "$TEST_TMP_DIR/bin/herdr-fixture" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == 'integration status' ]]; then
  printf '%s\n' 'pi: current version' 'claude: current version' 'amp: current version' 'cursor: current version' 'grok: current version' 'opencode: current version'
else
  printf '%s\n' "$*" >> "$HOME/herdr.log"
fi
EOF
cat > "$TEST_TMP_DIR/bin/moshi-fixture" <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == 'status --json' ]]; then
  printf '%s\n' '{"hooks":[{"target":"pi","status":"current"},{"target":"claude","status":"current"},{"target":"amp","status":"current"},{"target":"cursor","status":"current"},{"target":"grok","status":"current"},{"target":"opencode","status":"current"}]}'
else
  printf '%s\n' "$*" >> "$HOME/moshi.log"
fi
EOF
chmod +x "$TEST_TMP_DIR/bin/"*-fixture
resolve_herdr_bin() { printf '%s\n' "$TEST_TMP_DIR/bin/herdr-fixture"; }
resolve_moshi_hook_bin() { printf '%s\n' "$TEST_TMP_DIR/bin/moshi-fixture"; }
check_installed() {
  case "$1" in claude|codex|amp|cursor-agent|grok|opencode) return 0 ;; *) return 1 ;; esac
}
configure_herdr_agent_integrations
configure_moshi_agent_hooks
printf 'integration install claude\nintegration install codex\n' > "$TEST_TMP_DIR/herdr.expected"
printf 'install --target claude\ninstall --target codex\n' > "$TEST_TMP_DIR/moshi.expected"
cmp "$TEST_TMP_DIR/herdr.expected" "$HOME/herdr.log"
cmp "$TEST_TMP_DIR/moshi.expected" "$HOME/moshi.log"
printf 'ok: Herdr and Moshi refresh retained agents without reviving retired integrations\n'
