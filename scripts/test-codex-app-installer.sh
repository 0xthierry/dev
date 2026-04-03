#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="$(mktemp -d)"
TMP_BIN="$TMP_ROOT/bin"
TMP_STATE="$TMP_ROOT/state"
TARGET_APP="$TMP_ROOT/Applications/Codex.app"

cleanup() {
  rm -rf "$TMP_ROOT"
}

trap cleanup EXIT

mkdir -p "$TMP_BIN" "$TMP_STATE"

cat > "$TMP_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

output_path=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o)
      output_path="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$output_path" ]]; then
  printf 'missing output path\n' >&2
  exit 1
fi

: > "$output_path"
EOF

cat > "$TMP_BIN/hdiutil" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${CODEX_TEST_STATE_DIR:?}"
command_name="${1:?}"
shift

case "$command_name" in
  attach)
    mount_dir=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -mountpoint)
          mount_dir="$2"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done

    if [[ -z "$mount_dir" ]]; then
      printf 'missing mountpoint\n' >&2
      exit 1
    fi

    mkdir -p "$mount_dir/Codex.app"
    printf '%s\n' "$mount_dir" > "$state_dir/mount_dir"
    ;;
  detach)
    rm -f "$state_dir/mount_dir"
    ;;
  *)
    printf 'unsupported hdiutil command: %s\n' "$command_name" >&2
    exit 1
    ;;
esac
EOF

cat > "$TMP_BIN/mount" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

state_dir="${CODEX_TEST_STATE_DIR:?}"
if [[ -f "$state_dir/mount_dir" ]]; then
  printf '/dev/disk42 on %s (hfs, local)\n' "$(cat "$state_dir/mount_dir")"
fi
EOF

cat > "$TMP_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exec "$@"
EOF

cat > "$TMP_BIN/ditto" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

source_path="${1:?}"
target_path="${2:?}"

if [[ ! -d "$source_path" ]]; then
  printf 'missing source app: %s\n' "$source_path" >&2
  exit 1
fi

mkdir -p "$target_path"
EOF

chmod +x "$TMP_BIN/curl" "$TMP_BIN/hdiutil" "$TMP_BIN/mount" "$TMP_BIN/sudo" "$TMP_BIN/ditto"

PATH="$TMP_BIN:$PATH" CODEX_TEST_STATE_DIR="$TMP_STATE" bash -lc "
  set -euo pipefail
  source \"$REPO_ROOT/install/codex-app.sh\"
  CODEX_APP_PATH=\"$TARGET_APP\"
  install_codex_app_macos
  [[ -d \"$TARGET_APP\" ]]
"
