# Home Manager Hyprland and Desktop Apps Reference

## Note: Omarchy Already Provides

If using omarchy, these are **already installed** - do NOT reinstall:
- Hyprland, Waybar, Hyprlock, Hypridle, Mako
- Walker (launcher), Ghostty/Alacritty/Kitty (terminals)

For omarchy, only use home-manager for **additional** desktop apps not included in omarchy.

---

## Standalone Home Manager on Arch Linux

```nix
{ config, pkgs, ... }:
{
  targets.genericLinux.enable = true;
  xdg.enable = true;

  home.username = "username";
  home.homeDirectory = "/home/username";
}
```

## Unfree Packages Configuration

Must be set at pkgs import level in flake.nix:

```nix
pkgs = import nixpkgs {
  inherit system;
  config.allowUnfree = true;
};

# Or granular control:
pkgs = import nixpkgs {
  inherit system;
  config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [
    "spotify"
    "slack"
    "obsidian"
  ];
};
```

## GUI Applications

```nix
home.packages = with pkgs; [
  # Communication
  signal-desktop
  slack

  # Productivity
  obsidian

  # Media
  spotify

  # Note: For Arch, install Steam via pacman for 32-bit library support
];
```

## Hyprland Configuration

### Basic Setup

```nix
wayland.windowManager.hyprland = {
  enable = true;

  # For non-NixOS with UWSM
  systemd.enable = false;

  settings = {
    "$mod" = "SUPER";

    monitor = [ ",preferred,auto,1" ];

    exec-once = [
      "waybar"
      "dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP"
      "systemctl --user import-environment WAYLAND_DISPLAY XDG_CURRENT_DESKTOP"
    ];

    general = {
      gaps_in = 5;
      gaps_out = 10;
      border_size = 2;
      layout = "dwindle";
    };

    decoration = {
      rounding = 10;
    };

    bind = [
      "$mod, Return, exec, ghostty"
      "$mod, Q, killactive"
      "$mod, F, fullscreen"
      "$mod, Space, exec, walker"

      "$mod, 1, workspace, 1"
      "$mod, 2, workspace, 2"
      "$mod, 3, workspace, 3"
      "$mod, 4, workspace, 4"
    ];

    bindm = [
      "$mod, mouse:272, movewindow"
      "$mod, mouse:273, resizewindow"
    ];
  };
};
```

### For Non-NixOS (Arch)

Install Hyprland via pacman, use home-manager only for config:

```nix
wayland.windowManager.hyprland = {
  enable = true;
  package = null;  # Don't install via nix
  settings = { /* ... */ };
};
```

## Hyprlock

```nix
programs.hyprlock = {
  enable = true;

  settings = {
    background = {
      path = "screenshot";
      blur_passes = 2;
      blur_size = 7;
    };

    input-field = {
      size = { width = 200; height = 50; };
      outline_thickness = 3;
      placeholder_text = "Password...";
      halign = "center";
      valign = "center";
    };
  };
};
```

Note: On Arch, PAM must be configured manually for hyprlock authentication.

## Hypridle

```nix
services.hypridle = {
  enable = true;

  settings = {
    general = {
      lock_cmd = "hyprlock";
      before_sleep_cmd = "hyprlock";
      after_sleep_cmd = "hyprctl dispatch dpms on";
    };

    listener = [
      {
        timeout = 300;  # 5 minutes
        on-timeout = "brightnessctl -s set 10";
        on-resume = "brightnessctl -r";
      }
      {
        timeout = 600;  # 10 minutes
        on-timeout = "hyprlock";
      }
      {
        timeout = 900;  # 15 minutes
        on-timeout = "hyprctl dispatch dpms off";
        on-resume = "hyprctl dispatch dpms on";
      }
    ];
  };
};
```

## Waybar

```nix
programs.waybar = {
  enable = true;

  settings = {
    mainBar = {
      layer = "top";
      position = "top";
      height = 30;

      modules-left = [ "hyprland/workspaces" ];
      modules-center = [ "clock" ];
      modules-right = [ "pulseaudio" "network" "battery" "tray" ];

      clock = {
        format = "{:%H:%M}";
        format-alt = "{:%Y-%m-%d}";
      };

      battery = {
        format = "{capacity}% {icon}";
        format-icons = [ "" "" "" "" "" ];
      };

      pulseaudio = {
        format = "{volume}% {icon}";
        on-click = "pavucontrol";
      };
    };
  };

  style = ''
    * {
      font-family: "JetBrainsMono Nerd Font";
      font-size: 13px;
    }

    window#waybar {
      background-color: rgba(43, 48, 59, 0.9);
      color: #ffffff;
    }
  '';
};
```

## SwayOSD

```nix
services.swayosd = {
  enable = true;
  topMargin = 0.9;
};

# Keybindings in Hyprland
wayland.windowManager.hyprland.settings = {
  bind = [
    ", XF86AudioRaiseVolume, exec, swayosd-client --output-volume raise"
    ", XF86AudioLowerVolume, exec, swayosd-client --output-volume lower"
    ", XF86AudioMute, exec, swayosd-client --output-volume mute-toggle"
    ", XF86MonBrightnessUp, exec, swayosd-client --brightness raise"
    ", XF86MonBrightnessDown, exec, swayosd-client --brightness lower"
  ];
};
```

## XDG Desktop Integration

```nix
xdg = {
  enable = true;

  portal = {
    enable = true;
    extraPortals = with pkgs; [
      xdg-desktop-portal-hyprland
      xdg-desktop-portal-gtk
    ];
    config.common.default = [ "hyprland" "gtk" ];
  };

  userDirs = {
    enable = true;
    createDirectories = true;
  };
};
```

For Arch, install portals via pacman for better systemd integration:

```bash
pacman -S xdg-desktop-portal xdg-desktop-portal-hyprland xdg-desktop-portal-gtk
```

## Gaming

On Arch with standalone home-manager, install Steam via pacman:

```bash
pacman -S steam gamescope mangohud lib32-mangohud
```

Home Manager for gaming utilities:

```nix
home.packages = with pkgs; [
  lutris
  heroic
  protonup-qt
  mangohud
  gamemode
];
```

## Hybrid Approach for Arch

| Component | Install Via | Config Via |
|-----------|-------------|------------|
| Hyprland | pacman | home-manager |
| Steam | pacman | Native |
| XDG Portals | pacman | Manual |
| Waybar | home-manager | home-manager |
| Hyprlock/Hypridle | pacman or HM | home-manager |
| GUI Apps (Electron) | home-manager + nixGL | home-manager |
| CLI Tools | home-manager | home-manager |
