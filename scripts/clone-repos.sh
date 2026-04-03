#!/usr/bin/env bash

set -euo pipefail

SIDEPROJECTS_DIR="$HOME/Work/Sideprojects"
MEISTRARI_DIR="$HOME/Work/Meistrari"

dry_run_cmd() {
    local rendered=""
    local arg=""

    for arg in "$@"; do
        if [[ -n "$rendered" ]]; then
            rendered+=" "
        fi
        printf -v arg '%q' "$arg"
        rendered+="$arg"
    done

    printf '[dry-run] %s\n' "$rendered"
}

run_cmd() {
    if (( ${DRY_RUN:-0} )); then
        dry_run_cmd "$@"
        return 0
    fi

    "$@"
}

ensure_dir() {
    local dir_path="$1"

    if [[ -d "$dir_path" ]]; then
        return 0
    fi

    run_cmd mkdir -p "$dir_path"
}

ensure_dir "$SIDEPROJECTS_DIR"
ensure_dir "$MEISTRARI_DIR"

sync_existing_repo() {
    local repo_dir="$1"
    local repo_name="$2"
    local current_branch=""

    current_branch="$(git -C "$repo_dir" branch --show-current)"

    if [[ -z "$current_branch" ]]; then
        printf '  Skipping %s: detached HEAD\n' "$repo_name"
        return 0
    fi

    if git -C "$repo_dir" rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
        printf '  Pulling %s...\n' "$repo_name"
        run_cmd git -C "$repo_dir" pull --ff-only
        return 0
    fi

    if git -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$current_branch"; then
        printf '  Pulling %s from origin/%s...\n' "$repo_name" "$current_branch"
        run_cmd git -C "$repo_dir" pull --ff-only origin "$current_branch"
        return 0
    fi

    printf '  Skipping %s: no upstream or matching origin branch for %s\n' "$repo_name" "$current_branch"
}

clone_repos() {
    local target_dir="$1"
    local owner="$2"
    local repos=""
    local repo=""
    local repo_name=""
    local dest=""

    printf 'Syncing %s repos to %s...\n' "$owner" "$target_dir"

    if (( ${DRY_RUN:-0} )); then
        dry_run_cmd gh repo list "$owner" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner'
        return 0
    fi

    repos=$(gh repo list "$owner" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner')

    for repo in $repos; do
        repo_name=$(basename "$repo")
        dest="$target_dir/$repo_name"

        if [[ -d "$dest" ]]; then
            sync_existing_repo "$dest" "$repo_name"
        else
            printf '  Cloning %s...\n' "$repo_name"
            run_cmd gh repo clone "$repo" "$dest"
        fi
    done
}

if (( ${DRY_RUN:-0} )); then
    dry_run_cmd gh api user --jq .login
    clone_repos "$SIDEPROJECTS_DIR" "<current-user>"
    clone_repos "$MEISTRARI_DIR" "meistrari"
    printf 'Done!\n'
    exit 0
fi

clone_repos "$SIDEPROJECTS_DIR" "$(gh api user --jq '.login')"
clone_repos "$MEISTRARI_DIR" "meistrari"

printf 'Done!\n'
