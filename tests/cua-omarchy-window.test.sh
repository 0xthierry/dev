#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
HELPER="$REPO_ROOT/configs/cua-driver/cua-omarchy-window"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

write_default_state() {
  cat > "$CLIENTS_FILE" <<'JSON'
[
  {"address":"0xaaa","pid":101,"class":"brave-browser","title":"Hypr title deliberately differs","workspace":{"id":3,"name":"3"},"monitor":0,"at":[10,20],"size":[800,600]},
  {"address":"0xbbb","pid":202,"class":"brave-browser","title":"Another Hypr title","workspace":{"id":5,"name":"5"},"monitor":1,"at":[900,20],"size":[1000,700]}
]
JSON
  cat > "$MONITORS_FILE" <<'JSON'
[
  {"id":0,"name":"DP-1","activeWorkspace":{"id":3,"name":"3"}},
  {"id":1,"name":"HDMI-A-2","activeWorkspace":{"id":5,"name":"5"}}
]
JSON
  printf '%s\n' '{"address":"0xbbb","class":"brave-browser"}' > "$ACTIVE_FILE"
  cat > "$CUA_WINDOWS_FILE" <<'JSON'
{"windows":[
  {"pid":101,"window_id":1001,"title":"Cua title","bounds":{"x":10,"y":20,"width":800,"height":600}},
  {"pid":303,"window_id":3003,"title":"Unmatched Cua window","bounds":{"x":1,"y":2,"width":3,"height":4}}
]}
JSON
  : > "$DISPATCH_LOG"
  : > "$CUA_CALL_LOG"
}

mkdir -p "$TEST_ROOT/bin"
CLIENTS_FILE="$TEST_ROOT/clients.json"
MONITORS_FILE="$TEST_ROOT/monitors.json"
ACTIVE_FILE="$TEST_ROOT/active.json"
DISPATCH_LOG="$TEST_ROOT/dispatch.log"
CUA_WINDOWS_FILE="$TEST_ROOT/cua-windows.json"
CUA_CALL_LOG="$TEST_ROOT/cua-calls.log"
export CLIENTS_FILE MONITORS_FILE ACTIVE_FILE DISPATCH_LOG CUA_WINDOWS_FILE CUA_CALL_LOG

cat > "$TEST_ROOT/bin/hyprctl" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  clients)
    [[ "${2:-}" == "-j" && $# -eq 2 ]] || exit 91
    cat "$CLIENTS_FILE"
    ;;
  monitors)
    [[ "${2:-}" == "-j" && $# -eq 2 ]] || exit 92
    cat "$MONITORS_FILE"
    ;;
  activewindow)
    [[ "${2:-}" == "-j" && $# -eq 2 ]] || exit 93
    cat "$ACTIVE_FILE"
    ;;
  dispatch)
    [[ $# -eq 3 ]] || exit 94
    printf '%s <%s>\n' "$2" "$3" >> "$DISPATCH_LOG"
    [[ "${HYPR_TEST_NO_MUTATE:-0}" != 1 ]] || exit 0
    case "$2" in
      movetoworkspacesilent)
        workspace="${3%%,*}"
        selector="${3#*,}"
        address="${selector#address:}"
        monitor="$(jq -er --arg workspace "$workspace" '.[] | select(.activeWorkspace.name == $workspace) | .id' "$MONITORS_FILE")"
        tmp="$CLIENTS_FILE.tmp"
        jq --arg address "$address" --arg workspace "$workspace" --argjson monitor "$monitor" '
          map(if ((.address | ascii_downcase) == ($address | ascii_downcase))
              then .monitor = $monitor | .workspace.name = $workspace
              else . end)
        ' "$CLIENTS_FILE" > "$tmp"
        mv "$tmp" "$CLIENTS_FILE"
        ;;
      focuswindow)
        address="${3#address:}"
        jq -nc --arg address "$address" '{address:$address}' > "$ACTIVE_FILE"
        ;;
      closewindow)
        address="${3#address:}"
        tmp="$CLIENTS_FILE.tmp"
        jq --arg address "$address" \
          'map(select((.address | ascii_downcase) != ($address | ascii_downcase)))' \
          "$CLIENTS_FILE" > "$tmp"
        mv "$tmp" "$CLIENTS_FILE"
        ;;
      *) exit 95 ;;
    esac
    ;;
  *) exit 90 ;;
esac
SCRIPT
cat > "$TEST_ROOT/bin/cua-driver" <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$CUA_CALL_LOG"
[[ "${1:-}" == "list_windows" && "${2:-}" == '{"on_screen_only":true}' && $# -eq 2 ]] || exit 96
cat "$CUA_WINDOWS_FILE"
SCRIPT

chmod +x "$TEST_ROOT/bin/hyprctl" "$TEST_ROOT/bin/cua-driver"
export PATH="$TEST_ROOT/bin:$PATH"

write_default_state

printf 'test: window listing preserves Hyprland JSON\n'
windows="$($HELPER windows)"
jq -e 'length == 2 and .[0].address == "0xaaa" and .[1].address == "0xbbb"' \
  >/dev/null <<< "$windows" || fail 'window listing did not preserve Hyprland JSON'

printf 'test: correlation reports exact and unmatched windows from object payload\n'
jq '. + [{address:"0xddd",pid:999,class:"other",title:"Cua title",workspace:{id:3,name:"3"},monitor:0,at:[10,20],size:[800,600]}]' \
  "$CLIENTS_FILE" > "$CLIENTS_FILE.tmp"
mv "$CLIENTS_FILE.tmp" "$CLIENTS_FILE"
correlation="$($HELPER correlate)"
jq -e '
  . == [
    {
      pid:101,
      window_id:1001,
      title:"Cua title",
      bounds:{x:10,y:20,width:800,height:600},
      match_status:"exact",
      hypr_address:"0xaaa"
    },
    {
      pid:303,
      window_id:3003,
      title:"Unmatched Cua window",
      bounds:{x:1,y:2,width:3,height:4},
      match_status:"unmatched"
    }
  ]
' >/dev/null <<< "$correlation" || fail 'object correlation result did not match the public contract'
[[ "$(cat "$CUA_CALL_LOG")" == 'list_windows {"on_screen_only":true}' ]] \
  || fail 'correlation did not request fresh on-screen Cua windows'

printf 'test: correlation normalizes a top-level Cua array\n'
write_default_state
jq '.windows' "$CUA_WINDOWS_FILE" > "$CUA_WINDOWS_FILE.tmp"
mv "$CUA_WINDOWS_FILE.tmp" "$CUA_WINDOWS_FILE"
array_correlation="$($HELPER correlate)"
jq -e '.[0].match_status == "exact" and .[0].hypr_address == "0xaaa" and .[1].match_status == "unmatched"' \
  >/dev/null <<< "$array_correlation" || fail 'top-level Cua array was not normalized'

printf 'test: correlation reports ambiguity and exits nonzero\n'
write_default_state
jq '. + [{address:"0xccc",pid:101,class:"other",title:"duplicate geometry",workspace:{id:3,name:"3"},monitor:0,at:[10,20],size:[800,600]}]' \
  "$CLIENTS_FILE" > "$CLIENTS_FILE.tmp"
mv "$CLIENTS_FILE.tmp" "$CLIENTS_FILE"
if "$HELPER" correlate > "$TEST_ROOT/ambiguous-correlation.json"; then
  fail 'ambiguous correlation exited successfully'
fi
jq -e '.[0].match_status == "ambiguous" and (.[0] | has("hypr_address") | not)' \
  >/dev/null "$TEST_ROOT/ambiguous-correlation.json" \
  || fail 'ambiguous correlation was not explicit or exposed a guessed address'
[[ ! -s "$DISPATCH_LOG" ]] || fail 'read-only correlation invoked a dispatcher'

printf 'test: move exact window to named output and verify live state\n'
move_result="$($HELPER move-to-output 0xAaA HDMI-A-2)"
[[ "$move_result" == 'moved window 0xaaa to output HDMI-A-2 workspace 5' ]] \
  || fail 'move result was unexpected'
grep -Fxq 'movetoworkspacesilent <5,address:0xaaa>' "$DISPATCH_LOG" \
  || fail 'move did not use the exact silent dispatcher shape'
jq -e 'any(.[]; .address == "0xaaa" and .monitor == 1 and .workspace.name == "5")' \
  >/dev/null "$CLIENTS_FILE" || fail 'move postcondition was not established'

printf 'test: focus requires authorization and verifies exact address\n'
write_default_state
if "$HELPER" focus 0xaaa > "$TEST_ROOT/focus-denied.out" 2>&1; then
  fail 'focus succeeded without authorization flag'
fi
[[ ! -s "$DISPATCH_LOG" ]] || fail 'focus dispatched before authorization'
focus_result="$($HELPER focus 0xaaa --authorize-foreground)"
[[ "$focus_result" == 'focused window 0xaaa' ]] || fail 'focus result was unexpected'
grep -Fxq 'focuswindow <address:0xaaa>' "$DISPATCH_LOG" \
  || fail 'focus did not use the exact address selector'
jq -e '.address == "0xaaa"' >/dev/null "$ACTIVE_FILE" || fail 'focus was not verified'

printf 'test: close requires authorization and verifies absence\n'
write_default_state
if "$HELPER" close 0xaaa > "$TEST_ROOT/close-denied.out" 2>&1; then
  fail 'close succeeded without authorization flag'
fi
[[ ! -s "$DISPATCH_LOG" ]] || fail 'close dispatched before authorization'
close_result="$($HELPER close 0xaaa --authorize-close)"
[[ "$close_result" == 'closed window 0xaaa' ]] || fail 'close result was unexpected'
grep -Fxq 'closewindow <address:0xaaa>' "$DISPATCH_LOG" \
  || fail 'close did not use the exact address selector'
jq -e 'all(.[]; .address != "0xaaa")' >/dev/null "$CLIENTS_FILE" \
  || fail 'close was not verified'

printf 'test: invalid, unknown, and ambiguous addresses fail before dispatch\n'
for address in aaa 0xddd; do
  write_default_state
  if "$HELPER" move-to-output "$address" HDMI-A-2 > "$TEST_ROOT/address.out" 2>&1; then
    fail "invalid or unknown address was accepted: $address"
  fi
  [[ ! -s "$DISPATCH_LOG" ]] || fail "dispatcher ran for invalid or unknown address: $address"
done
write_default_state
jq '. + [.[0]]' "$CLIENTS_FILE" > "$CLIENTS_FILE.tmp"
mv "$CLIENTS_FILE.tmp" "$CLIENTS_FILE"
if "$HELPER" move-to-output 0xaaa HDMI-A-2 > "$TEST_ROOT/ambiguous.out" 2>&1; then
  fail 'ambiguous address was accepted'
fi
grep -Fq 'ambiguous Hyprland window address: 0xaaa' "$TEST_ROOT/ambiguous.out" \
  || fail 'ambiguous address error was not specific'
[[ ! -s "$DISPATCH_LOG" ]] || fail 'dispatcher ran for ambiguous address'

printf 'test: unknown output fails before dispatch\n'
write_default_state
if "$HELPER" move-to-output 0xaaa NOT-A-MONITOR > "$TEST_ROOT/output.out" 2>&1; then
  fail 'unknown output was accepted'
fi
grep -Fq 'unknown Hyprland output: NOT-A-MONITOR' "$TEST_ROOT/output.out" \
  || fail 'unknown output error was not specific'
[[ ! -s "$DISPATCH_LOG" ]] || fail 'dispatcher ran for unknown output'

printf 'test: failed postcondition is reported instead of success\n'
write_default_state
export HYPR_TEST_NO_MUTATE=1
if "$HELPER" move-to-output 0xaaa HDMI-A-2 > "$TEST_ROOT/unverified.out" 2>&1; then
  fail 'unverified move was reported as successful'
fi
unset HYPR_TEST_NO_MUTATE
grep -Fq 'unable to verify window 0xaaa on workspace 5 of monitor 1' "$TEST_ROOT/unverified.out" \
  || fail 'move verification failure was not specific'
grep -Fxq 'movetoworkspacesilent <5,address:0xaaa>' "$DISPATCH_LOG" \
  || fail 'postcondition test did not dispatch the move'

printf 'PASS: cua-omarchy-window helper tests\n'
