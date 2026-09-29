#!/usr/bin/env bash
# Install the reviewed xr-hardware rules. No firmware operations or broad chmod.
set -Eeuo pipefail
export PATH=/usr/bin:/bin

if (( EUID != 0 )); then
  printf 'Run this installer with sudo or pkexec.\n' >&2
  exit 1
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_rules="$repo_root/configs/omarchy/psvr2/70-xrhardware.rules"
target_rules=/etc/udev/rules.d/70-xrhardware.rules
expected_hash=4531d8ba2d1c72c33cf7a9c4c11f34142bf4446245a2e71427943347ab9c55da
printf '%s  %s\n' "$expected_hash" "$source_rules" | sha256sum --check --status
udevadm verify "$source_rules"

if [[ -L "$target_rules" ]]; then
  printf 'Refusing to replace symlink: %s\n' "$target_rules" >&2
  exit 1
fi
if [[ -e "$target_rules" && ! -f "$target_rules" ]]; then
  printf 'Refusing to replace non-file: %s\n' "$target_rules" >&2
  exit 1
fi
if ! cmp -s "$source_rules" "$target_rules"; then
  if [[ -f "$target_rules" ]]; then
    backup="$(mktemp "${target_rules}.backup.XXXXXX")"
    cp --preserve=mode,timestamps -- "$target_rules" "$backup"
    printf 'Previous rules backed up to %s\n' "$backup"
  fi
  install -Dm644 -- "$source_rules" "$target_rules"
fi
# Reapply even on a rerun: the device may have been attached before the rules.
udevadm control --reload-rules
udevadm trigger --action=change --subsystem-match=usb --attr-match=idVendor=054c
udevadm trigger --action=change --subsystem-match=hidraw
udevadm settle --timeout=10
printf 'XR hardware access rules installed and reloaded.\n'
