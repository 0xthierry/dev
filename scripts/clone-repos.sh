#!/usr/bin/env bash

set -euo pipefail

SIDEPROJECTS_DIR="$HOME/Work/Sideprojects"
MEISTRARI_DIR="$HOME/Work/Meistrari"
MAX_PARALLEL_SYNC="${MAX_PARALLEL_SYNC:-4}"

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

if ! [[ "$MAX_PARALLEL_SYNC" =~ ^[1-9][0-9]*$ ]]; then
    printf 'error: MAX_PARALLEL_SYNC must be a positive integer, got %s\n' "$MAX_PARALLEL_SYNC" >&2
    exit 1
fi

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

sync_repo_task() {
    local target_dir="$1"
    local repo="$2"
    local repo_name=""
    local dest=""

    repo_name="$(basename "$repo")"
    dest="$target_dir/$repo_name"

    if [[ -d "$dest" ]]; then
        sync_existing_repo "$dest" "$repo_name"
        return 0
    fi

    printf '  Cloning %s...\n' "$repo_name"
    run_cmd gh repo clone "$repo" "$dest"
}

wait_for_sync_pid() {
    local pid="$1"
    local label="$2"

    if wait "$pid"; then
        return 0
    fi

    printf '  Failed: %s\n' "$label" >&2
    return 1
}

clone_repos() {
    local target_dir="$1"
    local owner="$2"
    local repos=""
    local repo=""
    local -a pids=()
    local -a labels=()
    local pid=""
    local label=""
    local had_failure=0

    printf 'Syncing %s repos to %s...\n' "$owner" "$target_dir"

    if (( ${DRY_RUN:-0} )); then
        dry_run_cmd gh repo list "$owner" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner'
        return 0
    fi

    repos=$(gh repo list "$owner" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner')

    for repo in $repos; do
        sync_repo_task "$target_dir" "$repo" &
        pids+=("$!")
        labels+=("$repo")

        if (( ${#pids[@]} >= MAX_PARALLEL_SYNC )); then
            pid="${pids[0]}"
            label="${labels[0]}"

            if ! wait_for_sync_pid "$pid" "$label"; then
                had_failure=1
            fi

            pids=("${pids[@]:1}")
            labels=("${labels[@]:1}")
        fi
    done

    for pid in "${pids[@]}"; do
        label="${labels[0]}"

        if ! wait_for_sync_pid "$pid" "$label"; then
            had_failure=1
        fi

        labels=("${labels[@]:1}")
    done

    if (( had_failure )); then
        return 1
    fi
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
