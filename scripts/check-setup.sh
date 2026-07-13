#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

bash -n setup.sh install/*.sh install/hosts/*.sh scripts/clone-repos.sh scripts/security-check.sh
bash -n scripts/check-setup.sh scripts/test-ssh-config.sh .githooks/pre-commit
shellcheck setup.sh install/*.sh install/hosts/*.sh scripts/clone-repos.sh scripts/security-check.sh
shellcheck scripts/check-setup.sh scripts/test-ssh-config.sh .githooks/pre-commit
./scripts/security-check.sh
./scripts/test-ssh-config.sh
./setup.sh dev --dry-run >/dev/null
./setup.sh omarchy --dry-run >/dev/null
./setup.sh macbook --dry-run >/dev/null
