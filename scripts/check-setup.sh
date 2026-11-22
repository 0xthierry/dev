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
# Exercise supported hosts in isolated homes with network/package execution
# forbidden, and assert that the retired dev host is rejected.
python3 tests/setup-hosts.test.py
