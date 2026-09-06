#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_TMP_DIR=""

cleanup() {
  if [[ -n "$TEST_TMP_DIR" ]]; then
    rm -rf "$TEST_TMP_DIR"
  fi
}

fail() {
  printf 'not ok: %s\n' "$1" >&2
  return 1
}

assert_file_contains() {
  local name="$1"
  local path="$2"
  local expected="$3"

  if grep -Fq -- "$expected" "$path"; then
    printf 'ok: %s\n' "$name"
  else
    fail "$name"
  fi
}

assert_file_excludes() {
  local name="$1"
  local path="$2"
  local unexpected="$3"

  if ! grep -Fq -- "$unexpected" "$path"; then
    printf 'ok: %s\n' "$name"
  else
    fail "$name"
  fi
}

assert_json() {
  local name="$1"
  local path="$2"
  local expression="$3"

  if jq -e "$expression" "$path" >/dev/null; then
    printf 'ok: %s\n' "$name"
  else
    fail "$name"
  fi
}

main() {
  TEST_TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local test_home="$TEST_TMP_DIR/home"
  local claude_state_before="$TEST_TMP_DIR/claude-state-before.json"
  mkdir -p "$test_home/.claude" "$test_home/.codex"

  cat > "$test_home/.codex/config.toml" <<'EOF'
model = "locally-overridden-model"

[mcp_servers.figma]
url = "https://mcp.figma.test/mcp"

[mcp_servers.figma.http_headers]
X-Test-Region = "local"

[local_only]
remove_me = true

[mcp_servers.filesystem]
command = "filesystem-mcp"
args = ["--safe"]

[mcp_servers.filesystem.env]
TEST_TOKEN = "fixture-only"
EOF

  cat > "$test_home/.claude/settings.json" <<'EOF'
{
  "agentPushNotifEnabled": true,
  "env": {
    "PATH": "stale-runtime-path"
  },
  "enabledPlugins": {
    "figma@claude-plugins-official": true,
    "local-mcp@example": false,
    "typescript-lsp@claude-plugins-official": false
  }
}
EOF

  cat > "$test_home/.claude.json" <<'EOF'
{
  "mcpServers": {
    "user-server": {
      "type": "http",
      "url": "https://mcp.example.test"
    }
  }
}
EOF
  cp "$test_home/.claude.json" "$claude_state_before"
  mkdir -p "$test_home/.pi/agent"
  printf '%s\n' '{"providers":{"local-test":{"baseUrl":"http://localhost:1234/v1"}}}' > "$test_home/.pi/agent/models.json"

  HOME="$test_home" "$REPO_ROOT/configs/agents/install.sh" --yes >/dev/null

  assert_json "preserves unrelated Pi provider" "$test_home/.pi/agent/models.json" '.providers["local-test"].baseUrl == "http://localhost:1234/v1"'
  assert_json "adds Pi Responses proxy provider" "$test_home/.pi/agent/models.json" '.providers.cliproxyapi.api == "openai-responses"'
  assert_json "maps the complete pinned Codex catalog without duplicates" "$test_home/.pi/agent/models.json" '
    [.providers.cliproxyapi.models[].id] | sort == [
      "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-mini", "gpt-5.5",
      "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra"
    ]'
  assert_json "preserves Spark text-only input and smaller context" "$test_home/.pi/agent/models.json" '
    .providers.cliproxyapi.models[] | select(.id == "gpt-5.3-codex-spark") |
    .input == ["text"] and .contextWindow == 128000'
  assert_json "preserves image input and context for other Codex models" "$test_home/.pi/agent/models.json" '
    [.providers.cliproxyapi.models[] | select(.id != "gpt-5.3-codex-spark")] |
    all(.input == ["text", "image"] and .contextWindow == 272000)'
  assert_json "keeps conservative proxy output and reasoning settings" "$test_home/.pi/agent/models.json" '
    .providers.cliproxyapi.models | all(
      .maxTokens == 32768 and .reasoning == true and
      .thinkingLevelMap.off == null and .thinkingLevelMap.minimal == null and
      .thinkingLevelMap.xhigh == "xhigh" and
      (if (.id | test("^gpt-(5[.]6-|6-)")) then .thinkingLevelMap.max == "max"
       else (.thinkingLevelMap | has("max") | not) end)
    )'
  assert_json "defaults Pi to proxy" "$test_home/.pi/agent/settings.json" '.defaultProvider == "cliproxyapi"'
  assert_file_contains "defaults Codex to proxy" "$test_home/.codex/config.toml" 'model_provider = "cliproxyapi"'
  assert_file_contains "Codex reads proxy key without environment export" "$test_home/.codex/config.toml" '[model_providers.cliproxyapi.auth]'
  assert_file_contains "adds Codex proxy provider" "$test_home/.codex/config.toml" '[model_providers.cliproxyapi]'
  cp "$test_home/.pi/agent/models.json" "$TEST_TMP_DIR/first-pi-models.json"

  assert_file_contains "preserves Codex Figma MCP server" "$test_home/.codex/config.toml" '[mcp_servers.figma]'
  assert_file_contains "preserves Codex nested MCP table" "$test_home/.codex/config.toml" '[mcp_servers.filesystem.env]'
  assert_file_contains "preserves Codex MCP values" "$test_home/.codex/config.toml" 'TEST_TOKEN = "fixture-only"'
  assert_file_excludes "drops unmanaged Codex settings" "$test_home/.codex/config.toml" '[local_only]'
  assert_file_excludes "replaces unmanaged Codex model" "$test_home/.codex/config.toml" 'locally-overridden-model'

  assert_json "preserves Figma Claude plugin" "$test_home/.claude/settings.json" '.enabledPlugins["figma@claude-plugins-official"] == true'
  assert_json "preserves disabled local Claude plugin" "$test_home/.claude/settings.json" '.enabledPlugins["local-mcp@example"] == false'
  assert_json "canonical Claude plugin value wins" "$test_home/.claude/settings.json" '.enabledPlugins["typescript-lsp@claude-plugins-official"] == true'
  assert_json "drops runtime-injected Claude env" "$test_home/.claude/settings.json" '.env.PATH == null'
  assert_json "drops other local-only Claude settings" "$test_home/.claude/settings.json" '.agentPushNotifEnabled == null'

  if cmp -s "$claude_state_before" "$test_home/.claude.json"; then
    printf 'ok: preserves Claude user-scoped MCP state\n'
  else
    fail "preserves Claude user-scoped MCP state"
  fi

  if command -v python3 >/dev/null; then
    python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$test_home/.codex/config.toml"
    printf 'ok: rendered Codex config is valid TOML\n'
  fi

  local first_codex_config="$TEST_TMP_DIR/first-codex-config.toml"
  local first_claude_settings="$TEST_TMP_DIR/first-claude-settings.json"
  cp "$test_home/.codex/config.toml" "$first_codex_config"
  cp "$test_home/.claude/settings.json" "$first_claude_settings"
  HOME="$test_home" "$REPO_ROOT/configs/agents/install.sh" --yes >/dev/null

  if cmp -s "$test_home/.codex/config.toml" "$first_codex_config" &&
    cmp -s "$test_home/.claude/settings.json" "$first_claude_settings" &&
    cmp -s "$test_home/.pi/agent/models.json" "$TEST_TMP_DIR/first-pi-models.json"; then
    printf 'ok: agent config sync is idempotent\n'
  else
    fail "agent config sync is idempotent"
  fi
}

main "$@"
