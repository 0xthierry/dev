#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/flatpak.sh
source "$ROOT/install/flatpak.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

# Fake only the external package manager; exercise real installer and filesystem.
export FLATPAK_STATE="$TEMP/state"
mkdir -p "$TEMP/bin" "$TEMP/no-flatpak" "$FLATPAK_STATE"
cat > "$TEMP/bin/flatpak" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  remote-add)
    [[ "$*" == 'remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo' ]] || exit 91
    if [[ "${FAIL_REMOTE:-0}" == 1 ]]; then exit 23; fi
    touch "$FLATPAK_STATE/remote"
    ;;
  info)
    [[ "$2" == --user ]] || exit 92
    [[ -f "$FLATPAK_STATE/$3" ]]
    ;;
  install)
    [[ "$2 $3 $4 $5" == '--user --noninteractive --assumeyes flathub' ]] || exit 93
    [[ -f "$FLATPAK_STATE/remote" ]] || exit 94
    if [[ "${FAIL_APP:-}" == "$6" ]]; then exit 24; fi
    printf 'installed\n' >> "$FLATPAK_STATE/$6"
    ;;
  update)
    [[ "$#" == 5 && "$2 $3 $4" == '--user --noninteractive --assumeyes' ]] || exit 96
    [[ -f "$FLATPAK_STATE/$5" ]] || exit 97
    if [[ "${FAIL_UPDATE:-}" == "$5" ]]; then exit 25; fi
    printf 'current\n' > "$FLATPAK_STATE/$5.revision"
    ;;
  *) exit 95 ;;
esac
EOF
chmod +x "$TEMP/bin/flatpak"
export PATH="$TEMP/bin:$PATH"

# Dry-run works before Flatpak has been installed and prints the full plan.
DRY_RUN=1 PATH="$TEMP/no-flatpak" install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/dry.log"
grep -Fxq '[dry-run] flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo' "$TEMP/dry.log" || fail 'dry-run omitted remote'
grep -Fxq '[dry-run] flatpak install --user --noninteractive --assumeyes flathub org.vinegarhq.Sober' "$TEMP/dry.log" || fail 'dry-run omitted player'
grep -Fxq '[dry-run] flatpak install --user --noninteractive --assumeyes flathub org.vinegarhq.Vinegar' "$TEMP/dry.log" || fail 'dry-run omitted Studio'
grep -Fxq '[dry-run] flatpak update --user --noninteractive --assumeyes org.vinegarhq.Sober' "$TEMP/dry.log" || fail 'dry-run omitted player update'
grep -Fxq '[dry-run] flatpak update --user --noninteractive --assumeyes org.vinegarhq.Vinegar' "$TEMP/dry.log" || fail 'dry-run omitted Studio update'
[[ ! -e "$FLATPAK_STATE/remote" ]] || fail 'dry-run changed state'
printf 'ok: dry-run plans both apps without requiring Flatpak\n'

# Missing prerequisite is a failure, not a silently skipped installation.
if DRY_RUN=0 PATH="$TEMP/no-flatpak" install_flatpak_apps org.vinegarhq.Sober > "$TEMP/missing.log" 2>&1; then
  fail 'missing Flatpak succeeded'
fi
grep -Fxq 'error: flatpak is required; install the host packages first' "$TEMP/missing.log" || fail 'missing prerequisite diagnostic'
printf 'ok: missing Flatpak fails clearly\n'

# A remote error must stop before any app installation, even in a conditional.
if DRY_RUN=0 FAIL_REMOTE=1 install_flatpak_apps org.vinegarhq.Sober > "$TEMP/remote-error.log" 2>&1; then
  fail 'remote failure succeeded'
else
  status=$?
fi
[[ "$status" == 23 ]] || fail 'remote failure status lost'
[[ ! -e "$FLATPAK_STATE/org.vinegarhq.Sober" ]] || fail 'installed after remote failure'
printf 'ok: remote failure is propagated\n'

# Partial installation leaves the successful app intact and can be retried.
if DRY_RUN=0 FAIL_APP=org.vinegarhq.Vinegar install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/partial.log" 2>&1; then
  fail 'app failure succeeded'
else
  status=$?
fi
[[ "$status" == 24 ]] || fail 'app failure status lost'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober")" == installed ]] || fail 'player not installed'
[[ ! -e "$FLATPAK_STATE/org.vinegarhq.Vinegar" ]] || fail 'failed app installed'
printf 'ok: partial installation preserves progress and reports failure\n'

DRY_RUN=0 install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/retry.log"
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober")" == installed ]] || fail 'retry reinstalled player'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar")" == installed ]] || fail 'retry did not install Studio'
printf 'ok: retry converges after partial installation\n'

# Existing apps converge to current versions without reinstalling or touching
# other apps, system installations, or app-owned data.
printf 'stale\n' > "$FLATPAK_STATE/org.vinegarhq.Sober.revision"
printf 'stale\n' > "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision"
printf 'stale\n' > "$FLATPAK_STATE/unrelated.revision"
printf 'user data\n' > "$FLATPAK_STATE/app-data"
DRY_RUN=0 install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/update.log"
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober.revision")" == current ]] || fail 'player not updated'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision")" == current ]] || fail 'Studio not updated'
[[ "$(< "$FLATPAK_STATE/unrelated.revision")" == stale ]] || fail 'unrelated app changed'
[[ "$(< "$FLATPAK_STATE/app-data")" == 'user data' ]] || fail 'app data changed'
printf 'ok: existing declared apps update in user scope without unrelated changes\n'

DRY_RUN=0 install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/repeat.log"
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober")" == installed ]] || fail 'rerun reinstalled player'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar")" == installed ]] || fail 'rerun reinstalled Studio'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober.revision")" == current ]] || fail 'rerun regressed player'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision")" == current ]] || fail 'rerun regressed Studio'
printf 'ok: repeated setup converges without reinstalling apps\n'

# Failure is propagated and does not proceed to the next declared app.
printf 'stale\n' > "$FLATPAK_STATE/org.vinegarhq.Sober.revision"
printf 'stale\n' > "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision"
if DRY_RUN=0 FAIL_UPDATE=org.vinegarhq.Sober install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/update-error.log" 2>&1; then
  fail 'update failure succeeded'
else
  status=$?
fi
[[ "$status" == 25 ]] || fail 'update failure status lost'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober.revision")" == stale ]] || fail 'failed update changed player'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision")" == stale ]] || fail 'continued after update failure'
DRY_RUN=0 install_flatpak_apps org.vinegarhq.Sober org.vinegarhq.Vinegar > "$TEMP/update-retry.log"
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Sober.revision")" == current ]] || fail 'retry did not update player'
[[ "$(< "$FLATPAK_STATE/org.vinegarhq.Vinegar.revision")" == current ]] || fail 'retry did not update Studio'
printf 'ok: update failures propagate and retry converges\n'
