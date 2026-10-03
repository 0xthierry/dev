#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
# shellcheck source=install/pacman.sh
source "$ROOT/install/pacman.sh"
TEMP="$(mktemp -d)"
trap 'rm -rf "$TEMP"' EXIT
fail() { printf 'not ok: %s\n' "$1" >&2; exit 1; }

# This integration boundary keeps the installer, awk, filesystem and cleanup
# real. Only the privileged package manager and system-config reader are fake.
REAL_PACMAN_CONF="$(command -v pacman-conf || true)"
export PACMAN_TEST_STATE="$TEMP/state"
export TMPDIR="$TEMP/tmp"
mkdir -p "$TEMP/bin" "$TEMP/no-commands" "$PACMAN_TEST_STATE" "$TMPDIR"
cat > "$TEMP/bin/sudo" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$@" > "$PACMAN_TEST_STATE/sudo.argv"
# Do not let a regression execute another privileged/system-changing command.
[[ "${1:-}" == pacman ]] || exit 90
"$@"
EOF
cat > "$TEMP/bin/pacman" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "$@" > "$PACMAN_TEST_STATE/pacman.argv"
: > "$PACMAN_TEST_STATE/install.argv"
config_count=0
while (( $# )); do
  if [[ "$1" == --config ]]; then
    ((config_count += 1))
    config="$2"
    printf '%s\n' "$config" > "$PACMAN_TEST_STATE/config.path"
    cp "$config" "$PACMAN_TEST_STATE/config.captured"
    stat -c '%a' "$(dirname "$config")" > "$PACMAN_TEST_STATE/directory.mode" 2>/dev/null ||
      stat -f '%Lp' "$(dirname "$config")" > "$PACMAN_TEST_STATE/directory.mode"
    shift 2
  else
    printf '%s\0' "$1" >> "$PACMAN_TEST_STATE/install.argv"
    shift
  fi
done
printf '%s\n' "$config_count" > "$PACMAN_TEST_STATE/config.count"
exit "${PACMAN_TEST_EXIT:-0}"
EOF
cat > "$TEMP/bin/pacman-conf" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
: > "$PACMAN_TEST_STATE/pacman-conf.argv"
if (( $# )); then
  printf '%s\0' "$@" > "$PACMAN_TEST_STATE/pacman-conf.argv"
fi
# Return the already expanded configuration exactly as real pacman-conf does.
# Emit it even on failure to exercise cleanup of partially written configs.
while IFS= read -r line || [[ -n "$line" ]]; do
  printf '%s\n' "$line"
done < "$PACMAN_TEST_STATE/system.conf"
exit "${PACMAN_CONF_TEST_EXIT:-0}"
EOF
chmod +x "$TEMP/bin/sudo" "$TEMP/bin/pacman" "$TEMP/bin/pacman-conf"
export PATH="$TEMP/bin:$PATH"

# The fixture includes security policy, custom paths, multiple primary servers,
# repository-specific settings, a similarly named testing repo and custom repos.
cat > "$PACMAN_TEST_STATE/system.conf" <<'EOF'
[options]
RootDir = /
DBPath = /var/lib/pacman/
CacheDir = /var/cache/pacman/pkg/
GPGDir = /etc/pacman.d/gnupg/
Architecture = x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
SigLevel = DatabaseRequired
SigLevel = DatabaseTrustedOnly
LocalFileSigLevel = PackageRequired
LocalFileSigLevel = PackageTrustedOnly
RemoteFileSigLevel = PackageRequired
RemoteFileSigLevel = PackageTrustedOnly
CheckSpace
[core]
Usage = All
Server = https://primary.example/core/os/x86_64
Server = https://secondary.example/core/os/x86_64
[extra]
Server = https://primary.example/extra/os/x86_64
Usage = Sync
Server = https://secondary.example/extra/os/x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
[multilib]
Usage = All
Server = https://primary.example/multilib/os/x86_64
[core-testing]
Usage = All
Server = https://testing.example/core-testing/os/x86_64
[omarchy]
Usage = All
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
Server = https://pkgs.omarchy.org/stable/x86_64
[custom]
Usage = Install
Server = https://custom.example/packages
EOF
cp "$PACMAN_TEST_STATE/system.conf" "$TEMP/system.before"
cat > "$TEMP/config.expected" <<'EOF'
[options]
RootDir = /
DBPath = /var/lib/pacman/
CacheDir = /var/cache/pacman/pkg/
GPGDir = /etc/pacman.d/gnupg/
Architecture = x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
SigLevel = DatabaseRequired
SigLevel = DatabaseTrustedOnly
LocalFileSigLevel = PackageRequired
LocalFileSigLevel = PackageTrustedOnly
RemoteFileSigLevel = PackageRequired
RemoteFileSigLevel = PackageTrustedOnly
CheckSpace
[core]
Usage = All
Server = https://primary.example/core/os/x86_64
Server = https://secondary.example/core/os/x86_64
Server = https://archive.archlinux.org/packages/.all
[extra]
Server = https://primary.example/extra/os/x86_64
Usage = Sync
Server = https://secondary.example/extra/os/x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
Server = https://archive.archlinux.org/packages/.all
[multilib]
Usage = All
Server = https://primary.example/multilib/os/x86_64
Server = https://archive.archlinux.org/packages/.all
[core-testing]
Usage = All
Server = https://testing.example/core-testing/os/x86_64
[omarchy]
Usage = All
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
Server = https://pkgs.omarchy.org/stable/x86_64
[custom]
Usage = Install
Server = https://custom.example/packages
EOF
printf '%s\0' -S --needed --noconfirm steam 'package with spaces' > "$TEMP/install.expected"
printf '%s\0' pacman -S --needed --noconfirm steam 'package with spaces' > "$TEMP/sudo.expected"

# Default behavior must not read system configuration or change install argv.
unset HOST_PACMAN_ARCHIVE_FALLBACK
DRY_RUN=0 install_pacman_packages steam 'package with spaces' > "$TEMP/default.log"
cmp -s "$TEMP/sudo.expected" "$PACMAN_TEST_STATE/sudo.argv" || fail 'default sudo argv changed'
cmp -s "$TEMP/install.expected" "$PACMAN_TEST_STATE/pacman.argv" || fail 'default pacman argv changed'
[[ ! -e "$PACMAN_TEST_STATE/pacman-conf.argv" ]] || fail 'default consulted pacman-conf'
[[ "$(< "$PACMAN_TEST_STATE/config.count")" == 0 ]] || fail 'default added --config'
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]] || fail 'default created temporary files'
printf 'ok: default preserves the original pacman command\n'

# Only the literal value 1 enables fallback, not another nonempty value.
HOST_PACMAN_ARCHIVE_FALLBACK=2 DRY_RUN=0 install_pacman_packages steam 'package with spaces' > "$TEMP/disabled.log"
cmp -s "$TEMP/sudo.expected" "$PACMAN_TEST_STATE/sudo.argv" || fail 'non-1 fallback changed sudo argv'
[[ ! -e "$PACMAN_TEST_STATE/pacman-conf.argv" ]] || fail 'non-1 fallback consulted pacman-conf'
printf 'ok: fallback requires explicit opt-in value 1\n'

# Capture the actual config while pacman can still read it, before cleanup.
HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=0 install_pacman_packages steam 'package with spaces' > "$TEMP/enabled.log"
[[ "$(< "$PACMAN_TEST_STATE/config.count")" == 1 ]] || fail 'fallback did not pass exactly one --config'
cmp -s "$TEMP/install.expected" "$PACMAN_TEST_STATE/install.argv" || fail 'fallback changed install args (including refresh/upgrade flags)'
printf '%s\0' pacman > "$TEMP/sudo-prefix.expected"
# sudo must run exactly the pacman command captured by the package manager.
cp "$TEMP/sudo-prefix.expected" "$TEMP/sudo-enabled.expected"
cat "$PACMAN_TEST_STATE/pacman.argv" >> "$TEMP/sudo-enabled.expected"
cmp -s "$TEMP/sudo-enabled.expected" "$PACMAN_TEST_STATE/sudo.argv" || fail 'sudo did not invoke the captured pacman command'
cmp -s "$TEMP/config.expected" "$PACMAN_TEST_STATE/config.captured" || fail 'fallback changed security/custom repos or primary-server order'
[[ ! -s "$PACMAN_TEST_STATE/pacman-conf.argv" ]] || fail 'pacman-conf did not expand the current system configuration'
[[ "$(< "$PACMAN_TEST_STATE/directory.mode")" == 700 ]] || fail 'temporary config directory is not private'
config_path="$(< "$PACMAN_TEST_STATE/config.path")"
[[ "$config_path" == "$TMPDIR/"* ]] || fail 'fallback config was not temporary'
[[ ! -e "$config_path" && ! -e "$(dirname "$config_path")" ]] || fail 'success left temporary config directory behind'
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]] || fail 'success left temporary files behind'
cmp -s "$TEMP/system.before" "$PACMAN_TEST_STATE/system.conf" || fail 'fallback permanently changed system config'
printf 'ok: fallback appends only to official repos, preserves security and cleans private config\n'

# Real libalpm config parsing is an additional check, not a fake parser claim.
if [[ -n "$REAL_PACMAN_CONF" ]]; then
  "$REAL_PACMAN_CONF" --config "$PACMAN_TEST_STATE/config.captured" > "$TEMP/parsed.actual"
  "$REAL_PACMAN_CONF" --config "$TEMP/config.expected" > "$TEMP/parsed.expected"
  cmp -s "$TEMP/parsed.expected" "$TEMP/parsed.actual" || fail 'real pacman-conf parsed an unexpected effective config'
  printf 'ok: real pacman-conf accepts the captured fallback config\n'
else
  printf 'skip: real pacman-conf parser check (not installed on this OS)\n'
fi

# A final official section with no servers must also get the fallback, without
# inventing extra/multilib sections absent from the current system config.
cat > "$PACMAN_TEST_STATE/system.conf" <<'EOF'
[options]
Architecture = x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
[custom]
Server = https://custom.example/packages
[core]
Usage = All
EOF
cat > "$TEMP/sparse.expected" <<'EOF'
[options]
Architecture = x86_64
SigLevel = PackageRequired
SigLevel = PackageTrustedOnly
[custom]
Server = https://custom.example/packages
[core]
Usage = All
Server = https://archive.archlinux.org/packages/.all
EOF
HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=0 install_pacman_packages steam > "$TEMP/sparse.log"
cmp -s "$TEMP/sparse.expected" "$PACMAN_TEST_STATE/config.captured" || fail 'fallback missed final empty repo or invented absent repositories'
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]] || fail 'sparse config left temporary files'
printf 'ok: fallback handles final empty official repo without creating missing repos\n'

# Pacman failure propagates even when the caller disables errexit via `if`.
if HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=0 PACMAN_TEST_EXIT=24 install_pacman_packages steam > "$TEMP/pacman-error.log" 2>&1; then
  fail 'pacman failure succeeded'
else
  status=$?
fi
[[ "$status" == 24 ]] || fail 'pacman failure status lost'
config_path="$(< "$PACMAN_TEST_STATE/config.path")"
[[ ! -e "$config_path" && ! -e "$(dirname "$config_path")" ]] || fail 'pacman failure left config directory'
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]] || fail 'pacman failure left temporary files'
printf 'ok: pacman failure propagates and cleans temporary config\n'

# A failed config expansion must not invoke sudo/pacman with partial output.
rm -f "$PACMAN_TEST_STATE/sudo.argv" "$PACMAN_TEST_STATE/pacman.argv"
if HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=0 PACMAN_CONF_TEST_EXIT=23 install_pacman_packages steam > "$TEMP/config-error.log" 2>&1; then
  fail 'pacman-conf failure succeeded'
else
  status=$?
fi
[[ "$status" == 23 ]] || fail 'pacman-conf failure status lost'
[[ ! -e "$PACMAN_TEST_STATE/sudo.argv" && ! -e "$PACMAN_TEST_STATE/pacman.argv" ]] || fail 'installed after config expansion failure'
[[ -z "$(find "$TMPDIR" -mindepth 1 -print -quit)" ]] || fail 'pacman-conf failure left temporary files'
printf 'ok: pacman-conf failure propagates without attempting installation\n'

# Dry-run needs no external commands and cannot even create a temp directory.
rm -f "$PACMAN_TEST_STATE/pacman-conf.argv"
HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=1 PATH="$TEMP/no-commands" TMPDIR="$TEMP/no-write" install_pacman_packages steam 'package with spaces' > "$TEMP/dry.log"
grep -Fq 'https://archive.archlinux.org/packages/.all' "$TEMP/dry.log" || fail 'dry-run omitted archive fallback intent'
grep -Eiq 'temporary|temp config' "$TEMP/dry.log" || fail 'dry-run omitted temporary config intent'
grep -Fq 'core/extra/multilib' "$TEMP/dry.log" || fail 'dry-run omitted official-repo scope'
grep -Fxq '[dry-run] sudo pacman -S --needed --noconfirm steam package\ with\ spaces' "$TEMP/dry.log" || fail 'dry-run omitted install plan'
[[ ! -e "$TEMP/no-write" ]] || fail 'dry-run created temporary config'
[[ ! -e "$PACMAN_TEST_STATE/pacman-conf.argv" && ! -e "$PACMAN_TEST_STATE/sudo.argv" && ! -e "$PACMAN_TEST_STATE/pacman.argv" ]] || fail 'dry-run invoked external commands'
printf 'ok: dry-run describes fallback and install plan without tools or temporary writes\n'

# Empty package lists are silent no-ops even with fallback enabled and no tools.
HOST_PACMAN_ARCHIVE_FALLBACK=1 DRY_RUN=0 PATH="$TEMP/no-commands" TMPDIR="$TEMP/no-write" install_pacman_packages > "$TEMP/empty.log"
[[ ! -s "$TEMP/empty.log" ]] || fail 'empty package list produced an install plan'
[[ ! -e "$TEMP/no-write" && ! -e "$PACMAN_TEST_STATE/pacman-conf.argv" && ! -e "$PACMAN_TEST_STATE/sudo.argv" && ! -e "$PACMAN_TEST_STATE/pacman.argv" ]] || fail 'empty package list performed work'
printf 'ok: empty package list is a silent no-op\n'
