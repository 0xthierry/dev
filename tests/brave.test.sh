#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/configs.sh
source "$ROOT/install/configs.sh"
# shellcheck source=install/hosts/omarchy.sh
source "$ROOT/install/hosts/omarchy.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

export REPO_ROOT="$ROOT"
export HOME="$TEMP/home with spaces"
export COMMAND_LOG="$TEMP/commands.log"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$TEMP/bin"
cat > "$TEMP/bin/update-desktop-database" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$COMMAND_LOG"
EOF
export DEFAULT_BROWSER_STATE="$TEMP/default-browser"
printf 'brave-browser.desktop\n' > "$DEFAULT_BROWSER_STATE"
cat > "$TEMP/bin/xdg-settings" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  get)
    cat "$DEFAULT_BROWSER_STATE"
    ;;
  set)
    printf 'xdg-settings %s\n' "$*" >> "$COMMAND_LOG"
    printf '%s\n' "$3" > "$DEFAULT_BROWSER_STATE"
    ;;
  *)
    exit 2
    ;;
esac
EOF
chmod +x "$TEMP/bin/update-desktop-database" "$TEMP/bin/xdg-settings"
export PATH="$TEMP/bin:$PATH"

# Arrange: setup must preserve drifted/user-owned entries before converging.
printf 'old desktop entry\n' > "$HOME/.local/share/applications/brave-browser.desktop"
printf 'old brave command\n' > "$HOME/.local/bin/brave"

# Act
DRY_RUN=0 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/install.log"

# Assert: all launch names converge on the one wrapper that adds loopback CDP.
for command in brave-wrapper brave brave-browser brave-browser-stable; do
  [[ "$(readlink "$HOME/.local/bin/$command")" == "$ROOT/configs/brave/brave-wrapper" ]] \
    || fail "wrong Brave command link: $command"
done
[[ "$(readlink "$HOME/.local/share/applications/brave-browser.desktop")" == "$ROOT/configs/brave/brave-browser.desktop" ]] \
  || fail "desktop entry did not converge to the repo source"
grep -Fxq 'old brave command' "$HOME/.local/bin/brave.bak" || fail "existing Brave command was not preserved"
grep -Fxq 'old desktop entry' "$HOME/.local/share/applications/brave-browser.desktop.bak" \
  || fail "drifted desktop entry was not preserved"
grep -Fxq "$HOME/.local/share/applications" "$COMMAND_LOG" || fail "desktop database was not refreshed"
printf 'ok: every Brave launch name and the desktop entry converge on repo-owned CDP configuration\n'

# Act: rerunning setup must be a no-op for links and backups.
DRY_RUN=0 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/repeated.log"

# Assert
[[ ! -e "$HOME/.local/bin/brave.bak.1" ]] || fail "repeat install created another Brave backup"
[[ ! -e "$HOME/.local/share/applications/brave-browser.desktop.bak.1" ]] \
  || fail "repeat install created another desktop backup"
printf 'ok: repeated Brave setup is idempotent\n'

# Act: dry-run reports every link without changing a fresh HOME.
export HOME="$TEMP/dry run home"
DRY_RUN=1 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/dry-run.log"

# Assert
[[ ! -e "$HOME" ]] || fail "dry-run changed HOME"
for command in brave-wrapper brave brave-browser brave-browser-stable; do
  grep -Fq "Brave command $command: linked" "$TEMP/dry-run.log" || fail "dry-run omitted $command"
done
printf 'ok: Brave dry-run reports complete configuration without writes\n'

# Act: an already-correct default must not rewrite the managed desktop symlink.
: > "$COMMAND_LOG"
DRY_RUN=0 set_default_browser_brave > "$TEMP/default-current.log"

# Assert
! grep -Fq 'xdg-settings set' "$COMMAND_LOG" || fail "current Brave default was rewritten"
[[ "$(cat "$DEFAULT_BROWSER_STATE")" == 'brave-browser.desktop' ]] || fail "current Brave default changed"
printf 'ok: current Brave default is left untouched\n'

# Act: a different default still converges through xdg-settings.
printf 'firefox.desktop\n' > "$DEFAULT_BROWSER_STATE"
DRY_RUN=0 set_default_browser_brave > "$TEMP/default-change.log"

# Assert
grep -Fxq 'xdg-settings set default-web-browser brave-browser.desktop' "$COMMAND_LOG" \
  || fail "different browser default was not updated"
[[ "$(cat "$DEFAULT_BROWSER_STATE")" == 'brave-browser.desktop' ]] || fail "Brave did not become the default"
printf 'ok: different browser default converges to Brave\n'
