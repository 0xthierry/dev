#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/flatpak.sh
source "$ROOT/install/flatpak.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }
export HOME="$TEMP/home"
export XDG_CONFIG_HOME="$HOME/.config"
export LAUNCHER_STATE="$TEMP/state"
mkdir -p "$TEMP/bin" "$LAUNCHER_STATE" "$TEMP/no-tools"
cat > "$TEMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == --user ]] || exit 90
case "$2" in
  show-environment)
    [[ "${NO_MANAGER:-0}" == 0 ]] || exit 21
    printf 'OTHER_VARIABLE=preserved\nXDG_DATA_DIRS=%s\n' "$(< "$LAUNCHER_STATE/dirs")"
    ;;
  set-environment)
    [[ "${SET_FAIL:-0}" == 0 ]] || exit 22
    [[ "$3" == XDG_DATA_DIRS=* && "$#" == 3 ]] || exit 91
    printf '%s\n' "${3#XDG_DATA_DIRS=}" > "$LAUNCHER_STATE/dirs"
    ;;
  *) printf '%s\n' "$*" > "$LAUNCHER_STATE/unexpected"; exit 93 ;;
esac
EOF
cat > "$TEMP/bin/flatpak" <<'EOF'
#!/usr/bin/env bash
[[ "$*" == --installations ]] || exit 94
printf '/var/lib/flatpak/\n/opt/shared flatpak\n'
EOF
chmod +x "$TEMP/bin/systemctl" "$TEMP/bin/flatpak"
export PATH="$TEMP/bin:$PATH"
export XDG_DATA_HOME="$TEMP/data"
export XDG_DATA_DIRS='/stale-shell/share'
printf '/usr/local/share:/usr/share:/custom/share\n' > "$LAUNCHER_STATE/dirs"

DRY_RUN=1 PATH="$TEMP/no-tools" refresh_flatpak_launchers > "$TEMP/dry.log"
grep -Fq 'XDG_DATA_DIRS' "$TEMP/dry.log" || fail 'dry-run omitted environment plan'
[[ "$(< "$LAUNCHER_STATE/dirs")" == '/usr/local/share:/usr/share:/custom/share' ]] || fail 'dry-run changed environment'
printf 'ok: dry-run works without services or Flatpak\n'

DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/refresh.log"
expected="/usr/local/share:/usr/share:/custom/share:$TEMP/data/flatpak/exports/share:/var/lib/flatpak/exports/share:/opt/shared flatpak/exports/share"
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'manager paths not preserved or Flatpak exports missing'
grep -Fq 'log out and back in if apps are missing' "$TEMP/refresh.log" || fail 'first install lacks conditional login guidance'
[[ ! -e "$LAUNCHER_STATE/unexpected" ]] || fail 'refresh attempted a service restart'
printf 'ok: Quattro exposes all Flatpak exports without restarting services\n'

DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/repeat.log"
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'repeat duplicated paths'
grep -Fq 'watches desktop entries' "$TEMP/repeat.log" || fail 'normal discovery not reported'
printf 'ok: repeated refresh does not duplicate paths\n'

if DRY_RUN=0 SET_FAIL=1 refresh_flatpak_launchers > "$TEMP/error.log" 2>&1; then fail 'environment failure succeeded'; else status=$?; fi
[[ "$status" == 22 ]] || fail 'environment error status lost'
printf 'ok: environment failures propagate\n'

DRY_RUN=0 NO_MANAGER=1 refresh_flatpak_launchers > "$TEMP/no-manager.log"
grep -Fq 'log out and back in' "$TEMP/no-manager.log" || fail 'headless setup omitted recovery instruction'
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'headless setup changed environment'
printf 'ok: headless setup provides logout guidance without changing manager state\n'
[[ ! -e "$XDG_CONFIG_HOME/environment.d" ]] || fail 'refresh created persistent environment state'

mkdir -p "$XDG_CONFIG_HOME/environment.d"
printf 'XDG_DATA_DIRS=/user-owned\n' > "$XDG_CONFIG_HOME/environment.d/60-dev-setup-flatpak.conf"
DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/unmanaged.log"
[[ "$(< "$XDG_CONFIG_HOME/environment.d/60-dev-setup-flatpak.conf")" == 'XDG_DATA_DIRS=/user-owned' ]] || fail 'unmanaged config changed'
printf 'ok: unrelated existing environment config is neither overwritten nor rejected\n'
