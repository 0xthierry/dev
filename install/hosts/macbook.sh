#!/usr/bin/env bash

# shellcheck disable=SC2034
HOST_ENV_VARS=(
  "TZ=America/Sao_Paulo"
  "LANG=en_US.UTF-8"
  "LC_ALL=en_US.UTF-8"
)

# shellcheck disable=SC2034
HOST_WORK_DIRS=(
  "$HOME/Work/Sideprojects"
  "$HOME/Work/Meistrari"
)

# shellcheck disable=SC2034
HOST_CONFIG_TARGETS=(
  nvim
  voxtype
  ghostty
  herdr
  raycast
  agents
)

# shellcheck disable=SC2034
HOST_BREW_CASKS=(
  bambu-studio
  bitwarden
  brave-browser
  chatgpt
  claude
  dbeaver-community
  discord
  figma
  ghostty
  linear
  obs
  obsidian
  orbstack
  raycast
  rectangle
  slack
  signal
  spotify
  steam
  tailscale-app
  telegram
  zed
)

VOXTYPE_VERSION="0.7.5"
VOXTYPE_PARAKEET_MODEL="parakeet-tdt-0.6b-v3-int8"
VOXTYPE_SOURCE_DIR="$HOME/.cache/dev-setup/voxtype"
VOXTYPE_BUILD_FEATURES="parakeet"

apply_macos_defaults() {
  log_section "macOS Defaults"

  log_item "Disabling native window tiling (using Rectangle instead)"
  run_cmd defaults write com.apple.WindowManager EnableTilingByEdgeDrag -bool false
  run_cmd defaults write com.apple.WindowManager EnableTopTilingByEdgeDrag -bool false
  run_cmd defaults write com.apple.WindowManager EnableTilingOptionAccelerator -bool false
  run_cmd defaults write com.apple.WindowManager EnableTiledWindowMargins -bool false

  log_item "Enabling Rectangle launch at login"
  run_cmd defaults write com.knollsoft.Rectangle launchOnLogin -bool true

  log_item "Setting default browser to Brave (may prompt for confirmation)"
  run_cmd open -a "Brave Browser" --args --make-default-browser
}

setup_host_prereqs() {
  log_section "Host Prerequisites"
  log_item "Preparing macbook host prerequisites"
}

setup_host_packages() {
  log_section "Host Packages"
  log_item "Installing shared CLI package set for macbook"
  setup_shared_cli_packages
  install_codex_app_macos
}

setup_shared_machine_state() {
  log_section "Shared Machine State"
  apply_shared_machine_state
}

voxtype_parakeet_model_installed() {
  local model_dir="$HOME/Library/Application Support/voxtype/models/$VOXTYPE_PARAKEET_MODEL"

  if [[ -f "$model_dir/encoder-model.int8.onnx" ]] && \
    [[ -f "$model_dir/decoder_joint-model.int8.onnx" ]] && \
    [[ -f "$model_dir/vocab.txt" ]] && \
    [[ -f "$model_dir/config.json" ]]; then
    return 0
  fi

  [[ -f "$model_dir/encoder-model.onnx" ]] && \
    [[ -f "$model_dir/encoder-model.onnx.data" ]] && \
    [[ -f "$model_dir/decoder_joint-model.onnx" ]] && \
    [[ -f "$model_dir/vocab.txt" ]] && \
    [[ -f "$model_dir/config.json" ]]
}

resolve_macos_voxtype_bin() {
  if [[ -x "$HOME/.local/bin/voxtype" ]]; then
    printf '%s\n' "$HOME/.local/bin/voxtype"
    return 0
  fi

  if [[ -x "/Applications/Voxtype.app/Contents/MacOS/voxtype-bin" ]]; then
    printf '%s\n' "/Applications/Voxtype.app/Contents/MacOS/voxtype-bin"
    return 0
  fi

  if command -v voxtype >/dev/null 2>&1; then
    command -v voxtype
    return 0
  fi

  return 1
}

install_voxtype_parakeet_binary() {
  local source_parent=""
  local version_tag="v$VOXTYPE_VERSION"
  local voxtype_bin=""

  log_section "Voxtype Parakeet Build"

  source_parent="$(dirname "$VOXTYPE_SOURCE_DIR")"
  ensure_dir "$source_parent"

  if (( ! ${DRY_RUN:-0} )) && ! check_installed git; then
    log_item "git not available, skipping pinned Voxtype checkout"
    return 0
  fi

  if (( ! ${DRY_RUN:-0} )) && ! check_installed cargo; then
    log_item "cargo not available, skipping pinned Voxtype build"
    return 0
  fi

  if [[ -d "$VOXTYPE_SOURCE_DIR/.git" ]]; then
    log_item "Fetching pinned Voxtype tag: $version_tag"
    run_cmd git -C "$VOXTYPE_SOURCE_DIR" fetch --force --tags origin "refs/tags/$version_tag:refs/tags/$version_tag"
  elif [[ -e "$VOXTYPE_SOURCE_DIR" ]]; then
    log_item "WARNING: $VOXTYPE_SOURCE_DIR exists but is not a git checkout; skipping Voxtype build"
    return 0
  else
    log_item "Cloning Voxtype source at $version_tag"
    run_cmd git clone --branch "$version_tag" --depth 1 https://github.com/peteonrails/voxtype.git "$VOXTYPE_SOURCE_DIR"
  fi

  log_item "Checking out Voxtype $version_tag"
  run_cmd git -C "$VOXTYPE_SOURCE_DIR" checkout --detach "$version_tag"

  log_item "Building Voxtype $version_tag with features: $VOXTYPE_BUILD_FEATURES"
  run_cmd /bin/bash -lc "cd $(printf '%q' "$VOXTYPE_SOURCE_DIR") && cargo build --release --locked --features $(printf '%q' "$VOXTYPE_BUILD_FEATURES")"

  voxtype_bin="$VOXTYPE_SOURCE_DIR/target/release/voxtype"
  if (( ! ${DRY_RUN:-0} )) && [[ ! -x "$voxtype_bin" ]]; then
    log_item "Voxtype build did not produce executable: $voxtype_bin"
    return 0
  fi

  log_item "Installing Voxtype.app from pinned Parakeet build"
  run_cmd "$voxtype_bin" setup app-bundle

  ensure_dir "$HOME/.local/bin"
  safe_link_path "/Applications/Voxtype.app/Contents/MacOS/voxtype-bin" "$HOME/.local/bin/voxtype" "voxtype CLI"
}

configure_voxtype() {
  local voxtype_bin=""

  log_section "Voxtype Dictation"

  if (( ${DRY_RUN:-0} )); then
    voxtype_bin="voxtype"
  elif ! voxtype_bin="$(resolve_macos_voxtype_bin)"; then
    log_item "voxtype not available after pinned source build; skipping runtime setup"
    return 0
  fi

  if (( ${DRY_RUN:-0} )) || ! voxtype_parakeet_model_installed; then
    log_item "Downloading/selecting Parakeet model: $VOXTYPE_PARAKEET_MODEL"
    run_cmd "$voxtype_bin" setup --download --model "$VOXTYPE_PARAKEET_MODEL" --quiet --no-post-install

    # `voxtype setup --download --model` also edits config.toml. This repo owns
    # the config, so restore the canonical macOS file after model setup.
    apply_voxtype
  else
    log_item "Parakeet model installed: $VOXTYPE_PARAKEET_MODEL"
  fi

  if check_installed pkill || (( ${DRY_RUN:-0} )); then
    log_item "Restarting Voxtype.app"
    if (( ${DRY_RUN:-0} )); then
      dry_run_cmd pkill -f "/Applications/Voxtype.app/Contents/MacOS/voxtype-bin"
    else
      pkill -f "/Applications/Voxtype.app/Contents/MacOS/voxtype-bin" || true
    fi
  fi

  if check_installed open || (( ${DRY_RUN:-0} )); then
    run_cmd open /Applications/Voxtype.app
  fi

  log_item "Grant Microphone/Input Monitoring permissions to Voxtype.app if prompted"
}

setup_host_machine_state() {
  log_section "Host Machine State"
  apply_macos_defaults
  install_voxtype_parakeet_binary
  apply_host_configs
  configure_voxtype
  create_host_work_dirs
}

setup_post_host_state() {
  log_section "Post Host State"
  run_post_setup_tasks
}
