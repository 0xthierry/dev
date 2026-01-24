# Chapter 5: Home Manager - User Environment Management

## Introduction

While NixOS excels at managing system-level configuration, it does not directly address user-level settings like dotfiles, personal shell configurations, or user-specific packages. This is where **Home Manager** fills the gap. Home Manager is a Nix-powered tool for reproducible management of the contents of users' home directories, including programs, configuration files, environment variables, and arbitrary files.

This chapter will guide you through understanding, installing, and using Home Manager to declaratively manage your user environment.

---

## 5.1 What is Home Manager?

Home Manager is a community project from the [nix-community](https://github.com/nix-community/home-manager) organization that extends Nix's declarative philosophy to user environments. It allows you to:

- **Install software declaratively** in your user profile
- **Manage dotfiles** in your home directory
- **Configure programs** with type-checked, structured options
- **Set environment variables** and customize your shell

### System vs. User Configuration

| Aspect | NixOS (`configuration.nix`) | Home Manager (`home.nix`) |
|--------|----------------------------|---------------------------|
| Scope | System-wide | Per-user |
| Location | `/etc/nixos/` | `~/.config/home-manager/` |
| Requires sudo | Yes | No (for standalone) |
| Affects | All users | Single user |
| Typical content | System services, hardware | Dotfiles, user programs |

**When to use each:**
- **NixOS modules**: System core components, services requiring root, software needed by all users
- **Home Manager**: User-specific configuration, dotfiles, personal development tools

Home Manager configurations are also more portable, working across NixOS, macOS (via nix-darwin), and other Linux distributions with Nix installed.

---

## 5.2 Installation Methods

Home Manager can be installed in four primary ways:

### Method 1: Standalone Installation (without NixOS)

This is the recommended approach for non-NixOS systems or users who want to manage their home directory independently.

**Step 1: Add the Home Manager channel**

```bash
nix-channel --add https://github.com/nix-community/home-manager/archive/master.tar.gz home-manager
nix-channel --update
```

**Step 2: Install Home Manager**
```bash
nix-shell '<home-manager>' -A install
```

### Method 2: As a NixOS Module

This integrates Home Manager into your system configuration:

```nix
# /etc/nixos/configuration.nix
{ config, pkgs, ... }:
let
  home-manager = builtins.fetchTarball
    "https://github.com/nix-community/home-manager/archive/release-24.11.tar.gz";
in
{
  imports = [
    (import "${home-manager}/nixos")
  ];

  home-manager.users.youruser = { pkgs, ... }: {
    home.stateVersion = "24.11";
    # Your home-manager config here
  };
}
```

### Method 3: Via Flakes (Modern Approach)

This is the recommended modern approach:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, home-manager, ... }: {
    homeConfigurations."youruser" = home-manager.lib.homeManagerConfiguration {
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      modules = [ ./home.nix ];
    };
  };
}
```

To apply: `home-manager switch --flake .#youruser`

---

## 5.3 The home.nix Configuration File

The `home.nix` file is the heart of your Home Manager configuration.

### Basic Structure

```nix
{ config, pkgs, ... }:

{
  # Required: User information
  home.username = "youruser";
  home.homeDirectory = "/home/youruser";

  # Required: State version (see explanation below)
  home.stateVersion = "24.11";

  # Allow Home Manager to manage itself
  programs.home-manager.enable = true;

  # Your configuration goes here...
}
```

### home.username and home.homeDirectory

These are required settings that identify who the configuration is for:

```nix
home.username = "alice";
home.homeDirectory = "/home/alice";  # or "/Users/alice" on macOS
```

### home.stateVersion - Critical to Understand

The `home.stateVersion` option is one of the most misunderstood settings in Home Manager.

**What it is:**
- A compatibility marker that tells Home Manager which release's default settings to use
- It is NOT the version of Home Manager you are running
- It freezes certain default values to match the behavior of a specific release

**The golden rule: Never change it (unless you know exactly what you are doing)**

```nix
# Set this to the version when you FIRST installed Home Manager
# and leave it alone, even when upgrading Home Manager
home.stateVersion = "24.11";  # Do not change this!
```

---

## 5.4 Adding Packages

There are two ways to install packages with Home Manager:

### Method 1: home.packages (Direct Installation)

For packages that do not need configuration:

```nix
home.packages = with pkgs; [
  # CLI tools
  ripgrep
  fd
  jq
  htop

  # Development
  nodejs
  python3

  # Applications
  firefox
  vscode
];
```

### Method 2: programs.* Modules (Preferred)

For packages with configuration options, use the `programs.*` modules:

```nix
programs.git = {
  enable = true;  # This installs git AND creates the config
  userName = "Alice Smith";
  userEmail = "alice@example.com";
  extraConfig = {
    init.defaultBranch = "main";
    pull.rebase = true;
  };
};
```

---

## 5.5 The programs.* Module System

Home Manager provides modules for hundreds of programs. Here are practical examples:

### Example: Git Configuration

```nix
programs.git = {
  enable = true;
  userName = "Your Name";
  userEmail = "your@email.com";

  signing = {
    key = "YOUR_GPG_KEY_ID";
    signByDefault = true;
  };

  aliases = {
    co = "checkout";
    ci = "commit";
    st = "status";
    lg = "log --oneline --graph --decorate";
  };

  extraConfig = {
    init.defaultBranch = "main";
    pull.rebase = true;
    core.editor = "nvim";
  };

  delta = {
    enable = true;
    options = {
      navigate = true;
      side-by-side = true;
    };
  };
};
```

### Example: Zsh Configuration

```nix
programs.zsh = {
  enable = true;
  enableCompletion = true;
  autosuggestion.enable = true;
  syntaxHighlighting.enable = true;

  shellAliases = {
    ll = "ls -la";
    update = "sudo nixos-rebuild switch";
    hm = "home-manager";
  };

  history = {
    size = 10000;
    path = "${config.xdg.dataHome}/zsh/history";
  };

  oh-my-zsh = {
    enable = true;
    plugins = [ "git" "docker" "kubectl" ];
    theme = "robbyrussell";
  };

  initExtra = ''
    export PATH="$HOME/.local/bin:$PATH"
  '';
};
```

### How to Find Available Options

1. **Home Manager Manual**: [nix-community.github.io/home-manager/options.xhtml](https://nix-community.github.io/home-manager/options.xhtml)
2. **Home Manager Option Search**: [home-manager-options.extranix.com](https://home-manager-options.extranix.com/)
3. **MyNixOS**: [mynixos.com/home-manager/options](https://mynixos.com/home-manager/options)

---

## 5.6 Managing Files

### home.file for Dotfiles

Place files directly in your home directory:

```nix
# From a file in your config directory
home.file.".vimrc".source = ./dotfiles/vimrc;

# With inline content
home.file.".gdbinit".text = ''
  set auto-load safe-path /nix/store
'';

# Entire directory (recursive)
home.file.".config/nvim" = {
  source = ./nvim;
  recursive = true;
};

# With specific permissions
home.file.".local/bin/my-script" = {
  source = ./scripts/my-script.sh;
  executable = true;
};
```

### xdg.configFile for XDG Configs

For files in `~/.config/`:

```nix
xdg.configFile."i3/config".source = ./i3/config;

xdg.configFile."alacritty/alacritty.toml".text = ''
  [font]
  size = 12.0
'';
```

---

## 5.7 Environment Variables

### home.sessionVariables

Set environment variables for your session:

```nix
home.sessionVariables = {
  EDITOR = "nvim";
  VISUAL = "nvim";
  BROWSER = "firefox";
  LANG = "en_US.UTF-8";
};
```

### home.sessionPath

Add directories to your PATH:

```nix
home.sessionPath = [
  "$HOME/.local/bin"
  "$HOME/go/bin"
  "$HOME/.cargo/bin"
];
```

---

## 5.8 Common Commands

### Standalone Home Manager Commands

```bash
# Build and switch to the new configuration
home-manager switch

# Build and switch using a flake
home-manager switch --flake .#youruser

# Build without switching (useful for testing)
home-manager build

# List all generations
home-manager generations

# Roll back to previous generation
home-manager rollback

# Remove old generations
home-manager expire-generations "-30 days"
```

### With NixOS Module

When using Home Manager as a NixOS module:

```bash
# This builds both system AND home-manager config
sudo nixos-rebuild switch

# Or with flakes
sudo nixos-rebuild switch --flake .#hostname
```

---

## 5.9 Finding Documentation

### Official Resources

- **Home Manager Manual**: [nix-community.github.io/home-manager/](https://nix-community.github.io/home-manager/)
- **Options Reference**: [nix-community.github.io/home-manager/options.xhtml](https://nix-community.github.io/home-manager/options.xhtml)

### Option Search Tools

- **MyNixOS**: [mynixos.com/home-manager/options](https://mynixos.com/home-manager/options)
- **Home Manager Options Search**: [home-manager-options.extranix.com](https://home-manager-options.extranix.com/)

### GitHub Repository

- [github.com/nix-community/home-manager](https://github.com/nix-community/home-manager)
- Browse `modules/programs/` for available program modules

---

## 5.10 Comparison with Other Dotfile Managers

| Feature | Home Manager | GNU Stow | Chezmoi | yadm |
|---------|--------------|----------|---------|------|
| **Approach** | Declarative (Nix) | Symlink farm | Copy with templates | Git repo wrapper |
| **Package management** | Yes (integrated) | No | No | No |
| **Templating** | Nix expressions | No | Go templates | Jinja2/awk |
| **Rollback** | Built-in generations | Manual git | Manual git | Manual git |
| **Reproducibility** | Excellent | Low | Medium | Low |

---

## 5.11 Complete Working Example

```nix
{ config, pkgs, ... }:

{
  home.username = "alice";
  home.homeDirectory = "/home/alice";
  home.stateVersion = "24.11";

  programs.home-manager.enable = true;

  home.packages = with pkgs; [
    ripgrep
    fd
    bat
    eza
    fzf
    jq
    htop
  ];

  programs.git = {
    enable = true;
    userName = "Alice Smith";
    userEmail = "alice@example.com";
    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
    };
  };

  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    shellAliases = {
      ll = "eza -la";
      cat = "bat";
      hms = "home-manager switch";
    };
  };

  programs.starship = {
    enable = true;
    settings = {
      add_newline = false;
      character = {
        success_symbol = "[>](bold green)";
        error_symbol = "[x](bold red)";
      };
    };
  };

  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
  };

  home.sessionPath = [
    "$HOME/.local/bin"
  ];
}
```

---

## Summary

Home Manager transforms user environment management into a reproducible, declarative system:

1. **Home Manager manages user-level configuration**, complementing NixOS's system-level management
2. **Multiple installation methods** suit different workflows
3. **The `programs.*` modules** provide structured configuration for hundreds of programs
4. **`home.stateVersion` should never be changed** after initial setup
5. **Use `home.file` and `xdg.configFile`** for files without dedicated modules
6. **Generations provide built-in rollback** capabilities

---

## Exercises

1. Install Home Manager on your system
2. Configure Git using `programs.git`
3. Set up your shell with aliases and environment variables
4. Create a custom dotfile using `home.file`
5. Practice rolling back to a previous generation

---

## Further Reading

- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [Home Manager GitHub](https://github.com/nix-community/home-manager)
- [NixOS & Flakes Book](https://nixos-and-flakes.thiscute.world/nixos-with-flakes/start-using-home-manager)
