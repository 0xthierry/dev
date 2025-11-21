#!/bin/bash
set -Euo pipefail

TARGET_DIR="$HOME/.local/share/steam-launcher"
SWITCH_BIN="$TARGET_DIR/enter-gamesmode"
RETURN_BIN="$TARGET_DIR/leave-gamesmode"

# Try to find the user's bindings config file
BINDINGS_CONFIG=""
for location in \
    "$HOME/.config/hypr/bindings.conf" \
    "$HOME/.config/hypr/keybinds.conf" \
    "$HOME/.config/hypr/hyprland.conf"; do
  if [ -f "$location" ]; then
    BINDINGS_CONFIG="$location"
    break
  fi
done

# ---------------------------------------------------------------------------
# Config + defaults (robust against missing/partial configs under set -u)
# ---------------------------------------------------------------------------
CONFIG_FILE="/etc/gaming-mode.conf"
[[ -f "$HOME/.gaming-mode.conf" ]] && CONFIG_FILE="$HOME/.gaming-mode.conf"

# sane defaults
STEAM_LAUNCH_MODE="bigpicture"
PERFORMANCE_MODE="enabled"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE" 2>/dev/null || true
fi

# ensure still set even if config cleared them
: "${STEAM_LAUNCH_MODE:=bigpicture}"
: "${PERFORMANCE_MODE:=enabled}"

ADDED_BINDINGS=0
CREATED_TARGET_DIR=0

info(){ echo "[*] $*"; }
err(){ echo "[!] $*" >&2; }

die() {
  local msg="$1"; local code="${2:-1}"
  echo "FATAL: $msg" >&2
  logger -t gaming-mode "Installation failed: $msg" || true
  rollback_changes
  exit "$code"
}

rollback_changes() {
  [ -f "$SWITCH_BIN" ] && rm -f "$SWITCH_BIN"
  [ -f "$RETURN_BIN" ] && rm -f "$RETURN_BIN"
  if [ "$CREATED_TARGET_DIR" -eq 1 ] && [ -d "$TARGET_DIR" ]; then
    rmdir "$TARGET_DIR" 2>/dev/null || true
  fi

  # Remove added bindings
  if [ "$ADDED_BINDINGS" -eq 1 ] && [ -n "$BINDINGS_CONFIG" ] && [ -f "$BINDINGS_CONFIG" ]; then
    sed -i '/# Gaming Mode bindings - added by installation script/,/# End Gaming Mode bindings/d' "$BINDINGS_CONFIG"
  fi
}

validate_environment() {
  command -v pacman  >/dev/null || die "pacman required"
  command -v hyprctl >/dev/null || die "hyprctl required"
  [ -f "$HOME/.config/hypr/hyprland.conf" ] || die "hyprland.conf not found"
  [ -n "$BINDINGS_CONFIG" ] || die "Could not find bindings config file"
}

check_package() { pacman -Qi "$1" &>/dev/null; }

# ---------------------------------------------------------------------------
# Steam dependency / multilib checks (from reference script, lightly cleaned)
# ---------------------------------------------------------------------------
check_steam_dependencies() {
  info "Checking Steam dependencies for Arch Linux..."

  local -a missing_deps=()
  local -a optional_deps=()
  local multilib_enabled=false

  # Check if multilib repository is enabled (required for 32-bit Steam libraries)
  if grep -q "^\[multilib\]" /etc/pacman.conf 2>/dev/null; then
    multilib_enabled=true
    info "Multilib repository: enabled"
  else
    err "Multilib repository: NOT enabled (required for Steam)"
    missing_deps+=("multilib-repository")  # dummy marker
  fi

  # Core Steam dependencies
  local -a core_deps=(
    "steam"                    # Steam client
    "lib32-vulkan-icd-loader"  # 32-bit Vulkan loader
    "vulkan-icd-loader"        # 64-bit Vulkan loader
    "lib32-mesa"               # 32-bit Mesa (OpenGL)
    "mesa"                     # 64-bit Mesa
    "lib32-systemd"            # 32-bit systemd libs
    "lib32-glibc"              # 32-bit glibc
    "lib32-gcc-libs"           # 32-bit GCC libs
    "lib32-libx11"             # 32-bit X11
    "lib32-libxss"             # 32-bit X screensaver
    "lib32-alsa-plugins"       # 32-bit ALSA
    "lib32-libpulse"           # 32-bit PulseAudio
    "lib32-openal"             # 32-bit OpenAL
    "lib32-nss"                # 32-bit NSS
    "lib32-libcups"            # 32-bit CUPS (printing)
    "lib32-sdl2"               # 32-bit SDL2
    "lib32-freetype2"          # 32-bit fonts
    "lib32-fontconfig"         # 32-bit font config
    "ttf-liberation"           # Font package
    "xdg-user-dirs"            # User directories
  )

  # GPU-specific Vulkan drivers
  local gpu_vendor
  gpu_vendor=$(lspci 2>/dev/null | grep -i vga | head -n1 || echo "")

  local -a gpu_deps=()
  if echo "$gpu_vendor" | grep -iq nvidia; then
    info "Detected NVIDIA GPU"
    gpu_deps+=("nvidia-utils" "lib32-nvidia-utils")
    optional_deps+=("nvidia-settings")
  elif echo "$gpu_vendor" | grep -iq amd; then
    info "Detected AMD GPU"
    gpu_deps+=("vulkan-radeon" "lib32-vulkan-radeon" "xf86-video-amdgpu")
  elif echo "$gpu_vendor" | grep -iq intel; then
    info "Detected Intel GPU"
    gpu_deps+=("vulkan-intel" "lib32-vulkan-intel")
  else
    info "GPU vendor not detected, checking generic Vulkan drivers..."
    gpu_deps+=("vulkan-radeon" "lib32-vulkan-radeon")
  fi

  # Optional but recommended packages
  local -a recommended_deps=(
    "gamemode"                 # System optimization
    "lib32-gamemode"           # 32-bit gamemode
    "gamescope"                # Gaming compositor
    "mangohud"                 # Performance overlay
    "lib32-mangohud"           # 32-bit MangoHud
    "proton-ge-custom-bin"     # Custom Proton (AUR)
    "protontricks"             # Proton helper
  )

  # Check core dependencies
  info "Checking core Steam dependencies..."
  for dep in "${core_deps[@]}"; do
    if ! check_package "$dep"; then
      missing_deps+=("$dep")
    fi
  done

  # Check GPU-specific dependencies
  info "Checking GPU-specific dependencies..."
  for dep in "${gpu_deps[@]}"; do
    if ! check_package "$dep"; then
      missing_deps+=("$dep")
    fi
  done

  # Check recommended dependencies
  info "Checking recommended dependencies..."
  for dep in "${recommended_deps[@]}"; do
    if ! check_package "$dep"; then
      optional_deps+=("$dep")
    fi
  done

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  STEAM DEPENDENCY CHECK RESULTS"
  echo "════════════════════════════════════════════════════════════════"
  echo ""

  if [ "$multilib_enabled" = false ]; then
    echo "  CRITICAL: Multilib repository must be enabled!"
    echo ""
    echo "  To enable multilib, edit /etc/pacman.conf and uncomment:"
    echo "    [multilib]"
    echo "    Include = /etc/pacman.d/mirrorlist"
    echo ""
    echo "  Then run: sudo pacman -Sy"
    echo ""
    read -p "Enable multilib repository now? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      enable_multilib_repo
    else
      die "Multilib repository is required for Steam"
    fi
  fi

  # Remove dummy marker if it was added
  missing_deps=("${missing_deps[@]/multilib-repository/}")
  # Clean empty elements
  local -a clean_missing=()
  for item in "${missing_deps[@]}"; do
    [[ -n "$item" ]] && clean_missing+=("$item")
  done
  missing_deps=("${clean_missing[@]}")

  if ((${#missing_deps[@]})); then
    echo "  MISSING REQUIRED PACKAGES (${#missing_deps[@]}):"
    for dep in "${missing_deps[@]}"; do
      echo "    • $dep"
    done
    echo ""

    read -p "Install missing required packages? [Y/n]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
      info "Installing missing dependencies..."
      sudo pacman -Sy --needed --noconfirm "${missing_deps[@]}" || die "Failed to install Steam dependencies"
      info "Required dependencies installed successfully"
    else
      err "Cannot proceed without required dependencies"
      die "Missing required Steam dependencies"
    fi
  else
    info "All required Steam dependencies are installed!"
  fi

  echo ""
  if ((${#optional_deps[@]})); then
    echo "  RECOMMENDED PACKAGES (${#optional_deps[@]}):"
    for dep in "${optional_deps[@]}"; do
      echo "    • $dep"
    done
    echo ""

    read -p "Install recommended packages? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      info "Installing recommended packages..."
      # Filter out AUR packages (proton-ge-custom-bin needs AUR helper)
      local -a pacman_optional=()
      local -a aur_optional=()
      for dep in "${optional_deps[@]}"; do
        if pacman -Si "$dep" &>/dev/null; then
          pacman_optional+=("$dep")
        else
          aur_optional+=("$dep")
        fi
      done

      if ((${#pacman_optional[@]})); then
        sudo pacman -S --needed --noconfirm "${pacman_optional[@]}" || info "Some optional packages failed to install"
      fi

      if ((${#aur_optional[@]})); then
        echo ""
        info "The following packages are from AUR and need an AUR helper:"
        for dep in "${aur_optional[@]}"; do
          echo "    • $dep"
        done
        echo ""

        # Check for AUR helpers
        if command -v yay >/dev/null 2>&1; then
          read -p "Install AUR packages with yay? [y/N]: " -n 1 -r
          echo
          if [[ $REPLY =~ ^[Yy]$ ]]; then
            yay -S --needed --noconfirm "${aur_optional[@]}" || info "Some AUR packages failed to install"
          fi
        elif command -v paru >/dev/null 2>&1; then
          read -p "Install AUR packages with paru? [y/N]: " -n 1 -r
          echo
          if [[ $REPLY =~ ^[Yy]$ ]]; then
            paru -S --needed --noconfirm "${aur_optional[@]}" || info "Some AUR packages failed to install"
          fi
        else
          info "No AUR helper found (yay/paru). Install manually if desired."
        fi
      fi
    fi
  else
    info "All recommended packages are already installed!"
  fi

  echo ""
  echo "════════════════════════════════════════════════════════════════"

  # Additional Steam configuration checks
  check_steam_config
}

enable_multilib_repo() {
  info "Enabling multilib repository..."

  # Backup pacman.conf
  sudo cp /etc/pacman.conf /etc/pacman.conf.backup.$(date +%Y%m%d%H%M%S) || die "Failed to backup pacman.conf"

  # Enable multilib by uncommenting the lines
  sudo sed -i '/^#\[multilib\]/,/^#Include/ s/^#//' /etc/pacman.conf || die "Failed to enable multilib"

  # Verify it was enabled
  if grep -q "^\[multilib\]" /etc/pacman.conf 2>/dev/null; then
    info "Multilib repository enabled successfully"
    sudo pacman -Sy || die "Failed to update package database"
  else
    die "Failed to enable multilib repository"
  fi
}

check_steam_config() {
  info "Checking Steam configuration..."

  # Check for proper permissions
  if ! groups | grep -qw video; then
    info "Note: User is not in 'video' group (may affect GPU access)"
  fi

  if ! groups | grep -qw input; then
    info "Note: User is not in 'input' group (may affect controller support)"
  fi

  # Check for Steam directory
  if [ -d "$HOME/.steam" ]; then
    info "Steam directory found at ~/.steam"
  fi

  if [ -d "$HOME/.local/share/Steam" ]; then
    info "Steam data directory found at ~/.local/share/Steam"
  fi

  # Check for Proton/Wine dependencies
  if check_package "wine"; then
    info "Wine is installed (helps with some Windows games)"
  else
    info "Tip: Install 'wine' for better Windows game compatibility"
  fi

  # Check for controller support
  if check_package "steam-native-runtime"; then
    info "Steam native runtime installed (better compatibility)"
  fi

  # Check kernel parameters for gaming
  if [ -f /proc/sys/vm/swappiness ]; then
    local swappiness
    swappiness=$(cat /proc/sys/vm/swappiness)
    if [ "$swappiness" -gt 10 ]; then
      info "Tip: Consider lowering vm.swappiness to 10 for better gaming performance"
      info "     Current value: $swappiness"
    fi
  fi

  # Check for esync/fsync support
  local max_files
  max_files=$(ulimit -n 2>/dev/null || echo "0")
  if [ "$max_files" -lt 524288 ]; then
    info "Tip: Increase open file limit for esync support"
    info "     Add to /etc/security/limits.conf:"
    info "     * hard nofile 524288"
    info "     * soft nofile 524288"
  fi
}

# ---------------------------------------------------------------------------
# Requirements for our launchers (non-Steam-specific)
# ---------------------------------------------------------------------------
setup_requirements() {
  local -a required_packages=("gamescope" "mangohud" "zenity" "python" "libcap" "gamemode" "curl")
  local -a packages_to_install=()
  for pkg in "${required_packages[@]}"; do
    check_package "$pkg" || packages_to_install+=("$pkg")
  done
  
  if ((${#packages_to_install[@]})); then
    info "Installing: ${packages_to_install[*]}"
    sudo pacman -S --needed --noconfirm "${packages_to_install[@]}" || die "package install failed"
  else
    info "All required packages present."
  fi
  
  command -v steam >/dev/null || info "Steam not found – install it if needed."
  
  if [[ "${PERFORMANCE_MODE,,}" == "enabled" ]] && command -v gamescope >/dev/null 2>&1; then
    sudo setcap 'cap_sys_nice+ep' "$(command -v gamescope)" || info "setcap failed; --rt may be ignored."
  fi
}

deploy_launchers() {
  if [ ! -d "$TARGET_DIR" ]; then 
    mkdir -p "$TARGET_DIR" || die "cannot create $TARGET_DIR"
    CREATED_TARGET_DIR=1
  fi
  
  # ---------------------------------------------------------------------------
  # ENTER GAME MODE LAUNCHER
  # ---------------------------------------------------------------------------
  cat > "$SWITCH_BIN" <<'EOF'
#!/bin/bash
set -Euo pipefail

STATE_DIR="$HOME/.cache/gaming-session"
LOCK_FILE="$STATE_DIR/idle-prevention.lock"
SESSION_FILE="$STATE_DIR/session.pid"
PREV_WORKSPACE_FILE="$STATE_DIR/previous-workspace"

mkdir -p "$STATE_DIR"

# defaults
STEAM_LAUNCH_MODE="bigpicture"
PERFORMANCE_MODE="enabled"

CONFIG_FILE="/etc/gaming-mode.conf"
[[ -f "$HOME/.gaming-mode.conf" ]] && CONFIG_FILE="$HOME/.gaming-mode.conf"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE" 2>/dev/null || true
fi

# ensure still set
: "${STEAM_LAUNCH_MODE:=bigpicture}"
: "${PERFORMANCE_MODE:=enabled}"

steam_icon() { echo "steam"; }
center_notify() {
  local msg="$*"
  if command -v zenity >/dev/null 2>&1; then
    local ICON; ICON="$(steam_icon)"
    if [[ -n "$ICON" ]]; then
      nohup bash -lc "GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --info --window-icon='${ICON}' --title='Gamesmode' --no-wrap --width=420 --timeout=2 --text='${msg}'" >/dev/null 2>&1 &
    else
      nohup bash -lc "GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --info --title='Gamesmode' --no-wrap --width=420 --timeout=2 --text='${msg}'" >/dev/null 2>&1 &
    fi
  fi
}

get_display() {
  local j; j="$(hyprctl monitors -j 2>/dev/null)"
  if [[ -z "$j" ]]; then echo "3840 2160 60"; return; fi
  printf '%s\n' "$j" | python3 - <<'PY'
import json,sys
try:
  d=json.load(sys.stdin); m=d[0] if d else {}
  print(int(m.get("width",3840)), int(m.get("height",2160)), int(round(m.get("refreshRate",60))))
except Exception:
  print("3840 2160 60")
PY
}

# Workspace management: switch to dedicated gaming workspace (6)
current_ws=$(hyprctl activeworkspace -j 2>/dev/null | python3 - <<'PY'
import json,sys
try:
  data=json.load(sys.stdin)
  print(data.get("id", 1))
except Exception:
  print(1)
PY
)
echo "$current_ws" > "$PREV_WORKSPACE_FILE" 2>/dev/null || true
hyprctl dispatch workspace 6 >/dev/null 2>&1 || true

# wait until workspace 6 is actually active
for _ in 1 2 3 4 5; do
  ws=$(hyprctl activeworkspace -j 2>/dev/null | python3 - <<'PY'
import json,sys
try:
  data=json.load(sys.stdin)
  print(data.get("id",""))
except Exception:
  print("")
PY
)
  [ "$ws" = "6" ] && break
  sleep 0.05
done

read -r horizontal_res vertical_res monitor_hz <<<"$(get_display)"
DISPLAY_WIDTH="$horizontal_res"; DISPLAY_HEIGHT="$vertical_res"; REFRESH_RATE="$monitor_hz"

# Set window rules for notification popups (square corners)
hyprctl keyword windowrulev2 "rounding 0, class:(zenity), title:(Gamesmode)" >/dev/null 2>&1
hyprctl keyword windowrulev2 "noborder, class:(zenity), title:(Gamesmode)" >/dev/null 2>&1

# Check if previous settings exist
SETTINGS_FILE="$STATE_DIR/last-settings"
USE_PREVIOUS=false

if [[ -f "$SETTINGS_FILE" ]]; then
  # Ask user if they want to use previous settings
  hyprctl keyword windowrulev2 "rounding 0, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "noborder, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "float, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "size 600 300, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "center, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "workspace 6, class:(zenity), title:(Gaming Mode - Quick Launch)" >/dev/null 2>&1

  QUICK_CHOICE=$(GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --question \
    --title="Gaming Mode - Quick Launch" \
    --text="Previous settings found.\n\nUse Previous settings?\n\n(Enter = Yes, Escape = No)" \
    --width=500 --height=200 \
    --ok-label="Use Previous" --cancel-label="Configure Now" \
    2>/dev/null && echo "Use Previous" || echo "Configure Now")

  if [[ -z "$QUICK_CHOICE" ]]; then
    center_notify "Gaming Mode cancelled"
    exit 0
  fi

  if [[ "$QUICK_CHOICE" == "Use Previous" ]]; then
    USE_PREVIOUS=true
    # shellcheck source=/dev/null
    source "$SETTINGS_FILE"
  fi
fi

if [[ "$USE_PREVIOUS" == false ]]; then
  # Show resolution selection menu (fixed size, centered)
  hyprctl keyword windowrulev2 "rounding 0, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "noborder, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "float, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "size 800 500, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "center, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "workspace 6, class:(zenity), title:(Gaming Mode - Resolution Settings)" >/dev/null 2>&1

  RESOLUTION_CHOICE=$(GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --list --radiolist \
  --title="Gaming Mode - Resolution Settings" \
  --text="Select your preferred gaming resolution:\n\nHD Display: ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}" \
  --width=800 --height=500 \
  --column="" --column="Resolution" --column="Description" \
  TRUE "HD (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT})" "Render at native resolution (best quality)" \
  FALSE "1440p Upscaled" "Render at 1080p, upscale to 1440p (better FPS)" \
  FALSE "1440p (2560x1440)" "Render at 1440p resolution" \
  FALSE "UHD Upscaled" "Render at 1440p, upscale to 4K (balanced)" \
  FALSE "UHD (3840x2160)" "Render at 4K/UHD resolution" \
  2>/dev/null)

  # If user cancelled, exit
  if [[ -z "$RESOLUTION_CHOICE" ]]; then
    center_notify "Gaming Mode cancelled"
    exit 0
  fi

  # Show MangoHud preset selection
  hyprctl keyword windowrulev2 "rounding 0, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "noborder, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "float, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "size 800 400, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "center, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1
  hyprctl keyword windowrulev2 "workspace 6, class:(zenity), title:(Gaming Mode - MangoHud Settings)" >/dev/null 2>&1

  MANGOHUD_CHOICE=$(GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --list --radiolist \
    --title="Gaming Mode - MangoHud Settings" \
    --text="Select your preferred performance overlay:" \
    --width=800 --height=400 \
    --column="" --column="Preset" --column="Description" \
    FALSE "Off" "No performance overlay (cleanest view)" \
    TRUE "Minimal" "FPS counter only (recommended)" \
    FALSE "Full Stats" "Detailed performance metrics (CPU, GPU, temps, frametime)" \
    2>/dev/null)

  # If user cancelled, exit
  if [[ -z "$MANGOHUD_CHOICE" ]]; then
    center_notify "Gaming Mode cancelled"
    exit 0
  fi

  # Save settings for next time
  cat > "$SETTINGS_FILE" <<SETTINGS
RESOLUTION_CHOICE="$RESOLUTION_CHOICE"
MANGOHUD_CHOICE="$MANGOHUD_CHOICE"
SETTINGS

fi

# Set game rendering and output resolution based on choice
game_width="$DISPLAY_WIDTH"
game_height="$DISPLAY_HEIGHT"
output_width="$DISPLAY_WIDTH"
output_height="$DISPLAY_HEIGHT"

case "$RESOLUTION_CHOICE" in
  "HD (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT})")
    game_width="$DISPLAY_WIDTH"
    game_height="$DISPLAY_HEIGHT"
    output_width="$DISPLAY_WIDTH"
    output_height="$DISPLAY_HEIGHT"
    ;;
  "UHD (3840x2160)")
    game_width=3840
    game_height=2160
    output_width=3840
    output_height=2160
    ;;
  "UHD Upscaled")
    game_width=2560
    game_height=1440
    output_width=3840
    output_height=2160
    ;;
  "1440p (2560x1440)")
    game_width=2560
    game_height=1440
    output_width=2560
    output_height=1440
    ;;
  "1440p Upscaled")
    game_width=1920
    game_height=1080
    output_width=2560
    output_height=1440
    ;;
esac

: > "$LOCK_FILE"
echo $$ > "$SESSION_FILE"
# Gracefully terminate hypridle, then force if needed
pkill hypridle 2>/dev/null && sleep 0.5
pkill -9 hypridle 2>/dev/null || true

# ===== CPU GOVERNOR OPTIMIZATION =====
if [[ -d /sys/devices/system/cpu/cpu0/cpufreq ]]; then
  current_governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo "unknown")
  echo "$current_governor" > "$STATE_DIR/original_governor"

  for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    if [[ -w "$cpu" ]]; then
      echo performance > "$cpu" 2>/dev/null || \
        echo performance | sudo tee "$cpu" >/dev/null 2>&1
    fi
  done
fi

# ===== GPU PERFORMANCE MODE =====
GPU_VENDOR=$(lspci | grep -i vga | head -n1)

# AMD GPU optimization
if echo "$GPU_VENDOR" | grep -iq amd; then
  for gpu in /sys/class/drm/card*/device/power_dpm_force_performance_level; do
    if [[ -f "$gpu" ]]; then
      current_mode=$(cat "$gpu" 2>/dev/null || echo "auto")
      echo "$gpu:$current_mode" >> "$STATE_DIR/gpu_perf_mode"

      if [[ -w "$gpu" ]]; then
        echo high > "$gpu" 2>/dev/null || \
          echo high | sudo tee "$gpu" >/dev/null 2>&1
      fi
    fi
  done
fi

# NVIDIA GPU optimization
if echo "$GPU_VENDOR" | grep -iq nvidia; then
  if command -v nvidia-settings >/dev/null 2>&1; then
    nvidia-settings -a "[gpu:0]/GpuPowerMizerMode=1" >/dev/null 2>&1 && \
      echo "nvidia_optimized" > "$STATE_DIR/gpu_perf_mode"
  fi
fi

gamescope_perf=""
[[ "${PERFORMANCE_MODE,,}" == "enabled" ]] && gamescope_perf="--rt --immediate-flips"
steam_args=""
case "${STEAM_LAUNCH_MODE,,}" in
  gamepadui) steam_args="-gamepadui" ;;
  bigpicture|"") steam_args="-tenfoot" ;;
  *) steam_args="-tenfoot" ;;
esac

# Configure MangoHud based on user choice
mangohud_flag=""
mangohud_config=""
case "$MANGOHUD_CHOICE" in
  "Off")
    mangohud_flag=""
    ;;
  "Minimal")
    mangohud_flag="--mangoapp"
    mangohud_config="fps,fps_only,position=top-left,font_size=24"
    ;;
  "Full Stats")
    mangohud_flag="--mangoapp"
    mangohud_config="cpu_temp,gpu_temp,cpu_power,gpu_power,ram,vram,fps,frametime,frame_timing=1,gpu_stats,cpu_stats,position=top-left"
    ;;
esac

if [[ -n "$mangohud_config" ]]; then
  MANGOHUD_CONFIG="$mangohud_config" exec gamemoderun /usr/bin/gamescope $gamescope_perf $mangohud_flag -f -w "$game_width" -h "$game_height" -W "$output_width" -H "$output_height" -r "$REFRESH_RATE" --force-grab-cursor -e -- /usr/bin/steam $steam_args
else
  exec gamemoderun /usr/bin/gamescope $gamescope_perf $mangohud_flag -f -w "$game_width" -h "$game_height" -W "$output_width" -H "$output_height" -r "$REFRESH_RATE" --force-grab-cursor -e -- /usr/bin/steam $steam_args
fi
EOF
  chmod +x "$SWITCH_BIN" || die "cannot chmod $SWITCH_BIN"

  # ---------------------------------------------------------------------------
  # EXIT GAME MODE LAUNCHER
  # ---------------------------------------------------------------------------
  cat > "$RETURN_BIN" <<'EOF'
#!/bin/bash
set -Euo pipefail
STATE_DIR="$HOME/.cache/gaming-session"
LOCK_FILE="$STATE_DIR/idle-prevention.lock"
SESSION_FILE="$STATE_DIR/session.pid"
PREV_WORKSPACE_FILE="$STATE_DIR/previous-workspace"

steam_icon() { echo "steam"; }
center_notify() {
  if command -v zenity >/dev/null 2>&1; then
    GTK_CSD=0 GTK_THEME=Adwaita:dark zenity --info --title="Gamesmode" --no-wrap --width=200 --timeout=1 --text="BACK TO WORK" &
  fi
}

if [[ -f "$SESSION_FILE" ]]; then
  PID="$(cat "$SESSION_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 0.5
    kill -9 "$PID" 2>/dev/null || true
  fi
fi
# Gracefully terminate gamescope, then force if needed
pkill gamescope 2>/dev/null && sleep 0.5
pkill -9 gamescope 2>/dev/null || true

# ===== RESTORE CPU GOVERNOR =====
if [[ -f "$STATE_DIR/original_governor" ]]; then
  original_governor=$(cat "$STATE_DIR/original_governor")
  for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
    if [[ -w "$cpu" ]]; then
      echo "$original_governor" > "$cpu" 2>/dev/null || \
        echo "$original_governor" | sudo tee "$cpu" >/dev/null 2>&1
    fi
  done
  rm -f "$STATE_DIR/original_governor"
fi

# ===== RESTORE GPU PERFORMANCE MODE =====
if [[ -f "$STATE_DIR/gpu_perf_mode" ]]; then
  while IFS=: read -r gpu_path original_mode; do
    [[ -z "$gpu_path" || -z "$original_mode" ]] && continue

    if [[ -f "$gpu_path" && "$original_mode" != "nvidia_optimized" ]]; then
      if [[ -w "$gpu_path" ]]; then
        echo "$original_mode" > "$gpu_path" 2>/dev/null || \
          echo "$original_mode" | sudo tee "$gpu_path" >/dev/null 2>&1
      fi
    fi
  done < "$STATE_DIR/gpu_perf_mode"

  # Restore NVIDIA settings if they were changed
  if grep -q "nvidia_optimized" "$STATE_DIR/gpu_perf_mode" 2>/dev/null; then
    if command -v nvidia-settings >/dev/null 2>&1; then
      nvidia-settings -a "[gpu:0]/GpuPowerMizerMode=0" >/dev/null 2>&1
    fi
  fi

  rm -f "$STATE_DIR/gpu_perf_mode"
fi

rm -f "$LOCK_FILE" "$SESSION_FILE" 2>/dev/null || true

# Restore previous workspace if recorded
if [[ -f "$PREV_WORKSPACE_FILE" ]]; then
  prev_ws=$(cat "$PREV_WORKSPACE_FILE" 2>/dev/null || echo "")
  if [[ -n "$prev_ws" ]]; then
    hyprctl dispatch workspace "$prev_ws" >/dev/null 2>&1 || true
  fi
  rm -f "$PREV_WORKSPACE_FILE" 2>/dev/null || true
fi

center_notify || true
EOF
  chmod +x "$RETURN_BIN" || die "cannot chmod $RETURN_BIN"
}

configure_shortcuts() {
  info "Adding keybindings to: $BINDINGS_CONFIG"
  
  # Check if bindings already exist
  if grep -q "# Gaming Mode bindings - added by installation script" "$BINDINGS_CONFIG" 2>/dev/null; then
    info "Gaming mode bindings already exist in config, skipping..."
    return 0
  fi
  
  # Detect the binding style used in the config
  local bind_style="bindd"
  if ! grep -q "^bindd\s*=" "$BINDINGS_CONFIG" 2>/dev/null; then
    if grep -q "^bind\s*=" "$BINDINGS_CONFIG" 2>/dev/null; then
      bind_style="bind"
    fi
  fi
  
  # Add bindings to the config file
  {
    echo ""
    echo "# Gaming Mode bindings - added by installation script"
    if [ "$bind_style" = "bindd" ]; then
      echo "bindd = SUPER SHIFT, S, Steam Gaming Mode, exec, $SWITCH_BIN"
      echo "bindd = SUPER SHIFT, R, Exit Gaming Mode, exec, $RETURN_BIN"
    else
      echo "bind = SUPER SHIFT, S, exec, $SWITCH_BIN"
      echo "bind = SUPER SHIFT, R, exec, $RETURN_BIN"
    fi
    echo "# End Gaming Mode bindings"
  } >> "$BINDINGS_CONFIG" || die "failed to add bindings to $BINDINGS_CONFIG"
  
  ADDED_BINDINGS=1
  
  # Reload Hyprland config
  hyprctl reload >/dev/null 2>&1 || info "Hyprland reload may have failed; relog if binds inactive."
}

check_component() {
  case "$1" in
    launcher)
      [ -x "$SWITCH_BIN" ] && [ -x "$RETURN_BIN" ] || { 
        err "launcher check failed"
        return 1
      }
      ;;
    shortcuts)
      if [ ! -f "$BINDINGS_CONFIG" ] || ! grep -q "# Gaming Mode bindings" "$BINDINGS_CONFIG"; then
        err "shortcuts check failed"
        return 1
      fi
      ;;
    capabilities)
      if [[ "${PERFORMANCE_MODE,,}" == "enabled" ]] && command -v gamescope >/dev/null 2>&1; then
        if ! getcap "$(command -v gamescope)" 2>/dev/null | grep -q 'cap_sys_nice'; then
          info "gamescope lacks cap_sys_nice; --rt may be ignored."
        fi
      fi
      ;;
    *) 
      err "unknown component: $1"
      return 1
      ;;
  esac
}

validate_deployment() {
  local errors=0
  for component in launcher shortcuts capabilities; do
    check_component "$component" || ((errors++))
  done
  return $errors
}

execute_setup() {
  validate_environment
  info "Found bindings config at: $BINDINGS_CONFIG"

  # Steam / multilib sanity check & install
  check_steam_dependencies

  # Reinstall logic (no kernel handling)
  if [ -x "$SWITCH_BIN" ] && [ -x "$RETURN_BIN" ]; then
    info "Gaming mode launchers already installed"

    echo ""
    read -p "Reinstall scripts/bindings? [y/N]: " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      info "Installation cancelled"
      exit 0
    fi
  fi

  setup_requirements
  deploy_launchers
  configure_shortcuts
  validate_deployment || die "deployment validation failed"
  echo ""
  info "✓ Install complete!"
  info "  Launch: Super+Shift+S"
  info "  Exit:   Super+Shift+R"
  echo ""
  info "Binaries:  $TARGET_DIR"
  info "Bindings:  $BINDINGS_CONFIG"
  info "Config:    $CONFIG_FILE"
}

gaming_mode::initialize() { validate_environment; check_steam_dependencies; setup_requirements; }
gaming_mode::install()    { deploy_launchers; }
gaming_mode::configure()  { configure_shortcuts; validate_deployment || die "validation failed"; }

execute_setup
