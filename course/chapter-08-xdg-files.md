# Chapter 8: XDG & File Management in Home Manager

## Introduction

File management is where Home Manager truly shines as a declarative dotfiles solution. This chapter covers everything from understanding the XDG Base Directory Specification to mastering the critical distinction between Nix store symlinks and out-of-store symlinks.

---

## 8.1 The XDG Base Directory Specification

### What is XDG?

XDG (X Desktop Group / freedesktop.org) defines standardized locations for user-specific files, solving the problem of cluttered home directories.

### The Core Directories

| Variable | Default Path | Purpose |
|----------|--------------|---------|
| `XDG_CONFIG_HOME` | `~/.config` | User configuration files |
| `XDG_DATA_HOME` | `~/.local/share` | User data files |
| `XDG_CACHE_HOME` | `~/.cache` | Non-essential cached data |
| `XDG_STATE_HOME` | `~/.local/state` | Persistent state data |

### Benefits

- **Organized home directory**: All config in `~/.config`
- **Easier backups**: Backup `~/.config`, skip `~/.cache`
- **Clean reinstalls**: Delete `~/.cache` without losing configuration

---

## 8.2 Home Manager XDG Support

### Enabling XDG Support

```nix
{ config, ... }:
{
  xdg.enable = true;
}
```

### XDG User Directories

```nix
{
  xdg.userDirs = {
    enable = true;
    createDirectories = true;

    desktop = "${config.home.homeDirectory}/desktop";
    documents = "${config.home.homeDirectory}/docs";
    download = "${config.home.homeDirectory}/downloads";
    music = "${config.home.homeDirectory}/music";
    pictures = "${config.home.homeDirectory}/pictures";
  };
}
```

### XDG MIME Applications

```nix
{
  xdg.mimeApps = {
    enable = true;

    defaultApplications = {
      "text/html" = "firefox.desktop";
      "application/pdf" = "org.gnome.Evince.desktop";
      "image/png" = "org.gnome.Loupe.desktop";
    };
  };
}
```

---

## 8.3 Managing Configuration Files

### xdg.configFile Basics

```nix
{
  # From a source file
  xdg.configFile."alacritty/alacritty.toml".source = ./alacritty.toml;

  # With inline content
  xdg.configFile."starship.toml".text = ''
    [character]
    success_symbol = "[>](bold green)"
  '';
}
```

### Available Options

```nix
{
  xdg.configFile."example/config" = {
    source = ./config-file;
    # OR
    text = "configuration content";

    executable = true;      # Make executable
    recursive = true;       # For directories
    force = true;          # Overwrite existing

    onChange = ''
      echo "Config changed!"
    '';
  };
}
```

---

## 8.4 Managing Home Directory Files

### home.file Basics

```nix
{
  home.file.".bashrc".source = ./bashrc;

  home.file.".profile".text = ''
    export PATH=$HOME/.local/bin:$PATH
  '';

  home.file.".local/bin/my-script" = {
    source = ./my-script;
    executable = true;
  };
}
```

### XDG Data Files

```nix
{
  xdg.dataFile."fonts/MyFont.ttf".source = ./MyFont.ttf;

  xdg.dataFile."applications/my-app.desktop".text = ''
    [Desktop Entry]
    Name=My Application
    Exec=/usr/bin/my-app
    Type=Application
  '';
}
```

---

## 8.5 THE CRITICAL CONCEPT: Nix Store vs Live Files

### The Default Behavior

When you write:

```nix
{
  xdg.configFile."nvim/init.lua".source = ./nvim/init.lua;
}
```

The file is **copied to the Nix store** and becomes **read-only**:

```
~/.config/nvim/init.lua -> /nix/store/xxx.../init.lua
```

**The file is immutable.** You cannot edit it without rebuilding.

### When Immutability is Fine

- Shell configuration (`.bashrc`, `.zshrc`)
- Git configuration
- Static tool configs

### When Immutability is Problematic

- Editor configs you tweak constantly
- Configs with UI editors ("Preferences" menus)
- Applications that write to their own config

---

## 8.6 mkOutOfStoreSymlink: The Solution

### Basic Usage

```nix
{ config, ... }:
{
  xdg.configFile."nvim".source =
    config.lib.file.mkOutOfStoreSymlink
      "${config.home.homeDirectory}/nixos-config/configs/nvim";
}
```

Now the symlink points to a **real, writable directory**:

```
~/.config/nvim -> /home/user/nixos-config/configs/nvim
```

### CRITICAL: Use Absolute Paths

```nix
# WRONG - Relative paths break
xdg.configFile."nvim".source =
  config.lib.file.mkOutOfStoreSymlink ./configs/nvim;

# CORRECT - Absolute string path
xdg.configFile."nvim".source =
  config.lib.file.mkOutOfStoreSymlink
    "${config.home.homeDirectory}/nixos-config/configs/nvim";
```

### Full Example

```nix
{ config, ... }:
let
  configDir = "${config.home.homeDirectory}/nixos-config";
in
{
  programs.neovim = {
    enable = true;
    defaultEditor = true;
  };

  # Config is editable without rebuild
  xdg.configFile."nvim".source =
    config.lib.file.mkOutOfStoreSymlink "${configDir}/configs/nvim";
}
```

---

## 8.7 File Management Patterns

### Pattern 1: Pure Nix Generation (programs.*)

**Use when**: Configuration is simple and stable.

```nix
{
  programs.git = {
    enable = true;
    userName = "Your Name";
    extraConfig = { init.defaultBranch = "main"; };
  };
}
```

### Pattern 2: Store Symlinks (default)

**Use when**: Configuration is static and tracked in Nix.

```nix
{
  xdg.configFile."alacritty/alacritty.toml".source = ./alacritty.toml;
}
```

### Pattern 3: Out-of-Store Symlinks

**Use when**: You edit the configuration frequently.

```nix
{
  xdg.configFile."nvim".source =
    config.lib.file.mkOutOfStoreSymlink
      "${config.home.homeDirectory}/.dotfiles/nvim";
}
```

### Decision Matrix

| Scenario | Recommended Pattern |
|----------|---------------------|
| Git config | Pure Nix (`programs.git`) |
| Shell config | Pure Nix or Store Symlink |
| Neovim config | Out-of-Store Symlink |
| VS Code settings | Out-of-Store Symlink |
| Stable terminal config | Store Symlink |

---

## 8.8 File Permissions

### Executable Files

```nix
{
  home.file.".local/bin/backup-script" = {
    source = ./scripts/backup.sh;
    executable = true;
  };

  home.file.".local/bin/quick-note" = {
    executable = true;
    text = ''
      #!/usr/bin/env bash
      echo "$(date): $*" >> ~/notes.txt
    '';
  };
}
```

### Force Overwrite

```nix
{
  xdg.configFile."example/config" = {
    source = ./config;
    force = true;  # Overwrite existing files
  };
}
```

---

## 8.9 Activation Scripts

### Basic Activation

```nix
{ lib, ... }:
{
  home.activation = {
    myScript = lib.hm.dag.entryAfter ["writeBoundary"] ''
      echo "Running custom activation..."
    '';
  };
}
```

### Practical Examples

**Clone a repository:**
```nix
{
  home.activation.cloneDotfiles = lib.hm.dag.entryAfter ["writeBoundary"] ''
    DOTFILES="${config.home.homeDirectory}/.dotfiles"
    if [ ! -d "$DOTFILES" ]; then
      ${pkgs.git}/bin/git clone https://github.com/user/dotfiles.git "$DOTFILES"
    fi
  '';
}
```

**Create directories:**
```nix
{
  home.activation.createDirs = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ${config.home.homeDirectory}/{projects,tmp,notes}
  '';
}
```

---

## 8.10 Practical Examples

### Neovim (Out-of-Store)

```nix
{ config, pkgs, ... }:
let
  dotfiles = "${config.home.homeDirectory}/.dotfiles";
in
{
  programs.neovim = {
    enable = true;
    defaultEditor = true;

    plugins = with pkgs.vimPlugins; [
      nvim-lspconfig
      telescope-nvim
    ];

    extraPackages = with pkgs; [ nil lua-language-server ];
  };

  xdg.configFile."nvim".source =
    config.lib.file.mkOutOfStoreSymlink "${dotfiles}/nvim";
}
```

### Git (Pure Nix)

```nix
{
  programs.git = {
    enable = true;
    userName = "Your Name";
    userEmail = "your.email@example.com";

    delta.enable = true;

    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
    };

    ignores = [ ".DS_Store" "*.swp" ".direnv" ];
  };
}
```

### SSH (home.file)

```nix
{ config, ... }:
{
  programs.ssh = {
    enable = true;

    matchBlocks = {
      "github.com" = {
        hostname = "github.com";
        user = "git";
        identityFile = "${config.home.homeDirectory}/.ssh/id_ed25519_github";
      };
    };
  };

  home.file.".ssh/.keep".text = "";

  home.activation.sshPermissions = lib.hm.dag.entryAfter ["writeBoundary"] ''
    chmod 700 ${config.home.homeDirectory}/.ssh
  '';
}
```

---

## Summary

1. **XDG** provides a standard for organizing user files
2. **xdg.configFile** manages files in `~/.config`
3. **home.file** manages files anywhere in home
4. **Store symlinks** (default) are immutable
5. **mkOutOfStoreSymlink** enables live editing
6. **Choose your pattern** based on edit frequency
7. **Activation scripts** handle non-file operations

---

## Exercises

1. Convert an existing dotfile to use `xdg.configFile`
2. Set up your editor config using `mkOutOfStoreSymlink`
3. Configure `xdg.mimeApps` for default applications
4. Write an activation script that creates project directories
5. Implement a mixed approach: Nix module + out-of-store config
