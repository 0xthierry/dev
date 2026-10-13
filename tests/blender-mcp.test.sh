#!/usr/bin/env bash
# Filesystem integration fixtures: real installer/helper/launcher, fake uv and
# Blender version probe. No packages, preferences or clients in the real HOME.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/blender-mcp.sh
source "$ROOT/install/blender-mcp.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }
REAL_PYTHON="$(uv python find 3.12)"
export REAL_PYTHON
export REPO_ROOT="$TEMP/repo with spaces"
export COMMAND_LOG="$TEMP/commands.log"
export PYTHONPATH="$TEMP/packages"
mkdir -p "$REPO_ROOT/configs/creative-mcp" "$TEMP/bin" "$PYTHONPATH/blender_mcp" "$PYTHONPATH/mcp_for_blender-2.1.9.dist-info"
cp "$ROOT/configs/creative-mcp/"blender-* "$ROOT/configs/creative-mcp/blender.desktop" "$ROOT/configs/creative-mcp/install-blender-addon.py" "$REPO_ROOT/configs/creative-mcp/"
printf 'Name: mcp-for-blender\nVersion: 2.1.9\n' > "$PYTHONPATH/mcp_for_blender-2.1.9.dist-info/METADATA"
printf 'bl_info = {"name": "MCP for Blender", "version": (2, 1, 9)}\n# pinned bundled fixture\n' > "$PYTHONPATH/blender_mcp/addon.py"
printf 'from pathlib import Path\ndef get_bundled_addon_path():\n    return Path(__file__).parent / "addon.py"\n' > "$PYTHONPATH/blender_mcp/addon_manager.py"
cat > "$TEMP/bin/blender" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'blender|%s\n' "$*" >> "$COMMAND_LOG"
[[ "$*" == --version ]] || exit 91
printf '%s\n' "${BLENDER_VERSION_OUTPUT:-Blender 4.5.2}"
EOF
cat > "$TEMP/bin/uv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'uv|%s\n' "$*" >> "$COMMAND_LOG"
if [[ "${UV_FAIL:-0}" != 0 ]]; then exit "$UV_FAIL"; fi
if [[ "$1" == venv ]]; then
  venv="${!#}"
  mkdir -p "$venv/bin"
  ln -sf "$REAL_PYTHON" "$venv/bin/python"
  cat > "$venv/bin/mcp-for-blender" <<'SERVER'
#!/bin/bash
printf 'telemetry=%s\nhost=%s\nport=%s\n' "$BLENDER_MCP_DISABLE_TELEMETRY" "$BLENDER_HOST" "$BLENDER_PORT"
printf 'arg=%s\n' "$@"
SERVER
  chmod +x "$venv/bin/mcp-for-blender"
fi
EOF
chmod +x "$TEMP/bin/uv" "$TEMP/bin/blender"
export PATH="$TEMP/bin:$PATH"
export HOME="$TEMP/dry home"
mkdir -p "$HOME"

# Act / Assert: no process, directory or preferences writes in dry-run.
DRY_RUN=1 apply_blender_mcp omarchy > "$TEMP/dry.log"
[[ ! -e "$COMMAND_LOG" && ! -e "$HOME/.local" && ! -e "$HOME/.config" ]] || fail 'dry-run mutated HOME or invoked runtime commands'
grep -Fq -- '--require-hashes' "$TEMP/dry.log" || fail 'dry-run omitted hashed installation'
grep -Fq 'scripts/addons' "$TEMP/dry.log" || fail 'dry-run omitted addon placement'
printf 'ok: dry-run reports pinned runtime and addon without writes or processes\n'

# Act / Assert: remote server is explicitly ineligible, even in dry-run.
if DRY_RUN=1 apply_blender_mcp dev > "$TEMP/dev.log" 2>&1; then fail 'dev was accepted'; fi
[[ ! -e "$COMMAND_LOG" && ! -e "$HOME/.local" ]] || fail 'dev changed HOME or ran commands'
grep -Fq 'supports only macbook and omarchy' "$TEMP/dev.log" || fail 'dev refusal is not actionable'
printf 'ok: unsupported host fails before side effects\n'

# Arrange: interrupted venv creation, user preferences and a custom launcher.
export HOME="$TEMP/omarchy home"
runtime="$HOME/.local/share/creative-mcp/blender-mcp"
addons="$HOME/.config/blender/4.5/scripts/addons"
mkdir -p "$HOME/.local/bin" "$runtime/venv" "$HOME/.config/blender/4.5/config"
printf 'partial venv\n' > "$runtime/venv/interrupted"
printf 'user launcher\n' > "$HOME/.local/bin/blender-mcp"
printf 'binary user preferences\n' > "$HOME/.config/blender/4.5/config/userpref.blend"
cp "$HOME/.config/blender/4.5/config/userpref.blend" "$TEMP/preferences.before"

# Act / Assert: package failure must not overwrite the launcher or addon.
if UV_FAIL=23 DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/failure.log" 2>&1; then fail 'uv failure was swallowed'; fi
grep -Fxq 'user launcher' "$HOME/.local/bin/blender-mcp" || fail 'package failure published launcher'
[[ ! -e "$runtime/addon.py" && ! -e "$addons" ]] || fail 'package failure published addon'
printf 'ok: package failure leaves user launcher and addons untouched\n'

# Act: rerunning after interrupted state converges to the full installation.
DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/install.log"

# Assert: exact bundled bytes at both boundaries, existing user state retained.
[[ "$(readlink "$HOME/.local/bin/blender-mcp")" == "$REPO_ROOT/configs/creative-mcp/blender-mcp" ]] || fail 'wrong launcher link'
grep -Fxq 'user launcher' "$HOME/.local/bin/blender-mcp.bak" || fail 'custom launcher was not backed up'
cmp -s "$PYTHONPATH/blender_mcp/addon.py" "$runtime/addon.py" || fail 'stage did not come from pinned package'
cmp -s "$runtime/addon.py" "$addons/blender_mcp.py" || fail 'installed addon differs from bundled stage'
cmp -s "$TEMP/preferences.before" "$HOME/.config/blender/4.5/config/userpref.blend" || fail 'preferences changed'
grep -Fq -- 'pip sync --no-config --python ' "$COMMAND_LOG" || fail 'did not sync dedicated venv'
grep -Fq -- '--require-hashes --only-binary :all: --default-index https://pypi.org/simple ' "$COMMAND_LOG" || fail 'did not use hashed PyPI wheel-only install'
[[ "$(readlink "$HOME/.local/bin/blender")" == "$REPO_ROOT/configs/creative-mcp/blender-linux" ]] || fail 'missing system-Python Blender launcher'
[[ "$(readlink "$HOME/.local/share/applications/blender.desktop")" == "$REPO_ROOT/configs/creative-mcp/blender.desktop" ]] || fail 'missing desktop Blender launcher'
printf 'ok: install repairs partial runtime, installs bundled addon, preserves preferences and launcher\n'

# Act / Assert: repeated setup leaves original backups intact.
DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/repeat.log"
[[ ! -e "$HOME/.local/bin/blender-mcp.bak.1" && ! -e "$addons/blender_mcp.py.bak" ]] || fail 'repeat install generated unnecessary backups'
grep -Fxq 'user launcher' "$HOME/.local/bin/blender-mcp.bak" || fail 'repeat destroyed launcher backup'
printf 'ok: repeat install is content-idempotent\n'

# Arrange: a legacy named module, locally edited twice, and a preexisting backup.
mv "$addons/blender_mcp.py" "$addons/addon.py"
printf 'bl_info = {"name": "Blender MCP"}\n# local edit one\n' > "$addons/addon.py"
printf 'original backup\n' > "$addons/addon.py.bak"
cp "$addons/addon.py" "$TEMP/local-edit-one"

# Act / Assert: preserve module identity and all original backups.
DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/legacy.log"
cmp -s "$runtime/addon.py" "$addons/addon.py" || fail 'legacy module was not updated'
cmp -s "$TEMP/local-edit-one" "$addons/addon.py.bak.1" || fail 'local edits not preserved in numbered backup'
grep -Fxq 'original backup' "$addons/addon.py.bak" || fail 'previous backup overwritten'
[[ ! -e "$addons/blender_mcp.py" ]] || fail 'duplicate addon module was created'
printf 'ok: legacy module identity and numbered backups are preserved\n'

# Arrange: another local edit after the first update.
printf 'bl_info = {"name": "MCP for Blender"}\n# local edit two\n' > "$addons/addon.py"
cp "$addons/addon.py" "$TEMP/local-edit-two"

# Act / Assert
DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/second-edit.log"
cmp -s "$TEMP/local-edit-two" "$addons/addon.py.bak.2" || fail 'second local edit not preserved'
cmp -s "$TEMP/local-edit-one" "$addons/addon.py.bak.1" || fail 'first local edit backup changed'
printf 'ok: successive user edits never destroy earlier backups\n'

# Arrange: GUI-like PATH lacking uv; default local socket and forced telemetry.
# Act
BLENDER_MCP_DISABLE_TELEMETRY=0 PATH=/usr/bin:/bin "$HOME/.local/bin/blender-mcp" --port 12345 'quoted argument' > "$TEMP/launcher.log"

# Assert
printf 'telemetry=1\nhost=127.0.0.1\nport=9876\narg=--port\narg=12345\narg=quoted argument\n' > "$TEMP/launcher.expected"
cmp -s "$TEMP/launcher.expected" "$TEMP/launcher.log" || fail 'launcher environment or arguments changed'
printf 'ok: launcher works without uv on PATH, forces telemetry opt-out, forwards argument boundaries\n'

# Act / Assert: prevent broad upstream client configuration and unpinning.
if "$HOME/.local/bin/blender-mcp" setup > "$TEMP/blocked.log" 2>&1; then fail 'upstream setup was allowed'; fi
grep -Fq 'upstream setup is disabled' "$TEMP/blocked.log" || fail 'missing setup refusal'
if "$HOME/.local/bin/blender-mcp" update > "$TEMP/blocked.log" 2>&1; then fail 'upstream update was allowed'; fi
grep -Fq 'upstream update is disabled' "$TEMP/blocked.log" || fail 'missing update refusal'
printf 'ok: launcher rejects broad setup and unpinned update\n'

# Arrange: foreign launcher symlink, detected before dependency install.
rm "$HOME/.local/bin/blender-mcp"
printf 'foreign executable\n' > "$TEMP/foreign"
ln -s "$TEMP/foreign" "$HOME/.local/bin/blender-mcp"
cp "$COMMAND_LOG" "$TEMP/commands.before"

# Act / Assert
if DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/conflict.log" 2>&1; then fail 'foreign launcher symlink accepted'; fi
[[ "$(readlink "$HOME/.local/bin/blender-mcp")" == "$TEMP/foreign" ]] || fail 'foreign launcher symlink changed'
cmp -s "$COMMAND_LOG" "$TEMP/commands.before" || fail 'foreign launcher conflict still installed dependencies'
printf 'ok: foreign launcher symlink fails before runtime mutation\n'

# Arrange: a macOS fresh install uses its native config path even on fixture Linux.
export HOME="$TEMP/macbook home"
mkdir -p "$HOME"

# Act / Assert
DRY_RUN=0 apply_blender_mcp macbook > "$TEMP/macbook.log"
cmp -s "$PYTHONPATH/blender_mcp/addon.py" "$HOME/Library/Application Support/Blender/4.5/scripts/addons/blender_mcp.py" || fail 'macOS addon path is incorrect'
[[ ! -e "$HOME/.config/blender" ]] || fail 'macOS installation wrote Linux config path'
printf 'ok: macbook uses Blender native Application Support path\n'

# Arrange: unrelated addon at the fixed module path; no overwrite or stage publish.
export HOME="$TEMP/addon conflict home"
addons="$HOME/.config/blender/4.5/scripts/addons"
mkdir -p "$addons"
printf 'unrelated addon\n' > "$addons/blender_mcp.py"

# Act / Assert
if DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/addon-conflict.log" 2>&1; then fail 'foreign addon module accepted'; fi
grep -Fxq 'unrelated addon' "$addons/blender_mcp.py" || fail 'foreign addon was overwritten'
[[ ! -e "$HOME/.local/bin/blender-mcp" && ! -e "$HOME/.local/share/creative-mcp/blender-mcp/addon.py" ]] || fail 'foreign addon conflict published stage or launcher'
printf 'ok: unrelated addon module fails closed without publication\n'

# Arrange: previously enabled addon packaged as a directory keeps its module.
export HOME="$TEMP/package addon home"
addons="$HOME/.config/blender/4.5/scripts/addons"
mkdir -p "$addons/user_mcp"
printf 'bl_info = {"name": "MCP for Blender"}\n# packaged local edit\n' > "$addons/user_mcp/__init__.py"
cp "$addons/user_mcp/__init__.py" "$TEMP/package.before"

# Act / Assert
DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/package.log"
cmp -s "$PYTHONPATH/blender_mcp/addon.py" "$addons/user_mcp/__init__.py" || fail 'packaged module was not updated'
cmp -s "$TEMP/package.before" "$addons/user_mcp/__init__.py.bak" || fail 'packaged local edit not backed up'
[[ ! -e "$addons/blender_mcp.py" ]] || fail 'packaged addon update created a duplicate module'
printf 'ok: packaged addon preserves enablement identity and its previous source\n'

# Arrange: a linked addon is not permission to overwrite another directory.
export HOME="$TEMP/linked addon home"
addons="$HOME/.config/blender/4.5/scripts/addons"
mkdir -p "$addons"
cp "$PYTHONPATH/blender_mcp/addon.py" "$TEMP/foreign-addon.py"
ln -s "$TEMP/foreign-addon.py" "$addons/addon.py"
cp "$TEMP/foreign-addon.py" "$TEMP/foreign-addon.before"

# Act / Assert
if DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/linked-addon.log" 2>&1; then fail 'linked addon accepted'; fi
cmp -s "$TEMP/foreign-addon.before" "$TEMP/foreign-addon.py" || fail 'linked addon changed foreign source'
[[ "$(readlink "$addons/addon.py")" == "$TEMP/foreign-addon.py" ]] || fail 'linked addon was replaced'
grep -Fq 'refusing linked addon module' "$TEMP/linked-addon.log" || fail 'linked addon omitted conflict error'
printf 'ok: linked addon fails closed without modifying its foreign target\n'

# Arrange: a dedicated runtime redirected elsewhere is a conflict, not adoption.
export HOME="$TEMP/linked runtime home"
mkdir -p "$HOME/.local/share/creative-mcp" "$TEMP/foreign-runtime"
ln -s "$TEMP/foreign-runtime" "$HOME/.local/share/creative-mcp/blender-mcp"
cp "$COMMAND_LOG" "$TEMP/commands.before"

# Act / Assert
if DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/runtime-conflict.log" 2>&1; then fail 'linked runtime accepted'; fi
cmp -s "$COMMAND_LOG" "$TEMP/commands.before" || fail 'linked runtime still ran dependency installation'
[[ "$(readlink "$HOME/.local/share/creative-mcp/blender-mcp")" == "$TEMP/foreign-runtime" ]] || fail 'linked runtime was modified'
printf 'ok: runtime symlink fails before external commands or writes\n'

# Arrange: malformed external Blender version probe.
export HOME="$TEMP/bad version home"
mkdir -p "$HOME"

# Act / Assert
if BLENDER_VERSION_OUTPUT='unexpected output' DRY_RUN=0 apply_blender_mcp omarchy > "$TEMP/version.log" 2>&1; then fail 'invalid Blender version accepted'; fi
[[ ! -e "$HOME/.local" ]] || fail 'invalid Blender version still created runtime'
grep -Fq 'could not determine Blender version' "$TEMP/version.log" || fail 'invalid version omitted actionable error'
printf 'ok: invalid Blender version fails before runtime writes\n'

# Act / Assert: launch without setup diagnoses missing runtime, not an auto-download.
if "$REPO_ROOT/configs/creative-mcp/blender-mcp" > "$TEMP/missing.log" 2>&1; then fail 'missing runtime unexpectedly launched'; fi
grep -Fq 'runtime is missing' "$TEMP/missing.log" || fail 'missing runtime did not explain repair'
[[ ! -e "$HOME/.local" ]] || fail 'launcher downloaded a runtime on startup'
printf 'ok: missing runtime fails with setup instruction and no startup download\n'
