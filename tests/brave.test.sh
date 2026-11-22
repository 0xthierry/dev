#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/configs.sh
source "$ROOT/install/configs.sh"
# shellcheck source=install/hosts/omarchy.sh
source "$ROOT/install/hosts/omarchy.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT

fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

export REPO_ROOT="$ROOT"
export HOME="$TEMP/home with spaces"
export COMMAND_LOG="$TEMP/commands.log"
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications" "$TEMP/bin"
cat > "$TEMP/bin/update-desktop-database" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$COMMAND_LOG"
EOF
export DEFAULT_BROWSER_STATE="$TEMP/default-browser"
export MIME_STATE="$TEMP/mime"
export WRITE_LOG="$TEMP/writes.log"
export LAUNCH_LOG="$TEMP/launches.log"
export XDG_CURRENT_DESKTOP=Hyprland
mkdir -p "$MIME_STATE"
: > "$WRITE_LOG"
: > "$LAUNCH_LOG"
printf 'brave\n' > "$DEFAULT_BROWSER_STATE"
for mime in text_html application_xhtml+xml x-scheme-handler_http x-scheme-handler_https; do
  printf 'brave-browser.desktop\n' > "$MIME_STATE/$mime"
done
printf 'omarchy-browser.desktop\n' > "$MIME_STATE/hyprland-router"
cat > "$TEMP/bin/omarchy" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'omarchy %s\n' "$*" >> "$COMMAND_LOG"
case "$*" in
  'default browser') cat "$DEFAULT_BROWSER_STATE" ;;
  'default browser brave')
    printf 'omarchy %s\n' "$*" >> "$WRITE_LOG"
    printf 'brave\n' > "$DEFAULT_BROWSER_STATE"
    ;;
  *) exit 2 ;;
esac
EOF
cat > "$TEMP/bin/xdg-mime" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'desktop=%s xdg-mime %s\n' "${XDG_CURRENT_DESKTOP-unset}" "$*" >> "$COMMAND_LOG"
case "$1" in
  query) [[ "$2" == default && "$#" == 3 ]]; mime="$3" ;;
  default) [[ "$2" == brave-browser.desktop && "$#" == 3 ]]; mime="$3" ;;
  *) exit 2 ;;
esac
case "$mime" in
  text/html|application/xhtml+xml|x-scheme-handler/http|x-scheme-handler/https) ;;
  *) exit 2 ;;
esac
state="$MIME_STATE/${mime//\//_}"
if [[ "$mime" == x-scheme-handler/* && -n "${XDG_CURRENT_DESKTOP:-}" ]]; then
  state="$MIME_STATE/hyprland-router"
fi
if [[ "$1" == query ]]; then
  cat "$state"
else
  printf 'desktop=%s xdg-mime %s\n' "${XDG_CURRENT_DESKTOP-unset}" "$*" >> "$WRITE_LOG"
  printf '%s\n' "$2" > "$state"
fi
EOF
# Fail closed on obsolete setters and browser launch attempts; never reach the host.
cat > "$TEMP/bin/xdg-settings" <<'EOF'
#!/usr/bin/env bash
printf 'unexpected xdg-settings %s\n' "$*" >> "$WRITE_LOG"
exit 1
EOF
cat > "$TEMP/bin/browser-launch-guard" <<'EOF'
#!/usr/bin/env bash
printf '%s %s\n' "$0" "$*" >> "$LAUNCH_LOG"
exit 1
EOF
chmod +x "$TEMP/bin/"*
for command in brave brave-browser brave-browser-stable brave-wrapper chromium google-chrome xdg-open omarchy-launch-browser; do
  ln -s browser-launch-guard "$TEMP/bin/$command"
done
export PATH="$TEMP/bin:$PATH"

# Arrange: setup must preserve drifted/user-owned entries before converging.
printf 'old desktop entry\n' > "$HOME/.local/share/applications/brave-browser.desktop"
printf 'old brave command\n' > "$HOME/.local/bin/brave"

# Act
DRY_RUN=0 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/install.log"

# Assert: all launch names converge on the one wrapper that adds loopback CDP.
for command in brave-wrapper brave brave-browser brave-browser-stable; do
  [[ "$(readlink "$HOME/.local/bin/$command")" == "$ROOT/configs/brave/brave-wrapper" ]] \
    || fail "wrong Brave command link: $command"
done
[[ "$(readlink "$HOME/.local/share/applications/brave-browser.desktop")" == "$ROOT/configs/brave/brave-browser.desktop" ]] \
  || fail "desktop entry did not converge to the repo source"
grep -Fxq 'old brave command' "$HOME/.local/bin/brave.bak" || fail "existing Brave command was not preserved"
grep -Fxq 'old desktop entry' "$HOME/.local/share/applications/brave-browser.desktop.bak" \
  || fail "drifted desktop entry was not preserved"
grep -Fxq "$HOME/.local/share/applications" "$COMMAND_LOG" || fail "desktop database was not refreshed"
printf 'ok: every Brave launch name and the desktop entry converge on repo-owned CDP configuration\n'

# Act: rerunning setup must be a no-op for links and backups.
DRY_RUN=0 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/repeated.log"

# Assert
[[ ! -e "$HOME/.local/bin/brave.bak.1" ]] || fail "repeat install created another Brave backup"
[[ ! -e "$HOME/.local/share/applications/brave-browser.desktop.bak.1" ]] \
  || fail "repeat install created another desktop backup"
printf 'ok: repeated Brave setup is idempotent\n'

# Act: dry-run reports every link without changing a fresh HOME.
export HOME="$TEMP/dry run home"
DRY_RUN=1 SETUP_HOST=omarchy apply_brave_linux > "$TEMP/dry-run.log"

# Assert
[[ ! -e "$HOME" ]] || fail "dry-run changed HOME"
for command in brave-wrapper brave brave-browser brave-browser-stable; do
  grep -Fq "Brave command $command: linked" "$TEMP/dry-run.log" || fail "dry-run omitted $command"
done
printf 'ok: Brave dry-run reports complete configuration without writes\n'

# Act: current Brave and all four correct associations must remain untouched.
: > "$COMMAND_LOG"
DRY_RUN=0 set_default_browser_brave > "$TEMP/default-current.log"

# Assert: native routing and generic scheme associations are distinct boundaries.
grep -Fxq 'omarchy default browser' "$COMMAND_LOG" || fail "native default was not read"
grep -Fxq 'desktop= xdg-mime query default x-scheme-handler/http' "$COMMAND_LOG" || fail "generic HTTP was not read"
grep -Fxq 'desktop= xdg-mime query default x-scheme-handler/https' "$COMMAND_LOG" || fail "generic HTTPS was not read"
[[ ! -s "$WRITE_LOG" ]] || fail "current Brave associations were rewritten"
[[ "$(cat "$DEFAULT_BROWSER_STATE")" == brave ]] || fail "current native default changed"
printf 'ok: current native Brave and all four associations are left untouched\n'

# Arrange/Act: a different native default converges through Quattro, not xdg-settings.
printf 'firefox\n' > "$DEFAULT_BROWSER_STATE"
DRY_RUN=0 set_default_browser_brave > "$TEMP/default-change.log"

# Assert
[[ "$(cat "$WRITE_LOG")" == 'omarchy default browser brave' ]] || fail "native default did not use the sole targeted setter"
[[ "$(cat "$DEFAULT_BROWSER_STATE")" == brave ]] || fail "Brave did not become the native default"
printf 'ok: different native browser converges through Omarchy\n'

# Arrange/Act: HTML drift is repaired independently of native routing and schemes.
: > "$WRITE_LOG"
printf 'firefox.desktop\n' > "$MIME_STATE/text_html"
DRY_RUN=0 set_default_browser_brave > "$TEMP/html-change.log"

# Assert
[[ "$(cat "$WRITE_LOG")" == 'desktop=Hyprland xdg-mime default brave-browser.desktop text/html' ]] || fail "HTML repair rewrote unrelated associations"
[[ "$(cat "$MIME_STATE/text_html")" == brave-browser.desktop ]] || fail "HTML drift was not repaired"
printf 'ok: HTML-only drift is repaired without rewriting Omarchy or schemes\n'

# Arrange/Act: XHTML drift is independently repaired as well.
: > "$WRITE_LOG"
printf 'firefox.desktop\n' > "$MIME_STATE/application_xhtml+xml"
DRY_RUN=0 set_default_browser_brave > "$TEMP/xhtml-change.log"

# Assert
[[ "$(cat "$WRITE_LOG")" == 'desktop=Hyprland xdg-mime default brave-browser.desktop application/xhtml+xml' ]] || fail "XHTML repair rewrote unrelated associations"
[[ "$(cat "$MIME_STATE/application_xhtml+xml")" == brave-browser.desktop ]] || fail "XHTML drift was not repaired"
printf 'ok: XHTML-only drift is repaired independently\n'

# Arrange/Act: generic HTTP drift must not replace the stock Hyprland router.
: > "$WRITE_LOG"
printf 'omarchy-browser.desktop\n' > "$MIME_STATE/x-scheme-handler_http"
DRY_RUN=0 set_default_browser_brave > "$TEMP/http-change.log"

# Assert
[[ "$(cat "$WRITE_LOG")" == 'desktop= xdg-mime default brave-browser.desktop x-scheme-handler/http' ]] || fail "generic HTTP repair targeted the wrong desktop or associations"
[[ "$(cat "$MIME_STATE/x-scheme-handler_http")" == brave-browser.desktop ]] || fail "generic HTTP drift was not repaired"
[[ "$(cat "$MIME_STATE/hyprland-router")" == omarchy-browser.desktop ]] || fail "stock Hyprland browser router was replaced"
printf 'ok: generic HTTP drift is repaired without replacing the Hyprland router\n'

# Arrange/Act: generic HTTPS has the same independent repair contract.
: > "$WRITE_LOG"
printf 'firefox.desktop\n' > "$MIME_STATE/x-scheme-handler_https"
DRY_RUN=0 set_default_browser_brave > "$TEMP/https-change.log"

# Assert
[[ "$(cat "$WRITE_LOG")" == 'desktop= xdg-mime default brave-browser.desktop x-scheme-handler/https' ]] || fail "generic HTTPS repair targeted the wrong desktop or associations"
[[ "$(cat "$MIME_STATE/x-scheme-handler_https")" == brave-browser.desktop ]] || fail "generic HTTPS drift was not repaired"
[[ "$(cat "$MIME_STATE/hyprland-router")" == omarchy-browser.desktop ]] || fail "HTTPS repair replaced the Hyprland router"
printf 'ok: generic HTTPS drift is repaired independently\n'

# Arrange/Act: dry-run with every association drifted must perform no writes.
: > "$WRITE_LOG"
printf 'firefox\n' > "$DEFAULT_BROWSER_STATE"
for mime in text_html application_xhtml+xml x-scheme-handler_http x-scheme-handler_https; do
  printf 'firefox.desktop\n' > "$MIME_STATE/$mime"
done
cp -R "$MIME_STATE" "$TEMP/mime-before-dry-run"
DRY_RUN=1 set_default_browser_brave > "$TEMP/default-dry-run.log"

# Assert
[[ ! -s "$WRITE_LOG" ]] || fail "default-browser dry-run invoked a setter"
[[ "$(cat "$DEFAULT_BROWSER_STATE")" == firefox ]] || fail "dry-run changed native browser"
diff -r "$TEMP/mime-before-dry-run" "$MIME_STATE" || fail "dry-run changed MIME associations"
grep -Fq 'omarchy default browser brave' "$TEMP/default-dry-run.log" || fail "dry-run omitted native repair"
grep -Fq 'text/html' "$TEMP/default-dry-run.log" || fail "dry-run omitted HTML repair"
grep -Fq 'application/xhtml+xml' "$TEMP/default-dry-run.log" || fail "dry-run omitted XHTML repair"
grep -Fq 'x-scheme-handler/http' "$TEMP/default-dry-run.log" || fail "dry-run omitted HTTP repair"
grep -Fq 'x-scheme-handler/https' "$TEMP/default-dry-run.log" || fail "dry-run omitted HTTPS repair"
[[ ! -s "$LAUNCH_LOG" ]] || fail "setup attempted to launch a browser"
printf 'ok: default-browser dry-run reports repairs without writes or browser launches\n'
