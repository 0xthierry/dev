#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/browser-diagnostics.sh
source "$ROOT/install/browser-diagnostics.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

# Arrange: exercise the checked-in package contract with the Bun runtime that
# setup uses, without installing dependencies or changing the repository.
REAL_BUN="$(command -v bun)" || fail "Bun is required to verify the frozen lockfile"
LOCKFILE_FIXTURE="$TEMP/lockfile compatibility"
mkdir -p "$LOCKFILE_FIXTURE"
cp "$ROOT/configs/browser-diagnostics/package.json" "$ROOT/configs/browser-diagnostics/bun.lock" "$LOCKFILE_FIXTURE/"
cp "$LOCKFILE_FIXTURE/bun.lock" "$TEMP/bun.lock.before"

# Act
(
  cd "$LOCKFILE_FIXTURE"
  "$REAL_BUN" install --lockfile-only --frozen-lockfile --ignore-scripts > "$TEMP/lockfile.log"
) || fail "checked-in frozen lockfile is incompatible with the setup Bun runtime"

# Assert
cmp -s "$TEMP/bun.lock.before" "$LOCKFILE_FIXTURE/bun.lock" || fail "frozen install changed the checked-in package contract"
[[ ! -e "$LOCKFILE_FIXTURE/node_modules" ]] || fail "lockfile verification installed dependencies"
printf 'ok: checked-in frozen lockfile is accepted without dependency writes\n'

# Arrange: a separate package and HOME exercise the installer without touching
# real browser state or downloading dependencies. Spaces test command quoting.
export REPO_ROOT="$TEMP/repo with spaces"
export HOME="$TEMP/home with spaces"
export COMMAND_LOG="$TEMP/commands.log"
mkdir -p "$REPO_ROOT/configs/browser-diagnostics/bin" "$TEMP/bin" "$HOME"
printf '{}\n' > "$REPO_ROOT/configs/browser-diagnostics/package.json"
printf '{}\n' > "$REPO_ROOT/configs/browser-diagnostics/bun.lock"
for command in chrome-devtools-cli browser-diagnostics; do
  printf '#!/usr/bin/env bash\nprintf "diagnostics fixture\\n"\n' > "$REPO_ROOT/configs/browser-diagnostics/bin/$command"
  chmod +x "$REPO_ROOT/configs/browser-diagnostics/bin/$command"
done
cat > "$TEMP/bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s\n' "$PWD" "$*" >> "$COMMAND_LOG"
exit "${BUN_FAIL:-0}"
EOF
printf '#!/usr/bin/env bash\nexit 0\n' > "$TEMP/bin/node"
chmod +x "$TEMP/bin/bun" "$TEMP/bin/node"
export PATH="$TEMP/bin:$PATH"

# Act: dry-run must not install dependencies, make directories, or start tools.
DRY_RUN=1 apply_browser_diagnostics > "$TEMP/dry-run.log"

# Assert
[[ ! -e "$COMMAND_LOG" ]] || fail "dry-run invoked the package manager"
[[ ! -e "$HOME/.local" ]] || fail "dry-run changed HOME"
grep -Eq 'bun.*install.*--frozen-lockfile.*--ignore-scripts' "$TEMP/dry-run.log" || fail "dry-run omitted dependency installation"
printf 'ok: dry-run reports installation without writes or processes\n'

# Arrange: a failed package install must not publish launchers.
# Act
if (export DRY_RUN=0 BUN_FAIL=23; apply_browser_diagnostics > "$TEMP/failed.log" 2>&1); then
  fail "failed dependency installation succeeded"
fi

# Assert
[[ ! -e "$HOME/.local/bin" ]] || fail "failed install published launchers"
printf 'ok: failed dependency install does not publish launchers\n'

# Arrange: preserve a user's existing executable before linking the new command.
mkdir -p "$HOME/.local/bin"
printf 'user-owned command\n' > "$HOME/.local/bin/browser-diagnostics"

# Act
DRY_RUN=0 apply_browser_diagnostics > "$TEMP/install.log"

# Assert
for command in chrome-devtools-cli browser-diagnostics; do
  [[ "$(readlink "$HOME/.local/bin/$command")" == "$REPO_ROOT/configs/browser-diagnostics/bin/$command" ]] || fail "wrong installed command: $command"
done
grep -Fxq 'user-owned command' "$HOME/.local/bin/browser-diagnostics.bak" || fail "existing command not preserved"
grep -Fxq "$REPO_ROOT/configs/browser-diagnostics|install --frozen-lockfile --ignore-scripts" "$COMMAND_LOG" || fail "dependencies not installed with the pinned package contract"
printf 'ok: installs pinned dependencies and preserves an existing command\n'

# Act
DRY_RUN=0 apply_browser_diagnostics > "$TEMP/repeated.log"

# Assert
[[ ! -e "$HOME/.local/bin/browser-diagnostics.bak.1" ]] || fail "repeat install created another backup"
grep -Fxq 'user-owned command' "$HOME/.local/bin/browser-diagnostics.bak" || fail "repeat install changed original backup"
printf 'ok: repeated setup preserves links and backups\n'

# Arrange: an unrelated symlink must not be silently replaced or reported installed.
rm "$HOME/.local/bin/chrome-devtools-cli"
printf 'foreign target\n' > "$TEMP/foreign"
ln -s "$TEMP/foreign" "$HOME/.local/bin/chrome-devtools-cli"

# Act
if DRY_RUN=0 apply_browser_diagnostics > "$TEMP/conflict.log" 2>&1; then
  fail "unrelated command symlink was accepted"
fi

# Assert
[[ "$(readlink "$HOME/.local/bin/chrome-devtools-cli")" == "$TEMP/foreign" ]] || fail "unrelated symlink was modified"
printf 'ok: unrelated command symlink fails closed\n'

# Act / Assert: normal host configuration opts desktops in, not the remote server.
for host in omarchy macbook; do
  (
    # shellcheck disable=SC1090
    source "$ROOT/install/hosts/$host.sh"
    [[ " ${HOST_CONFIG_TARGETS[*]} " == *" browser-diagnostics "* ]]
  ) || fail "$host is missing browser diagnostics"
done
(
  # shellcheck source=install/hosts/dev.sh
  source "$ROOT/install/hosts/dev.sh"
  [[ " ${HOST_CONFIG_TARGETS[*]} " != *" browser-diagnostics "* ]]
) || fail "remote dev host unexpectedly installs desktop diagnostics"
printf 'ok: diagnostics runtime is selected only by desktop hosts\n'
