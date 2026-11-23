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

# Exercise the shared installer entry point without fetching vendor scripts.
# An empty fixture npm root makes retained package installs visible in the plan.
ln -s /usr/bin/true "$TEST_TMP_DIR/bin/npm"
ln -s /usr/bin/true "$TEST_TMP_DIR/bin/go"
DRY_RUN=1 bash "$REPO_ROOT/install/ai-cli.sh" > "$TEST_TMP_DIR/ai-cli.plan"
grep -Fq '@openai/codex@' "$TEST_TMP_DIR/ai-cli.plan"
grep -Fq '@railway/cli@' "$TEST_TMP_DIR/ai-cli.plan"
if grep -Ei 'factory\.ai|factory cli|droid' "$TEST_TMP_DIR/ai-cli.plan"; then
  printf 'error: shared installer still manages Factory/Droid\n' >&2
  exit 1
fi
printf 'ok: shared installer plans Codex and Railway without Factory/Droid\n'

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

# A fresh official CLI is named agy; an editor executable named antigravity
# must neither be required nor mistaken for the CLI. Keep real command lookup
# restricted to fixture executables so installed host agents cannot leak in.
check_installed() { PATH="$TEST_TMP_DIR/bin" command -v "$1" >/dev/null 2>&1; }
printf '#!/bin/sh\nexit 0\n' > "$TEST_TMP_DIR/bin/agy"
chmod +x "$TEST_TMP_DIR/bin/agy"
: > "$HOME/herdr.log"
: > "$HOME/moshi.log"
configure_herdr_agent_integrations
configure_moshi_agent_hooks
printf 'integration install claude\nintegration install antigravity-cli\n' > "$TEST_TMP_DIR/herdr.expected"
printf 'install --target claude\ninstall --target antigravity\n' > "$TEST_TMP_DIR/moshi.expected"
cmp "$TEST_TMP_DIR/herdr.expected" "$HOME/herdr.log"
cmp "$TEST_TMP_DIR/moshi.expected" "$HOME/moshi.log"
printf 'ok: fresh agy CLI receives Herdr and Moshi integration with existing target IDs\n'

# Setup writes shell init but cannot change the PATH of the invoking shell.
mkdir -p "$HOME/.local/bin"
mv "$TEST_TMP_DIR/bin/agy" "$HOME/.local/bin/agy"
: > "$HOME/herdr.log"
: > "$HOME/moshi.log"
configure_herdr_agent_integrations
configure_moshi_agent_hooks
cmp "$TEST_TMP_DIR/herdr.expected" "$HOME/herdr.log"
cmp "$TEST_TMP_DIR/moshi.expected" "$HOME/moshi.log"
printf 'ok: freshly installed ~/.local/bin/agy receives both integrations before shell reload\n'

mv "$HOME/.local/bin/agy" "$TEST_TMP_DIR/bin/antigravity"
: > "$HOME/herdr.log"
: > "$HOME/moshi.log"
configure_herdr_agent_integrations
configure_moshi_agent_hooks
printf 'integration install claude\n' > "$TEST_TMP_DIR/herdr.expected"
printf 'install --target claude\n' > "$TEST_TMP_DIR/moshi.expected"
cmp "$TEST_TMP_DIR/herdr.expected" "$HOME/herdr.log"
cmp "$TEST_TMP_DIR/moshi.expected" "$HOME/moshi.log"
printf 'ok: Antigravity editor alone does not enable CLI integrations\n'
