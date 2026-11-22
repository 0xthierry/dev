#!/usr/bin/env bash
# Opt out of distro-provided lazy AI tools without editing vendor configuration.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

disable_retired_ai_tools() {
  local mise_bin=""
  if ! mise_bin="$(resolve_mise_bin 2>/dev/null)"; then
    if (( ${DRY_RUN:-0} )); then
      log_item "[dry-run] Disable mise tools: amp, cursor-agent, grok, opencode"
      return 0
    fi
    printf 'error: mise is required to disable retired AI tools\n' >&2
    return 1
  fi

  # Use mise's TOML-preserving editor and its high-priority global override.
  # The override survives write_mise_config and wins over distro/project tools.
  # Read from HOME, not the calling project, to avoid persisting project settings.
  python3 - "$mise_bin" "${DRY_RUN:-0}" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys

mise, dry_run = sys.argv[1:]
command = [mise, '-C', os.path.expanduser('~')]
current = json.loads(subprocess.check_output(
    command + ['settings', 'get', 'disable_tools'], text=True))
if not isinstance(current, list) or any(not isinstance(item, str) for item in current):
    raise SystemExit('error: mise disable_tools must be an array of strings')
merged = sorted(set([*current, 'amp', 'cursor-agent', 'grok', 'opencode']))
# Only neutralize the known distro integration, never invent a Grok command on
# hosts without it. The file is read-only; mise owns editing the user override.
vendor = Path(os.environ.get('MISE_SYSTEM_CONFIG_DIR', '/etc/mise')) / 'conf.d/omarchy-agent-accounts.toml'
block_wrapper = False
if vendor.is_file():
    import tomllib  # Quattro ships Python 3.11+; not needed on a stock Mac.
    block_wrapper = 'grok' in tomllib.loads(vendor.read_text()).get('wrappers', {})
if block_wrapper:
    override = subprocess.run(command + ['config', 'get', '--override'],
                              capture_output=True, text=True)
    existing = tomllib.loads(override.stdout).get('wrappers', {}).get('grok') if override.returncode == 0 else None
    if existing not in (None, '/usr/bin/false'):
        raise SystemExit('error: existing user override wrappers.grok is not owned by this helper; reconcile it explicitly')
    if not os.access('/usr/bin/false', os.X_OK):
        raise SystemExit('error: /usr/bin/false is required to block the distro Grok wrapper')
if dry_run != '0':
    print('[dry-run] mise global override disable_tools = ' + json.dumps(merged))
    if block_wrapper:
        print('[dry-run] mise global override wrappers.grok = /usr/bin/false')
else:
    subprocess.run(command + ['settings', 'set', '--override', 'disable_tools',
                             ','.join(merged)], check=True)
    # Tool disabling does not disable distro command wrappers. Replace only
    # Grok's wrapper so activation cannot revive the account-manager launcher.
    if block_wrapper:
        subprocess.run(command + ['config', 'set', '--override', 'wrappers.grok',
                                 '/usr/bin/false'], check=True)
PY
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-}" in
    --dry-run) DRY_RUN=1 ;;
    '') ;;
    *) printf 'usage: bash install/retired-ai-tools.sh [--dry-run]\n' >&2; exit 2 ;;
  esac
  disable_retired_ai_tools
fi
