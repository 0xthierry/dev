# Desktop Applications on Arch Linux with Home Manager

## Note: Omarchy Already Provides

If using omarchy, these are **already installed** - do NOT reinstall:
- Neovim, Chromium, LibreOffice, VLC, Nautilus
- Zoom, Signal (check omarchy version)

Only install apps that omarchy doesn't include (Obsidian, Slack, Spotify with Spicetify, OBS).

---

## Unfree Packages Setup

In `flake.nix`:

```nix
pkgs = import nixpkgs {
  inherit system;
  config.allowUnfree = true;
};
```

Or granular in `home.nix`:

```nix
nixpkgs.config.allowUnfreePredicate = pkg:
  builtins.elem (lib.getName pkg) [
    "obsidian"
    "slack"
    "spotify"
    "signal-desktop"
  ];
```

## Obsidian

```nix
programs.obsidian = {
  enable = true;
};
```

## Signal Desktop

```nix
home.packages = [ pkgs.signal-desktop ];

# Wayland desktop entry override
xdg.desktopEntries.signal-desktop = {
  name = "Signal";
  exec = "signal-desktop --enable-features=UseOzonePlatform --ozone-platform=wayland %U";
  icon = "signal-desktop";
  type = "Application";
  categories = [ "Network" "InstantMessaging" ];
  terminal = false;
};
```

## Slack

```nix
home.packages = [ pkgs.slack ];

xdg.desktopEntries.slack = {
  name = "Slack";
  exec = "slack --enable-features=UseOzonePlatform,WaylandWindowDecorations --ozone-platform=wayland %U";
  icon = "slack";
  type = "Application";
  categories = [ "Network" "InstantMessaging" ];
  terminal = false;
};
```

## Spotify with Spicetify

Add to flake inputs:

```nix
inputs.spicetify-nix.url = "github:Gerg-L/spicetify-nix";
```

Configuration:

```nix
{ pkgs, lib, inputs, ... }:
let
  spicePkgs = inputs.spicetify-nix.legacyPackages.${pkgs.system};
in {
  imports = [ inputs.spicetify-nix.homeManagerModules.default ];

  programs.spicetify = {
    enable = true;
    theme = spicePkgs.themes.catppuccin;
    colorScheme = "mocha";
    enabledExtensions = with spicePkgs.extensions; [
      fullAppDisplay
      shuffle
      hidePodcasts
    ];
  };
}
```

## OBS Studio

```nix
programs.obs-studio = {
  enable = true;
  plugins = with pkgs.obs-studio-plugins; [
    wlrobs                      # Wayland screen capture
    obs-pipewire-audio-capture  # PipeWire audio
    obs-vaapi                   # Hardware encoding
    obs-vkcapture               # Game capture
  ];
};
```

## Electron Apps on Wayland

Common flags for all Electron apps:

```
--enable-features=UseOzonePlatform,WaylandWindowDecorations
--ozone-platform=wayland
```

Template for desktop entry override:

```nix
xdg.desktopEntries.<app> = {
  name = "<App Name>";
  exec = "<app> --enable-features=UseOzonePlatform --ozone-platform=wayland %U";
  icon = "<app>";
  type = "Application";
  categories = [ "Category" ];
  terminal = false;
};
```

## nixGL for GPU-Accelerated Apps

On non-NixOS, Nix apps can't access system GPU drivers. Use nixGL:

Add to flake:

```nix
inputs.nixgl.url = "github:nix-community/nixGL";
```

Usage:

```bash
nixGL obs-studio
nixGL blender
```

For integration with home-manager, see the nixGL wrapper pattern in the home-manager PR #5355.

## Complete Example

```nix
{ config, pkgs, lib, inputs, ... }:
let
  spicePkgs = inputs.spicetify-nix.legacyPackages.${pkgs.system};
in {
  imports = [ inputs.spicetify-nix.homeManagerModules.default ];

  nixpkgs.config.allowUnfreePredicate = pkg:
    builtins.elem (lib.getName pkg) [
      "obsidian" "slack" "spotify" "signal-desktop"
    ];

  programs.obsidian.enable = true;

  programs.spicetify = {
    enable = true;
    theme = spicePkgs.themes.catppuccin;
    colorScheme = "mocha";
  };

  programs.obs-studio = {
    enable = true;
    plugins = with pkgs.obs-studio-plugins; [
      wlrobs obs-pipewire-audio-capture obs-vaapi
    ];
  };

  home.packages = with pkgs; [
    signal-desktop
    slack
  ];

  xdg.desktopEntries = {
    signal-desktop = {
      name = "Signal";
      exec = "signal-desktop --enable-features=UseOzonePlatform --ozone-platform=wayland %U";
      icon = "signal-desktop";
      type = "Application";
      categories = [ "Network" "InstantMessaging" ];
      terminal = false;
    };
    slack = {
      name = "Slack";
      exec = "slack --enable-features=UseOzonePlatform --ozone-platform=wayland %U";
      icon = "slack";
      type = "Application";
      categories = [ "Network" "InstantMessaging" ];
      terminal = false;
    };
    obsidian = {
      name = "Obsidian";
      exec = "obsidian --enable-features=UseOzonePlatform --ozone-platform=wayland %U";
      icon = "obsidian";
      type = "Application";
      categories = [ "Office" ];
      terminal = false;
    };
  };
}
```
