#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! command -v gitleaks >/dev/null 2>&1; then
  printf 'error: gitleaks is required for security checks\n' >&2
  exit 1
fi

scan_tracked_worktree() {
  local tmp_dir=""
  local file=""

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  while IFS= read -r -d '' file; do
    [[ -e "$file" || -L "$file" ]] || continue
    mkdir -p "$tmp_dir/$(dirname "$file")"
    cp -P "$file" "$tmp_dir/$file"
  done < <(git ls-files -z)

  gitleaks dir "$tmp_dir" --redact=100 --no-banner
}

gitleaks git --log-opts=HEAD --redact=100 --no-banner

if ! git diff --cached --quiet --diff-filter=ACMR; then
  gitleaks git --staged --redact=100 --no-banner
fi

scan_tracked_worktree
