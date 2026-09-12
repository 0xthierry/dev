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

  # Arrange: preserve both user-owned files and symlinks when deploying global instructions.
  printf '%s\n' 'Existing Codex instructions' > "$test_home/.codex/AGENTS.md"
  printf '%s\n' 'Existing Claude instructions' > "$TEST_TMP_DIR/claude-instructions.md"
  ln -s "$TEST_TMP_DIR/claude-instructions.md" "$test_home/.claude/CLAUDE.md"

  # Act / Assert: dry-run must not replace instructions or deploy new resources.
  HOME="$test_home" "$REPO_ROOT/configs/agents/install.sh" --yes --dry-run > "$TEST_TMP_DIR/dry-run.log"
  assert_file_contains "dry-run preserves Codex instructions" "$test_home/.codex/AGENTS.md" 'Existing Codex instructions'
  [[ ! -e "$test_home/.pi/agent/AGENTS.md" ]] || fail "dry-run created global Pi instructions"
  [[ ! -e "$test_home/.pi/agent/skills/writing-pr" ]] || fail "dry-run installed writing-pr"
  [[ ! -e "$test_home/.pi/agent/agents/advisor.md" ]] || fail "dry-run installed advisor"
  [[ ! -e "$test_home/.pi/agent/skills/engineering-principles" ]] || fail "dry-run installed engineering-principles"
  assert_file_contains "dry-run includes global instructions" "$TEST_TMP_DIR/dry-run.log" 'pi AGENTS.md'

  # Act
  HOME="$test_home" "$REPO_ROOT/configs/agents/install.sh" --yes >/dev/null

  # Assert
  local target
  for target in .agents/AGENTS.md .codex/AGENTS.md .claude/CLAUDE.md .pi/agent/AGENTS.md; do
    [[ -L "$test_home/$target" ]] || fail "missing global instructions link: $target"
    [[ "$(readlink "$test_home/$target")" == "$REPO_ROOT/configs/agents/AGENTS.md" ]] || fail "wrong global instructions source: $target"
  done
  assert_file_contains "backs up existing Codex instructions" "$test_home/.codex/AGENTS.md.bak" 'Existing Codex instructions'
  [[ -L "$test_home/.claude/CLAUDE.md.bak" ]] || fail "did not preserve Claude instructions symlink"
  assert_file_contains "preserves Claude symlink target" "$TEST_TMP_DIR/claude-instructions.md" 'Existing Claude instructions'
  for target in .agents .codex .claude .pi/agent; do
    [[ "$(readlink "$test_home/$target/skills/writing-pr")" == "$REPO_ROOT/configs/agents/skills/writing-pr" ]] || fail "missing writing-pr skill link: $target"
    assert_file_contains "deploys writing-pr into $target" "$test_home/$target/skills/writing-pr/SKILL.md" 'name: writing-pr'
  done

  # Assert: file-backed profiles and progressively disclosed references survive installation unchanged.
  local profile reference
  for profile in advisor worker; do
    cmp -s "$test_home/.pi/agent/agents/$profile.md" "$REPO_ROOT/configs/agents/agents/$profile.md" || fail "Pi did not preserve $profile profile"
    printf 'ok: Pi deploys the unchanged %s profile\n' "$profile"
  done
  for target in .agents .codex .claude .pi/agent; do
    [[ "$(readlink "$test_home/$target/skills/engineering-principles")" == "$REPO_ROOT/configs/agents/skills/engineering-principles" ]] || fail "missing engineering-principles skill link: $target"
    for reference in "$REPO_ROOT/configs/agents/skills/engineering-principles/SKILL.md" "$REPO_ROOT/configs/agents/skills/engineering-principles/references/"*.md; do
      local relative="${reference#"$REPO_ROOT/configs/agents/skills/engineering-principles/"}"
      cmp -s "$test_home/$target/skills/engineering-principles/$relative" "$reference" || fail "installer did not preserve $target engineering-principles/$relative"
    done
    printf 'ok: %s deploys every engineering principle reference unchanged\n' "$target"
  done

  local skill
  for target in .agents .codex .claude .pi/agent; do
    for skill in browser-diagnostics web-performance-investigation; do
      [[ "$(readlink "$test_home/$target/skills/$skill")" == "$REPO_ROOT/configs/agents/skills/$skill" ]] || fail "missing $skill skill link: $target"
      cmp -s "$test_home/$target/skills/$skill/SKILL.md" "$REPO_ROOT/configs/agents/skills/$skill/SKILL.md" || fail "installer rewrote $skill for $target"
    done
    cmp -s "$test_home/$target/skills/browser-diagnostics/references/mcp-tools.md" "$REPO_ROOT/configs/agents/skills/browser-diagnostics/references/mcp-tools.md" || fail "missing progressively disclosed MCP reference: $target"
  done
  assert_file_excludes "does not register Chrome DevTools MCP in Codex" "$test_home/.codex/config.toml" 'chrome-devtools'
  assert_file_excludes "does not register diagnostics as a Pi extension" "$test_home/.pi/agent/settings.json" 'chrome-devtools'
  printf 'ok: installs diagnostics as shared skills without native MCP registration\n'

  [[ "$(readlink "$test_home/.pi/agent/skills/agent-browser")" == "$REPO_ROOT/configs/agents/skills/agent-browser" ]] || fail "missing original agent-browser skill in Pi"
  cmp -s "$test_home/.pi/agent/skills/agent-browser/SKILL.md" "$REPO_ROOT/configs/agents/skills/agent-browser/SKILL.md" || fail "Pi rewrote agent-browser skill"
  [[ "$(readlink "$test_home/.pi/agent/skills/control-browser")" == "$REPO_ROOT/configs/agents/pi/extensions/browser-use/skills/control-browser" ]] || fail "missing control-browser skill in Pi"
  printf 'ok: Pi installs both browser skills without rewriting agent-browser\n'

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
  assert_json "defaults Pi sessions to Sol" "$test_home/.pi/agent/settings.json" '.defaultModel == "gpt-5.6-sol"'
  assert_json "defaults Pi sessions to high reasoning" "$test_home/.pi/agent/settings.json" '.defaultThinkingLevel == "high"'
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

  # Assert: re-running setup must leave the links and their first backups unchanged.
  for target in .agents/AGENTS.md .codex/AGENTS.md .claude/CLAUDE.md .pi/agent/AGENTS.md; do
    [[ "$(readlink "$test_home/$target")" == "$REPO_ROOT/configs/agents/AGENTS.md" ]] || fail "global instructions link changed: $target"
    [[ ! -e "$test_home/$target.bak.1" && ! -L "$test_home/$target.bak.1" ]] || fail "repeated global instructions backup: $target"
  done
  assert_file_contains "retains original Codex backup" "$test_home/.codex/AGENTS.md.bak" 'Existing Codex instructions'
  assert_file_contains "retains original Claude backup" "$test_home/.claude/CLAUDE.md.bak" 'Existing Claude instructions'

  if cmp -s "$test_home/.codex/config.toml" "$first_codex_config" &&
    cmp -s "$test_home/.claude/settings.json" "$first_claude_settings" &&
    cmp -s "$test_home/.pi/agent/models.json" "$TEST_TMP_DIR/first-pi-models.json"; then
    printf 'ok: agent config sync is idempotent\n'
  else
    fail "agent config sync is idempotent"
  fi
}

main "$@"
