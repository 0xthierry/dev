#!/bin/sh

set -e

SIDEPROJECTS_DIR="$HOME/Work/Sideprojects"
MEISTRARI_DIR="$HOME/Work/Meistrari"

mkdir -p "$SIDEPROJECTS_DIR" "$MEISTRARI_DIR"

clone_repos() {
    target_dir="$1"
    owner="$2"

    echo "Syncing $owner repos to $target_dir..."

    repos=$(gh repo list "$owner" --limit 1000 --json nameWithOwner --jq '.[].nameWithOwner')

    for repo in $repos; do
        repo_name=$(basename "$repo")
        dest="$target_dir/$repo_name"

        if [ -d "$dest" ]; then
            echo "  Pulling $repo_name..."
            git -C "$dest" pull --ff-only
        else
            echo "  Cloning $repo_name..."
            gh repo clone "$repo" "$dest"
        fi
    done
}

clone_repos "$SIDEPROJECTS_DIR" "$(gh api user --jq '.login')"
clone_repos "$MEISTRARI_DIR" "meistrari"

echo "Done!"
