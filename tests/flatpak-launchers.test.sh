#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/flatpak.sh
source "$ROOT/install/flatpak.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }
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
  is-active)
    [[ "$3" == --quiet ]] || exit 92
    [[ -f "$LAUNCHER_STATE/$4.active" ]]
    ;;
  restart)
    [[ "${RESTART_FAIL:-0}" == 0 ]] || exit 23
    cp "$LAUNCHER_STATE/dirs" "$LAUNCHER_STATE/$3.environment"
    ;;
  *) exit 93 ;;
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
touch "$LAUNCHER_STATE/elephant.service.active" "$LAUNCHER_STATE/app-walker@autostart.service.active"

DRY_RUN=1 PATH="$TEMP/no-tools" refresh_flatpak_launchers > "$TEMP/dry.log"
grep -Fq 'XDG_DATA_DIRS' "$TEMP/dry.log" || fail 'dry-run omitted environment plan'
[[ "$(< "$LAUNCHER_STATE/dirs")" == '/usr/local/share:/usr/share:/custom/share' ]] || fail 'dry-run changed environment'
printf 'ok: dry-run works without services or Flatpak\n'

DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/refresh.log"
expected="/usr/local/share:/usr/share:/custom/share:$TEMP/data/flatpak/exports/share:/var/lib/flatpak/exports/share:/opt/shared flatpak/exports/share"
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'manager paths not preserved or Flatpak exports missing'
[[ "$(< "$LAUNCHER_STATE/elephant.service.environment")" == "$expected" ]] || fail 'indexer did not get refreshed environment'
[[ "$(< "$LAUNCHER_STATE/app-walker@autostart.service.environment")" == "$expected" ]] || fail 'launcher did not get refreshed environment'
printf 'ok: active launchers inherit user and system Flatpak exports while preserving manager paths\n'

DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/repeat.log"
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'repeat duplicated paths'
printf 'ok: repeated refresh does not duplicate paths\n'

rm "$LAUNCHER_STATE/elephant.service.active" "$LAUNCHER_STATE/elephant.service.environment"
DRY_RUN=0 refresh_flatpak_launchers > "$TEMP/inactive.log"
[[ ! -e "$LAUNCHER_STATE/elephant.service.environment" ]] || fail 'inactive indexer was started'
[[ "$(< "$LAUNCHER_STATE/app-walker@autostart.service.environment")" == "$expected" ]] || fail 'active launcher was not refreshed'
printf 'ok: inactive services stay stopped\n'

if DRY_RUN=0 SET_FAIL=1 refresh_flatpak_launchers > "$TEMP/error.log" 2>&1; then fail 'environment failure succeeded'; else status=$?; fi
[[ "$status" == 22 ]] || fail 'environment error status lost'
if DRY_RUN=0 RESTART_FAIL=1 refresh_flatpak_launchers > "$TEMP/restart-error.log" 2>&1; then fail 'restart failure succeeded'; else status=$?; fi
[[ "$status" == 23 ]] || fail 'restart error status lost'
printf 'ok: environment and restart failures propagate\n'

DRY_RUN=0 NO_MANAGER=1 refresh_flatpak_launchers > "$TEMP/no-manager.log"
grep -Fq 'log out and back in' "$TEMP/no-manager.log" || fail 'headless setup omitted recovery instruction'
[[ "$(< "$LAUNCHER_STATE/dirs")" == "$expected" ]] || fail 'headless setup changed environment'
printf 'ok: headless setup provides logout guidance without changing state\n'
