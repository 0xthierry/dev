# Chapter 7: Multi-System and Cross-Platform Configuration

## Introduction

As your Nix journey progresses, you will likely find yourself managing more than one machine. Perhaps you have a desktop and a laptop, a work machine and a personal one, or a mix of Linux and macOS systems. The true power of Nix emerges when you can share configuration across all these machines while still accommodating their unique requirements.

This chapter teaches you how to structure a single Nix flake that manages multiple machines across different architectures and operating systems.

---

## 7.1 Understanding System Tuples

Nix identifies target platforms using **system tuples**. These strings follow the pattern `<architecture>-<operating-system>`.

### The Four Primary System Tuples

| System Tuple | Description | Common Use Cases |
|--------------|-------------|------------------|
| `x86_64-linux` | 64-bit Intel/AMD Linux | Most Linux desktops and servers |
| `aarch64-linux` | 64-bit ARM Linux | Raspberry Pi 4/5, ARM servers |
| `x86_64-darwin` | 64-bit Intel macOS | Older MacBooks (pre-2020) |
| `aarch64-darwin` | 64-bit ARM macOS | Apple Silicon Macs (M1, M2, M3, M4) |

### Why System Tuples Matter

The system tuple determines:
- Which binaries to fetch from cache.nixos.org
- Which packages are available
- Which system paths to use
- Which platform-specific features can be enabled

---

## 7.2 Platform Detection and Conditional Configuration

### Using `pkgs.stdenv` Attributes

```nix
{ pkgs, lib, ... }:

{
  home.packages = with pkgs; [
    git
    ripgrep
  ] ++ lib.optionals pkgs.stdenv.isLinux [
    xclip
    inotify-tools
  ] ++ lib.optionals pkgs.stdenv.isDarwin [
    pngpaste
  ];
}
```

### Available Platform Detection Flags

| Flag | True When |
|------|-----------|
| `pkgs.stdenv.isLinux` | Running on any Linux system |
| `pkgs.stdenv.isDarwin` | Running on macOS |
| `pkgs.stdenv.hostPlatform.isAarch64` | Running on ARM64 |
| `pkgs.stdenv.hostPlatform.isx86_64` | Running on x86_64 |

### Using `lib.mkIf` for Conditional Modules

```nix
{ config, lib, pkgs, ... }:

{
  services.gpg-agent = lib.mkIf pkgs.stdenv.isLinux {
    enable = true;
    enableSshSupport = true;
  };
}
```

---

## 7.3 Home Manager Multi-Machine Setup

### The `homeConfigurations` Attribute Set

```nix
{
  outputs = { nixpkgs, home-manager, ... }: {
    homeConfigurations = {
      "alice@desktop" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [ ./hosts/desktop/home.nix ];
      };

      "alice@laptop" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [ ./hosts/laptop/home.nix ];
      };

      "alice@macbook" = home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.aarch64-darwin;
        modules = [ ./hosts/macbook/home.nix ];
      };
    };
  };
}
```

### Switching Between Configurations

```bash
home-manager switch --flake .#alice@desktop
home-manager switch --flake .#alice@macbook
```

---

## 7.4 Creating Helper Functions

### The `mkHome` Pattern

```nix
{
  outputs = { nixpkgs, home-manager, ... }@inputs:
  let
    mkHome = { username, hostname, system, extraModules ? [] }:
      home-manager.lib.homeManagerConfiguration {
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };

        extraSpecialArgs = {
          inherit username hostname system;
        };

        modules = [
          ./common/home.nix
          ./hosts/${hostname}/home.nix
        ] ++ extraModules;
      };
  in {
    homeConfigurations = {
      "alice@desktop" = mkHome {
        username = "alice";
        hostname = "desktop";
        system = "x86_64-linux";
      };

      "alice@macbook" = mkHome {
        username = "alice";
        hostname = "macbook";
        system = "aarch64-darwin";
      };
    };
  };
}
```

---

## 7.5 Platform-Specific Modules

### The `targets.genericLinux.enable` Option

For non-NixOS Linux distributions:

```nix
{ pkgs, lib, ... }:

{
  targets.genericLinux.enable = true;
}
```

This sets up XDG_DATA_DIRS, desktop file integration, and font discovery.

### nix-darwin for macOS

For comprehensive macOS configuration, use nix-darwin:

```nix
{
  inputs = {
    nix-darwin = {
      url = "github:nix-darwin/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nix-darwin, home-manager, ... }: {
    darwinConfigurations."macbook" = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        ./darwin/configuration.nix
        home-manager.darwinModules.home-manager
        {
          home-manager.useGlobalPkgs = true;
          home-manager.users.alice = import ./home/alice.nix;
        }
      ];
    };
  };
}
```

---

## 7.6 Organizing Shared vs Host-Specific Configuration

### Recommended Directory Structure

```
~/.config/nix/
├── flake.nix
├── flake.lock
├── common/
│   ├── home.nix
│   ├── git.nix
│   └── shell.nix
├── hosts/
│   ├── desktop/
│   │   └── home.nix
│   ├── laptop/
│   │   └── home.nix
│   └── macbook/
│       ├── home.nix
│       └── darwin.nix
└── modules/
    ├── linux/
    └── darwin/
```

### What Goes Where

**`common/`**: Configuration shared across all machines
- Base `home.nix`
- Git, SSH, shell configuration
- Programs that work identically across platforms

**`hosts/<hostname>/`**: Machine-specific configuration
- Hardware-specific settings
- Host-specific packages
- Display/monitor configuration

---

## 7.7 Managing Different Package Availability

### Conditional Package Lists

```nix
{ pkgs, lib, ... }:

{
  home.packages = with pkgs; [
    # Universal
    git
    ripgrep
  ] ++ lib.optionals stdenv.isLinux [
    # Linux-only
    xclip
    strace
  ] ++ lib.optionals stdenv.isDarwin [
    # macOS-only
    pngpaste
  ] ++ lib.optionals (stdenv.isLinux && stdenv.isx86_64) [
    # x86_64 Linux only
    zoom-us
  ];
}
```

---

## 7.8 Path Differences Between Platforms

### Home Directory Paths

| Platform | Home Directory Path |
|----------|---------------------|
| Linux | `/home/username` |
| macOS | `/Users/username` |

### Handling in Configuration

```nix
{ pkgs, username, ... }:

{
  home.homeDirectory =
    if pkgs.stdenv.isDarwin
    then "/Users/${username}"
    else "/home/${username}";
}
```

---

## 7.9 Real-World Patterns

### Pattern 1: Desktop + Laptop (Same OS)

```nix
homeConfigurations = {
  "alice@desktop" = mkHome {
    username = "alice";
    hostname = "desktop";
    system = "x86_64-linux";
    extraModules = [ ./modules/linux/gaming.nix ];
  };

  "alice@laptop" = mkHome {
    username = "alice";
    hostname = "laptop";
    system = "x86_64-linux";
    extraModules = [ ./modules/linux/power-management.nix ];
  };
};
```

### Pattern 2: Linux + macOS

```nix
{
  # Linux machines use homeConfigurations
  homeConfigurations."alice@desktop" = mkHome {
    username = "alice";
    hostname = "desktop";
    system = "x86_64-linux";
  };

  # macOS machines use darwinConfigurations
  darwinConfigurations."macbook" = mkDarwin {
    username = "alice";
    hostname = "macbook";
    system = "aarch64-darwin";
  };
}
```

---

## 7.10 nix-darwin Deep Dive

### Common nix-darwin Settings

```nix
# darwin/configuration.nix
{ pkgs, ... }:

{
  environment.systemPackages = with pkgs; [ vim git ];

  system.defaults = {
    dock = {
      autohide = true;
      show-recents = false;
    };
    finder = {
      AppleShowAllExtensions = true;
      ShowPathbar = true;
    };
  };

  security.pam.enableSudoTouchIdAuth = true;

  homebrew = {
    enable = true;
    casks = [ "firefox" "visual-studio-code" ];
  };

  services.nix-daemon.enable = true;
}
```

### Applying Darwin Configuration

```bash
# First time
nix run nix-darwin -- switch --flake .#macbook

# Subsequent updates
darwin-rebuild switch --flake .#macbook
```

---

## Summary

1. **System tuples** identify platforms: `x86_64-linux`, `aarch64-darwin`, etc.
2. **Platform detection** via `pkgs.stdenv.isLinux`, `isDarwin`
3. **`homeConfigurations`** for multiple machines
4. **Helper functions** reduce boilerplate
5. **`targets.genericLinux.enable`** for non-NixOS Linux
6. **nix-darwin** for macOS system configuration
7. **Organize** into `common/` and `hosts/` directories
8. **`lib.optionals`** for platform-specific packages

---

## Exercises

1. Add a new host configuration to your flake
2. Create a module that works on both Linux and macOS
3. Set up nix-darwin on a Mac (if available)
4. Create a helper function that detects the platform automatically

---

## Further Reading

- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [nix-darwin Documentation](https://github.com/nix-darwin/nix-darwin)
- [Example configurations on GitHub](https://github.com/topics/nix-config)
