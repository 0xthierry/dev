#!/usr/bin/env bash
# Install only the makepkg/telemetry profile. No package, service, or swap actions.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

configure_interactive_makepkg() {
  local src="$REPO_ROOT/configs/omarchy/makepkg-interactive.conf" target=/etc/makepkg.conf.d/90-dev-setup-interactive.conf
  if [[ ! -e $target ]]; then
    if [[ -L $target ]]; then echo "Refusing dangling symlink: $target" >&2; return 1; fi
    run_cmd sudo install -Dm644 "$src" "$target"
  elif [[ -L $target ]] || ! cmp -s "$src" "$target"; then
    echo "Conflicting makepkg drop-in: $target; inspect before replacing" >&2; return 1
  fi
}

configure_sysstat_retention() {
  local conf=/etc/conf.d/sysstat
  if [[ -L $conf || ! -f $conf ]]; then echo "Missing or linked sysstat configuration: $conf" >&2; return 1; fi
  if grep -qx 'HISTORY=28' "$conf" && [[ $(grep -c '^HISTORY=' "$conf") == 1 ]]; then return 0; fi
  if [[ $(grep -c '^HISTORY=' "$conf") != 1 ]] || ! grep -Eq '^HISTORY=[0-9]+$' "$conf"; then
    echo "Unexpected sysstat HISTORY config; not rewriting" >&2; return 1
  fi
  # sysstat's sa2 reads this file for retention. No restart or reset of today's file.
  run_cmd sudo sed -i -E 's/^HISTORY=[0-9]+$/HISTORY=28/' "$conf"
}

retire_overridden_vm_dropins() {
  local row src target vendor saved
  for row in 'zram-generator.conf:/etc/systemd/zram-generator.conf.d/90-dev-setup.conf:/usr/lib/systemd/zram-generator.conf.d/90-omarchy.conf' 'sysctl-vm.conf:/etc/sysctl.d/90-dev-setup-vm.conf:/etc/sysctl.d/99-omarchy-sysctl.conf'; do
    IFS=: read -r src target vendor <<< "$row"
    [[ -f $vendor && -f $target ]] || continue
    if [[ -L $target ]] || ! cmp -s "$REPO_ROOT/configs/omarchy/$src" "$target"; then
      log_item "Leaving customized override untouched: $target"; continue
    fi
    saved="${target}.pre-quattro-perf"
    if [[ -e $saved || -L $saved ]]; then log_item "Backup exists; leaving $target untouched"; continue; fi
    run_cmd sudo mv -nT -- "$target" "$saved"
  done
  # Both are superseded by packaged Quattro defaults. Never swapoff, resize
  # active zram, or reapply unrelated sysctls just to retire these old files.
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  case ${1:-} in --dry-run) DRY_RUN=1;; --apply) DRY_RUN=0;; *) echo "usage: $0 --dry-run|--apply" >&2; exit 2;; esac
  REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
  configure_interactive_makepkg
  configure_sysstat_retention
  retire_overridden_vm_dropins
fi
