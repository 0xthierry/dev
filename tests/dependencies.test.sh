#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/dependencies.sh
source "$ROOT/install/dependencies.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

# Arrange: isolated repo with spaces, fake Bun, and foreign dependencies.
REPO="$TEMP/repo with spaces"
export LEGACY_MODULES="$REPO/configs/agents/pi/extensions/node_modules"
export COMMAND_LOG="$TEMP/commands.log"
BACKUP_ROOT="$REPO/.backups/node_modules"
BACKUP="$BACKUP_ROOT/pi-extension-dependencies.bak"
mkdir -p "$LEGACY_MODULES" "$REPO/other/node_modules" "$TEMP/bin" "$TEMP/no-bun"
printf '{}\n' > "$REPO/package.json"
printf 'legacy data\n' > "$LEGACY_MODULES/marker"
printf 'foreign dependencies\n' > "$REPO/other/node_modules/marker"
cat > "$TEMP/bin/bun" <<'EOF'
#!/bin/bash
set -euo pipefail
legacy=absent
if [[ -e "$LEGACY_MODULES" || -L "$LEGACY_MODULES" ]]; then legacy=present; fi
printf '%s|%s|legacy=%s\n' "$PWD" "$*" "$legacy" >> "$COMMAND_LOG"
if (( ${BUN_FAIL:-0} )); then exit "$BUN_FAIL"; fi
mkdir -p node_modules
printf 'root installed\n' > node_modules/marker
EOF
chmod +x "$TEMP/bin/bun"
export PATH="$TEMP/bin:$PATH"

# Act: missing root manifest must skip installation and migration.
DRY_RUN=0 install_repo_dependencies "$TEMP" > "$TEMP/no-manifest.log"

# Assert
[[ ! -e "$COMMAND_LOG" ]] || fail "missing manifest invoked Bun"
[[ ! -e "$BACKUP_ROOT" ]] || fail "missing manifest created backups"
printf 'ok: missing root manifest skips installation and migration\n'

# Act: an empty PATH ensures no real Bun can be invoked.
DRY_RUN=0 PATH="$TEMP/no-bun" install_repo_dependencies "$REPO" > "$TEMP/no-bun.log"

# Assert
[[ ! -e "$COMMAND_LOG" ]] || fail "missing Bun invoked a command"
[[ ! -e "$BACKUP_ROOT" ]] || fail "missing Bun created backups"
grep -Fxq 'legacy data' "$LEGACY_MODULES/marker" || fail "missing Bun moved legacy data"
printf 'ok: unavailable Bun preserves the legacy dependency tree\n'

# Act
DRY_RUN=1 install_repo_dependencies "$REPO" > "$TEMP/dry-run.log"

# Assert
[[ ! -e "$COMMAND_LOG" ]] || fail "dry-run invoked Bun"
[[ ! -e "$REPO/node_modules" ]] || fail "dry-run installed root dependencies"
[[ ! -e "$BACKUP_ROOT" ]] || fail "dry-run created backup directories"
grep -Fxq 'legacy data' "$LEGACY_MODULES/marker" || fail "dry-run moved legacy data"
grep -q -- '--frozen-lockfile' "$TEMP/dry-run.log" || fail "dry-run omitted frozen installation"
grep -q 'pi-extension-dependencies.bak' "$TEMP/dry-run.log" || fail "dry-run omitted backup migration"
printf 'ok: dry-run reports frozen installation and backup without mutation\n'

# Act: invoke through a conditional to verify explicit failure propagation.
if DRY_RUN=0 BUN_FAIL=23 install_repo_dependencies "$REPO" > "$TEMP/failed.log" 2>&1; then
  fail "failed root install succeeded"
else
  status=$?
fi

# Assert
[[ "$status" -eq 23 ]] || fail "failed root install changed the exit status"
[[ ! -e "$BACKUP_ROOT" ]] || fail "failed root install created backups"
grep -Fxq 'legacy data' "$LEGACY_MODULES/marker" || fail "failed root install moved legacy data"
printf 'ok: failed frozen install preserves legacy data and failure status\n'

# Arrange: collisions must preserve both directory and symlink backups.
mkdir -p "$BACKUP" "$TEMP/foreign"
printf 'previous backup\n' > "$BACKUP/marker"
printf 'foreign target\n' > "$TEMP/foreign/marker"
ln -s "$TEMP/foreign" "$BACKUP.1"
: > "$COMMAND_LOG"

# Act
DRY_RUN=0 install_repo_dependencies "$REPO" > "$TEMP/install.log"

# Assert
[[ ! -e "$LEGACY_MODULES" ]] || fail "successful install left legacy dependencies active"
grep -Fxq 'root installed' "$REPO/node_modules/marker" || fail "root dependencies not installed"
grep -Fxq "$REPO|install --frozen-lockfile|legacy=present" "$COMMAND_LOG" || fail "Bun did not run before migration with the frozen root contract"
grep -Fxq 'legacy data' "$BACKUP.2/marker" || fail "legacy data not preserved in a unique backup"
grep -Fxq 'previous backup' "$BACKUP/marker" || fail "previous backup changed"
[[ "$(readlink "$BACKUP.1")" == "$TEMP/foreign" ]] || fail "backup collision symlink changed"
grep -Fxq 'foreign target' "$TEMP/foreign/marker" || fail "foreign target changed"
grep -Fxq 'foreign dependencies' "$REPO/other/node_modules/marker" || fail "unrelated dependency tree changed"
[[ ! -e "$LEGACY_MODULES.bak" ]] || fail "backup was left inside extension scans"
printf 'ok: successful root install moves only legacy bundle dependencies to a unique external backup\n'

# Act
DRY_RUN=0 install_repo_dependencies "$REPO" > "$TEMP/repeated.log"

# Assert
[[ ! -e "$BACKUP.3" ]] || fail "repeat install created another backup"
grep -Fxq 'legacy data' "$BACKUP.2/marker" || fail "repeat install changed preserved data"
grep -Fxq "$REPO|install --frozen-lockfile|legacy=absent" "$COMMAND_LOG" || fail "repeat install did not reinstall root dependencies"
printf 'ok: repeated setup leaves preserved backups unchanged\n'

# Arrange: a recreated legacy tree is preserved separately on the next run.
mkdir -p "$LEGACY_MODULES"
printf 'recreated legacy data\n' > "$LEGACY_MODULES/marker"

# Act
DRY_RUN=0 install_repo_dependencies "$REPO" > "$TEMP/recreated.log"

# Assert
[[ ! -e "$LEGACY_MODULES" ]] || fail "recreated legacy dependencies remain active"
grep -Fxq 'recreated legacy data' "$BACKUP.3/marker" || fail "recreated dependencies were not preserved"
grep -Fxq 'legacy data' "$BACKUP.2/marker" || fail "recreated migration changed an earlier backup"
printf 'ok: recreated legacy dependencies converge without overwriting earlier backups\n'
