#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_HOME="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_HOME"
}

trap cleanup EXIT
export HOME="$TMP_HOME"
export XDG_CONFIG_HOME="$TMP_HOME/.config"
export XDG_DATA_HOME="$TMP_HOME/.local/share"
export XDG_CACHE_HOME="$TMP_HOME/.cache"
export XDG_STATE_HOME="$TMP_HOME/.local/state"

bash -c "
  set -euo pipefail
  source '$REPO_ROOT/install/lib.sh'
  source '$REPO_ROOT/install/ssh.sh'
  unset HOST_SSH_CONFIG_LINES || true
  write_ssh_config
  test -f '$TMP_HOME/.ssh/config.d/dev-setup.conf'
  grep -Fqx 'Host *' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
  grep -Fqx '  AddKeysToAgent yes' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
"

bash -c "
  set -euo pipefail
  source '$REPO_ROOT/install/lib.sh'
  source '$REPO_ROOT/install/ssh.sh'
  HOST_SSH_CONFIG_LINES=()
  write_ssh_config
  grep -Fqx 'Host *' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
  grep -Fqx '  AddKeysToAgent yes' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
"

bash -c "
  set -euo pipefail
  source '$REPO_ROOT/install/lib.sh'
  source '$REPO_ROOT/install/ssh.sh'
  HOST_SSH_CONFIG_LINES=(
    'Host github.com'
    '  User git'
  )
  write_ssh_config
  grep -Fqx 'Host github.com' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
  grep -Fqx '  User git' '$TMP_HOME/.ssh/config.d/dev-setup.conf'
"
