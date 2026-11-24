#!/usr/bin/env bash
# Exercise stock Quattro workspace listeners and captured bindings without a session.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
upstream=$(realpath "${OMARCHY_TEST_UPSTREAM:-$HOME/.cache/dev-setup/omarchy-test-upstream}")
[[ $(git -C "$upstream" rev-parse HEAD) == ac2690cd7be4f47e4a255f5e2e78d904d436b068 ]]
home=$(mktemp -d)
trap 'rm -rf "$home"' EXIT
mkdir -p "$home/state/omarchy" "$home/config" "$home/runtime"
chmod 700 "$home/runtime"
printf '0\tDP-1\tMain\n1\tHDMI-A-2\tHDMI\n' > "$home/state/omarchy/monitor-workspaces"
printf '14\t4\tMain\n' > "$home/state/omarchy/monitor-workspaces-merged"
cp -r "$home/state/omarchy" "$home/original"
run=(env -i PATH=/usr/bin:/bin HOME="$home" XDG_CONFIG_HOME="$home/config" XDG_STATE_HOME="$home/state" XDG_RUNTIME_DIR="$home/runtime" OMARCHY_PATH="$upstream")
module="$root/configs/hypr-quattro/global-workspaces.lua"
cd "$home"
"${run[@]}" lua "$root/tests/global-workspaces-lua.test.lua" "$module"
diff -ru "$home/original" "$home/state/omarchy"
# In a new session, stock (not the policy) clears its temporary merge journal.
"${run[@]}" lua "$root/tests/global-workspaces-lua.test.lua" "$module" --startup
cmp "$home/original/monitor-workspaces" "$home/state/omarchy/monitor-workspaces"
[[ ! -s "$home/state/omarchy/monitor-workspaces-merged" ]]

if command -v Hyprland >/dev/null; then
  printf '%s\n' 'package.path = os.getenv("OMARCHY_PATH") .. "/?.lua;" .. package.path' \
    'require("default.hypr.helpers")' 'require("default.hypr.monitor-workspaces")' \
    'require("default.hypr.bindings.tiling")' 'dofile(os.getenv("WORKSPACE_POLICY"))' > "$home/config/check.lua"
  "${run[@]}" WORKSPACE_POLICY="$module" Hyprland --verify-config -c "$home/config/check.lua"
else
  printf 'SKIP: Hyprland parser not installed\n' >&2
fi
