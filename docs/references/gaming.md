# Gaming on Arch Linux with Home Manager

## Note: Omarchy Context

Omarchy does NOT include gaming packages. All gaming setup is additional.

---

## Hybrid Approach

**Install via pacman** (system-level):
- Steam, gamescope, gamemode
- GPU drivers, 32-bit libraries

**Install via home-manager** (user-level):
- MangoHud, Lutris, Heroic
- Configuration files

## System Setup (pacman)

```bash
# Enable multilib in /etc/pacman.conf first
[multilib]
Include = /etc/pacman.d/mirrorlist

# Core gaming packages
sudo pacman -S steam gamescope gamemode lib32-gamemode

# AMD GPU drivers
sudo pacman -S vulkan-radeon lib32-vulkan-radeon mesa lib32-mesa

# Wine (for Lutris)
sudo pacman -S wine-staging winetricks

# ProtonUp-Qt (AUR)
yay -S protonup-qt

# Critical: Increase vm.max_map_count for games like CS2
echo 'vm.max_map_count=2147483642' | sudo tee /etc/sysctl.d/80-gamecompatibility.conf
sudo sysctl --system
```

## Home Manager Configuration

```nix
{ config, pkgs, ... }:
{
  # MangoHud with configuration
  programs.mangohud = {
    enable = true;
    settings = {
      full = true;
      fps = true;
      frametime = true;
      cpu_stats = true;
      cpu_temp = true;
      gpu_stats = true;
      gpu_temp = true;
      ram = true;
      vram = true;
      position = "top-left";
      font_size = 24;
      toggle_hud = "Shift_R+F12";
      gpu_power = true;
    };
  };

  # Game launchers and tools
  home.packages = with pkgs; [
    lutris
    heroic
    protonup-qt
    winetricks
  ];

  # AMD GPU optimization
  home.sessionVariables = {
    AMD_VULKAN_ICD = "RADV";
    RADV_PERFTEST = "gpl";
    MESA_SHADER_CACHE_DIR = "$HOME/.cache/mesa_shader_cache";
    MESA_SHADER_CACHE_MAX_SIZE = "10G";
    mesa_glthread = "true";
  };
}
```

## Gamescope

Gamescope is Valve's nested compositor for gaming.

### Key Options

| Flag | Description |
|------|-------------|
| `-W`, `-H` | Output resolution |
| `-w`, `-h` | Internal render resolution |
| `-r` | FPS cap |
| `-s` | Scaler: `fsr`, `nis`, `linear` |
| `-f` | Fullscreen |
| `-e` | HDR |
| `-t` | Adaptive sync |

### Steam Launch Options

```bash
# Basic
gamescope -W 1920 -H 1080 -r 60 %command%

# FSR upscaling (render 720p, output 1080p)
gamescope -W 1920 -H 1080 -w 1280 -h 720 -s fsr -r 60 %command%

# Full setup with MangoHud and GameMode
gamemoderun gamescope -W 1920 -H 1080 -w 1280 -h 720 -r 60 -s fsr mangohud %command%

# HDR + Adaptive Sync
gamescope -W 2560 -H 1440 -r 144 -e -t %command%
```

## GameMode

GameMode optimizes system during gaming (CPU governor, GPU perf, I/O priority).

```bash
# Test GameMode
gamemoded -t

# Use with games
gamemoderun %command%
```

Configuration (`~/.config/gamemode.ini`):

```ini
[general]
reaper_freq=5
desiredgov=performance

[gpu]
apply_gpu_optimisations=accept-responsibility
amd_performance_level=high

[custom]
start=notify-send "GameMode" "Started"
end=notify-send "GameMode" "Ended"
```

## Why Steam via Pacman?

Steam requires:
- 32-bit multilib libraries
- Tight GPU driver integration
- FHS environment

NixOS Steam has known issues with 32-bit libraries even in 2025/2026. Pacman provides native integration.

## AMD-Specific Environment Variables

```nix
home.sessionVariables = {
  # Force RADV driver
  AMD_VULKAN_ICD = "RADV";

  # Enable GPL shader cache
  RADV_PERFTEST = "gpl";

  # Shader cache settings
  MESA_SHADER_CACHE_DIR = "$HOME/.cache/mesa_shader_cache";
  MESA_SHADER_CACHE_MAX_SIZE = "10G";

  # OpenGL threading
  mesa_glthread = "true";
};
```

## Complete Steam Launch Options

```bash
# AMD optimized + Gamescope + MangoHud + GameMode
AMD_VULKAN_ICD=RADV RADV_PERFTEST=gpl gamemoderun gamescope -W 2560 -H 1440 -w 1920 -h 1080 -r 144 -s fsr mangohud %command%
```

## Resources

- [ProtonDB](https://www.protondb.com/) - Game compatibility reports
- [Arch Wiki - Steam](https://wiki.archlinux.org/title/Steam)
- [Arch Wiki - Gaming](https://wiki.archlinux.org/title/Gaming)
