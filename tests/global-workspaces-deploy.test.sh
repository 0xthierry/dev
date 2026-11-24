#!/usr/bin/env bash
# Exercise the real installer, with a disposable home, no live desktop sockets,
# mocked desktop IPC and the fixed Quattro package path backed by the test fixture.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
if [[ ${1:-} != --sandbox ]]; then
  fixture=${OMARCHY_TEST_UPSTREAM:-$HOME/.cache/dev-setup/omarchy-test-upstream}
  exec bwrap --ro-bind / / --dev /dev --tmpfs /tmp --ro-bind "$root" /tmp/repo --tmpfs /run \
    --tmpfs /usr/share --ro-bind "$fixture" /usr/share/omarchy --unshare-net --chdir /tmp \
    -- /usr/bin/env -i PATH=/usr/bin HOME=/tmp/home bash /tmp/repo/tests/global-workspaces-deploy.test.sh --sandbox
fi
export XDG_CONFIG_HOME=$HOME/.config XDG_STATE_HOME=$HOME/.local/state XDG_RUNTIME_DIR=/tmp/runtime
export PATH=/tmp/bin:/usr/bin
hypr=$XDG_CONFIG_HOME/hypr; config=$XDG_CONFIG_HOME/omarchy; state=$XDG_STATE_HOME/omarchy
mkdir -p "$hypr" "$config/plugins" "$state" "$XDG_RUNTIME_DIR" /tmp/bin
export TRACE=/tmp/trace
: > "$TRACE"
entry=$hypr/hyprland.lua; module=$hypr/dev-global-workspaces.lua
id=devsetup.global-workspaces; plugin=$config/plugins/$id
hook='if package.searchpath("hypr.dev-global-workspaces", package.path) then require("hypr.dev-global-workspaces") end'
cp /usr/share/omarchy/config/hypr/hyprland.lua "$entry"
printf '%s\n' '-- keep my desktop settings' >> "$entry"
printf '%s\n' 'preexisting backup' > "$entry.bak"
printf '%s\n' '-- keep my monitor config' > "$hypr/monitors.lua"
printf '%s\n' 'DP-1 persisted slot data' > "$state/monitor-workspaces"
printf '%s\n' 'HDMI-A-2 second mapping' > "$state/monitor-workspaces-merged"
cat > "$config/shell.json" <<'JSON'
{"personal":{"flag":true},"bar":{"layout":{"left":["other.launcher"],"center":[{"id":"other.clock","setting":7},"omarchy.workspaces","other.tray"],"right":["other.end"]}}}
JSON
cat > /tmp/bin/hyprctl <<'SH'
#!/usr/bin/env bash
set -eu
printf 'hyprctl %s\n' "$*" >> "$TRACE"
case "$*" in
  '-j configerrors') echo '[]';;
  reload) touch /tmp/reloaded;;
  '-j workspacerules') if [[ -f /tmp/reloaded ]]; then echo '[{"workspaceString":"5","monitor":"HDMI-A-2","persistent":true}]'; else echo '[]'; fi;;
  *) exit 92;;
esac
SH
cat > /tmp/bin/omarchy-shell <<'SH'
#!/usr/bin/env bash
set -eu
printf 'omarchy-shell %s\n' "$*" >> "$TRACE"
case "$*" in
  'lock status') echo '{"locked":false,"requested":false,"sessionLocked":false}';;
  'shell rescanPlugins') touch /tmp/discovered;;
  'shell enablePlugin devsetup.global-workspaces {}')
    file=$XDG_CONFIG_HOME/omarchy/shell.json
    jq '(.bar.layout[][] | select(. == "omarchy.workspaces")) = "devsetup.global-workspaces"' "$file" > /tmp/shell-out
    # Real shell can persist the layout before its IPC response times out.
    mv /tmp/shell-out "$file"; echo 'IPC reply timed out' >&2; exit 1;;
  *) exit 93;;
esac
SH
cat > /tmp/bin/omarchy <<'SH'
#!/usr/bin/env bash
set -eu
printf 'omarchy %s\n' "$*" >> "$TRACE"
case "$*" in
  version) echo 4.5.0;;
  'plugin validate '*) [[ $# == 3 && -d $3 ]];;
  'plugin list --json') if [[ -f /tmp/discovered ]]; then echo '[{"id":"devsetup.global-workspaces","clonedFrom":"omarchy.workspaces"}]'; else echo '[]'; fi;;
  'plugin enable devsetup.global-workspaces') exec /usr/share/omarchy/bin/omarchy-plugin-enable "$3";;
  *) exit 94;;
esac
SH
# Used by the real upstream enable command, whose placement API we exercise.
printf '%s\n' '#!/usr/bin/env bash' "echo '[]'" > /tmp/bin/omarchy-plugin-catalog
chmod +x /tmp/bin/*
run() { bash "$root/scripts/quattro-global-workspaces" "$@"; }
cp -a "$HOME" /tmp/original
run --dry-run
diff -r --no-dereference /tmp/original "$HOME"
! grep -Ex 'hyprctl reload|omarchy plugin enable .*|omarchy-shell shell .*' "$TRACE" || exit 1
# Refusal must happen before either of the links, a backup, or any IPC mutation.
refuses() {
  cp -a "$HOME" /tmp/before
  if run --apply >/tmp/refusal 2>&1; then echo 'unexpectedly accepted conflicting setup' >&2; exit 1; fi
  grep -Fq -- "$1" /tmp/refusal
  diff -r --no-dereference /tmp/before "$HOME"; rm -r /tmp/before
  ! grep -Ex 'hyprctl reload|omarchy plugin enable .*|omarchy-shell shell .*' "$TRACE" || exit 1
}
for candidate in "$module" "$plugin"; do ln -s /tmp/nonexistent "$candidate"; refuses 'refusing to replace'; rm "$candidate"; done
printf '%s\n%s\n' "$hook" "$hook" >> "$entry"; refuses 'import'; cp /tmp/original/.config/hypr/hyprland.lua "$entry"
run --apply
# All untouched paths and settings are compared, not just a representative key.
cp -a /tmp/original /tmp/expected
expected=/tmp/expected/.config
cp "$expected/hypr/hyprland.lua" "$expected/hypr/hyprland.lua.bak.1"
awk -v hook="$hook" '$0=="require(\"hypr.monitors\")" {print hook} {print}' "$expected/hypr/hyprland.lua.bak.1" > "$expected/hypr/hyprland.lua"
ln -s "$root/configs/hypr-quattro/global-workspaces.lua" "$expected/hypr/dev-global-workspaces.lua"
ln -s "$root/configs/omarchy/global-workspaces" "$expected/omarchy/plugins/$id"
jq '.bar.layout.center[1]="devsetup.global-workspaces"' /tmp/original/.config/omarchy/shell.json > "$expected/omarchy/shell.json"
jq -S . "$expected/omarchy/shell.json" > /tmp/want; jq -S . "$config/shell.json" > /tmp/got; cmp /tmp/want /tmp/got
diff -r --no-dereference --exclude=shell.json /tmp/expected "$HOME"
cp -a "$HOME" /tmp/applied
run --apply
diff -r --no-dereference /tmp/applied "$HOME"
[[ $(grep -Fxc 'hyprctl reload' "$TRACE") == 1 && $(grep -Fxc "omarchy plugin enable $id" "$TRACE") == 1 ]]
echo 'Global workspaces deployment tests passed.'
