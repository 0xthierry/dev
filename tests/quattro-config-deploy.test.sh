#!/usr/bin/env bash
# No running compositor or real home involved. Optional argument: pristine
# Quattro config/hypr/hyprland.lua. Bubblewrap mounts the actual upstream tree
# at the FIXED package path; production has no test-root environment bypass.
set -euo pipefail
REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
if [[ ${1:-} != --sandbox ]]; then
  upstream_entry=${1:-"$REPO_ROOT/../upstream/config/hypr/hyprland.lua"}
  upstream=$(cd "$(dirname "$upstream_entry")/../.." && pwd)
  exec bwrap --ro-bind / / --dev /dev --tmpfs /usr/share --ro-bind "$upstream" /usr/share/omarchy \
    --tmpfs /tmp --unshare-net -- bash "$0" --sandbox "$upstream_entry"
fi
shift
source "$REPO_ROOT/install/configs.sh"
work=$(mktemp -d); trap 'rm -rf -- "$work"' EXIT
export HOME="$work/home"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_STATE_HOME="$HOME/.local/state"
dir="$HOME/.config/hypr"; entry="$dir/hyprland.lua"
# Dry-run from an empty HOME plans but never initializes or upgrades anything.
DRY_RUN=1 apply_hypr > "$work/dry-run"
grep -F 'requires initialized stock Quattro' "$work/dry-run"
[[ ! -e $HOME ]]
if apply_hypr; then echo 'accepted missing config' >&2; exit 1; fi
[[ ! -e $HOME ]]
mkdir -p "$dir"
printf 'legacy user config\n' > "$dir/hyprland.conf"
if apply_hypr; then echo 'accepted legacy config' >&2; exit 1; fi
[[ $(< "$dir/hyprland.conf") == 'legacy user config' && ! -e $entry ]]
cp "$1" "$entry"
printf '\n%s\n' '-- an unrelated personal override' >> "$entry"
cp "$entry" "$work/before"
# Upstream's migration owns these late-loaded personal bindings. Setup must
# accept and preserve them, not reject them or replace them with custom handlers.
printf '%s\n' 'if o.dictation_installed and o.dictation_installed() then' \
  '  o.bind("SUPER + CTRL + X", "Toggle dictation", "omarchy-dictation toggle")' \
  '  o.bind_hold("F9", "Start dictation (push-to-talk)", "omarchy-dictation start", "Stop dictation (push-to-talk)", "omarchy-dictation stop")' \
  'end' > "$dir/bindings.lua"
cp "$dir/bindings.lua" "$work/retained-bindings.lua"
mkdir -p "$XDG_CONFIG_HOME/omarchy/defaults"
printf 'superwhisper\n' > "$XDG_CONFIG_HOME/omarchy/defaults/dictation"
cp "$XDG_CONFIG_HOME/omarchy/defaults/dictation" "$work/retained-backend"
state="$XDG_STATE_HOME/omarchy"; mkdir -p "$state"
for file in monitor-workspaces monitor-workspaces-merged; do
  printf '1\tHDMI-A-2\tmonitor-id\n' > "$state/$file"
  if apply_hypr_quattro; then echo 'accepted existing per-monitor state' >&2; exit 1; fi
  cmp "$work/before" "$entry"; [[ ! -L $dir/dev-setup && -s $state/$file ]]
  mv "$state/$file" "$work/prior-$file"
done
# An unfamiliar entry point must not silently get the wrong load order.
printf '%s\n' '-- independent user-managed Lua file' > "$entry"
if apply_hypr_quattro; then echo 'accepted unknown Lua entry point' >&2; exit 1; fi
[[ ! -L $dir/dev-setup && ! -e $entry.bak ]]
cp "$work/before" "$entry"
printf '\n%s\n' 'require("default.hypr.omarchy")' >> "$entry"
cp "$entry" "$work/duplicate"
if apply_hypr; then echo 'accepted duplicate stock import' >&2; exit 1; fi
cmp "$work/duplicate" "$entry"; [[ ! -L $dir/dev-setup ]]
cp "$work/before" "$entry"
# Upstream's session-start callback is allowed to leave an empty merged file.
: > "$state/monitor-workspaces-merged"
DRY_RUN=1 apply_hypr_quattro
[[ ! -e $dir/dev-setup && ! -L $dir/dev-setup && ! -e $entry.bak ]]; cmp "$work/before" "$entry"
apply_hypr_quattro
cmp "$work/before" "$entry.bak"; [[ $dir/dev-setup -ef $REPO_ROOT/configs/hypr-quattro ]]
cp "$entry" "$work/once"; apply_hypr_quattro; cmp "$work/once" "$entry"; [[ ! -e $entry.bak.1 ]]
cmp "$work/retained-bindings.lua" "$dir/bindings.lua"
cmp "$work/retained-backend" "$XDG_CONFIG_HOME/omarchy/defaults/dictation"
# Exercise the installed hook with a minimal fixture module, then without it.
# Its absence must leave a usable stock entry; a module error must NOT be hidden.
# The next lines remain the user's and Quattro's overrides, not ours.
awk '/^require\("default.hypr.omarchy"\)/{base=NR} /package.searchpath/{overlay=NR} /^require\("hypr.input"\)/{user=NR} /^require\("default.hypr.toggles"\)/{toggles=NR} END{exit !(base+1==overlay && overlay<user && user<toggles)}' "$entry"
grep -F 'if package.searchpath("hypr.dev-setup.dev-setup"' "$entry" > "$work/hook.lua"
rm "$dir/dev-setup"; mkdir "$dir/dev-setup"
printf 'assert(_G.overlay_loaded == nil); _G.overlay_loaded = true\n' > "$dir/dev-setup/dev-setup.lua"
LUA_PATH="$HOME/.config/?.lua;;" TEST_HOOK="$work/hook.lua" lua -e 'dofile(os.getenv("TEST_HOOK")); assert(overlay_loaded == true)'
printf 'error("intentional module error")\n' > "$dir/dev-setup/dev-setup.lua"
if LUA_PATH="$HOME/.config/?.lua;;" lua "$work/hook.lua" >/dev/null 2>&1; then echo 'masked overlay error' >&2; exit 1; fi
if apply_hypr_quattro; then echo 'accepted foreign overlay directory' >&2; exit 1; fi
rm -r "$dir/dev-setup"; LUA_PATH="$HOME/.config/?.lua;;" lua "$work/hook.lua"
# Refuse both a symlinked entry and an ancestor pointing into the repository.
mv "$entry" "$work/owner.lua"; ln -s "$work/owner.lua" "$entry"
if apply_hypr_quattro; then echo 'accepted linked entry' >&2; exit 1; fi
cmp "$work/owner.lua" "$work/once"
rm "$entry"; mv "$work/owner.lua" "$entry"; mv "$dir" "$work/legacy"; ln -s "$work/legacy" "$dir"
if apply_hypr_quattro; then echo 'accepted linked hypr directory' >&2; exit 1; fi
cmp "$work/legacy/hyprland.lua" "$work/once"; [[ ! -e $work/legacy/dev-setup ]]
rm "$dir"; mv "$work/legacy" "$dir"
mv "$HOME/.config" "$work/linked-config"; ln -s "$work/linked-config" "$HOME/.config"
if apply_hypr; then echo 'accepted linked .config ancestor' >&2; exit 1; fi
cmp "$work/linked-config/hypr/hyprland.lua" "$work/once"; [[ ! -e $work/linked-config/hypr/dev-setup ]]
printf 'Quattro deployment, idempotency, missing overlay, and refusal cases passed.\n'
