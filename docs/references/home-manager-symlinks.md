# Home Manager Symlink Strategies

## Overview

Home Manager provides multiple mechanisms for managing config files:
- `home.file` - files relative to `$HOME`
- `xdg.configFile` - files relative to `~/.config/`
- Native `programs.*` options
- `mkOutOfStoreSymlink` - mutable configs outside Nix store

## home.file vs xdg.configFile

```nix
# home.file - places files relative to $HOME
home.file.".gdbinit".text = ''
  set auto-load safe-path /nix/store
'';
home.file.".vimrc".source = ./vimrc;

# xdg.configFile - places files relative to ~/.config/
xdg.configFile."i3blocks/config".source = ./i3blocks.conf;
xdg.configFile."nvim".source = ./nvim;  # Symlink entire directory
```

## When to Symlink vs Use Native Options

**Use native `programs.*` options when:**
- The program has good Home Manager support
- Config is relatively stable
- You want Nix to generate the config

**Use symlinks when:**
- Config format is complex or poorly supported
- You need to edit configs frequently
- App has its own plugin manager
- Want to maintain configs in native format

## mkOutOfStoreSymlink for Mutable Configs

Critical for configs that should remain editable without rebuilding:

```nix
{ config, pkgs, ... }:
let
  # MUST use absolute string path, not Nix path literal
  dotfilesPath = "${config.home.homeDirectory}/dev/configs";
in
{
  xdg.configFile = {
    "nvim".source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/nvim";
    "zellij".source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/zellij";
    "claude".source = config.lib.file.mkOutOfStoreSymlink "${dotfilesPath}/claude";
  };
}
```

### Critical Gotcha with Flakes

```nix
# WRONG - will point to Nix store copy
xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink (toString ./nvim);

# CORRECT - points to actual filesystem
xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
  "${config.home.homeDirectory}/dev/configs/nvim";
```

## Neovim with lazy.nvim

```nix
{ config, pkgs, lib, ... }:
{
  programs.neovim = {
    enable = true;
    # LSP servers via extraPackages (not Mason)
    extraPackages = with pkgs; [
      lua-language-server
      stylua
      ripgrep
      fd
    ];
  };

  # Symlink Lua config - changes take effect immediately
  xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
    "${config.home.homeDirectory}/dev/configs/nvim";

  # Tools needed during activation
  home.extraActivationPath = with pkgs; [
    git gnumake gcc
    config.programs.neovim.finalPackage
  ];
}
```

In lazy.nvim config, disable Mason:
```lua
{ "williamboman/mason.nvim", enabled = false },
{ "williamboman/mason-lspconfig.nvim", enabled = false },
```

## Zellij Config

```nix
# Option A: Native Home Manager (immutable)
programs.zellij = {
  enable = true;
  settings = {
    theme = "catppuccin-mocha";
    default_layout = "compact";
  };
};

# Option B: Symlink for mutable config
programs.zellij.enable = true;

xdg.configFile."zellij" = {
  source = config.lib.file.mkOutOfStoreSymlink
    "${config.home.homeDirectory}/dev/configs/zellij";
};
```

## Hyprland Config

```nix
# Symlink entire Hyprland config directory
xdg.configFile."hypr".source = config.lib.file.mkOutOfStoreSymlink
  "${config.home.homeDirectory}/dev/configs/hypr";
```

## Decision Matrix

| Scenario | Approach |
|----------|----------|
| Stable, simple config | Use `programs.*` native options |
| Frequent edits needed | Use `mkOutOfStoreSymlink` |
| App has plugin manager | Symlink config, let app manage plugins |
| XDG-compliant app | Use `xdg.configFile` |
| Legacy dotfile location | Use `home.file` |
| Complex nested config | Symlink directory |
| Reproducibility priority | Native options |
| Iteration speed priority | `mkOutOfStoreSymlink` |

## Recursive Symlinks

```nix
# Single symlink for entire directory (recommended)
xdg.configFile."nvim".source = ./nvim;

# Individual symlinks for each file
xdg.configFile."nvim" = {
  source = ./nvim;
  recursive = true;
};
```

Note: `recursive = true` doesn't work with `mkOutOfStoreSymlink`. Use directory symlink without recursive.

## Limitations

1. `mkOutOfStoreSymlink` doesn't validate paths - dangling symlinks created silently
2. Flakes require hardcoding absolute paths or using `config.home.homeDirectory`
3. `recursive + mkOutOfStoreSymlink` doesn't work as expected
