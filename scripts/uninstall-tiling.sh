#!/usr/bin/env bash
set -euo pipefail

# Uninstall AeroSpace + SketchyBar + JankyBorders and restore macOS defaults

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { echo "  $1"; }
section() { echo ""; echo "=== $1 ==="; }

safe_remove_symlink() {
  local target="$1"
  if [[ -L "$target" ]]; then
    local resolved
    resolved="$(readlink "$target")"
    if [[ "$resolved" == "$REPO_ROOT"* ]]; then
      log "Removing symlink: $target -> $resolved"
      rm "$target"
    else
      log "Skipping: $target (not managed by this repo, points to $resolved)"
    fi
  elif [[ -e "$target" ]]; then
    log "Skipping: $target (not a symlink, not managed by this repo)"
  fi
}

section "Stopping services"
log "Stopping SketchyBar..."
killall sketchybar 2>/dev/null || true

log "Stopping JankyBorders..."
killall borders 2>/dev/null || true

log "Stopping AeroSpace..."
killall AeroSpace 2>/dev/null || true

section "Removing repo-managed config symlinks"
safe_remove_symlink "$HOME/.config/aerospace/aerospace.toml"
safe_remove_symlink "$HOME/.config/sketchybar/sketchybarrc"
safe_remove_symlink "$HOME/.config/sketchybar/plugins"
safe_remove_symlink "$HOME/.config/borders/bordersrc"

# Clean up empty config dirs (only if empty)
rmdir "$HOME/.config/aerospace" 2>/dev/null || true
rmdir "$HOME/.config/sketchybar" 2>/dev/null || true
rmdir "$HOME/.config/borders" 2>/dev/null || true

section "Uninstalling packages"
log "Uninstalling AeroSpace..."
brew uninstall --cask aerospace 2>/dev/null || true

log "Uninstalling SketchyBar..."
brew uninstall sketchybar 2>/dev/null || true

log "Uninstalling JankyBorders..."
brew uninstall borders 2>/dev/null || true

section "Restoring macOS defaults"
log "Showing macOS menu bar"
defaults write NSGlobalDomain _HIHideMenuBar -bool false

log "Re-enabling native window tiling"
defaults write com.apple.WindowManager EnableTilingByEdgeDrag -bool true
defaults write com.apple.WindowManager EnableTopTilingByEdgeDrag -bool true
defaults write com.apple.WindowManager EnableTilingOptionAccelerator -bool true
defaults write com.apple.WindowManager EnableTiledWindowMargins -bool true

section "Done"
log "AeroSpace, SketchyBar, and JankyBorders have been removed."
log "macOS menu bar and native tiling restored."
log "You may need to log out and back in for all changes to take effect."
