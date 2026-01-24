# Chapter 10: Building & Extending Your Nix Configuration

## Introduction

Congratulations on reaching the final chapter! You now have a working Home Manager configuration. This chapter transforms you from a Nix user into a Nix practitioner - someone who can confidently extend, debug, and maintain their configuration as it grows.

---

## 10.1 Adding New Packages

### Finding Packages on search.nixos.org

Visit [search.nixos.org/packages](https://search.nixos.org/packages):
- Search by program name or description
- Filter by platform
- Note the "Attribute" for your configuration

### Using nix search

```bash
nix search nixpkgs ripgrep
nix search nixpkgs "json.*formatter"
```

### Adding to home.packages

```nix
{ pkgs, ... }:
{
  home.packages = with pkgs; [
    ripgrep
    fd
    nodejs
    python3
  ];
}
```

### Finding programs.* Modules

- **Home Manager Options Search**: [home-manager-options.extranix.com](https://home-manager-options.extranix.com/)
- **NixOS Search**: [search.nixos.org/options](https://search.nixos.org/options)

### When to Use Which

| Scenario | Approach |
|----------|----------|
| Simple tool, no config | `home.packages` |
| Tool with configuration | `programs.*` if available |
| No HM module exists | `home.packages` + `home.file` |

---

## 10.2 Creating New Host Configurations

### Flake Structure

```nix
{
  outputs = { nixpkgs, home-manager, ... }:
  let
    mkHome = { system, username, hostname }:
      home-manager.lib.homeManagerConfiguration {
        pkgs = nixpkgs.legacyPackages.${system};
        modules = [
          ./hosts/${hostname}.nix
          ./common/home.nix
        ];
        extraSpecialArgs = { inherit hostname username; };
      };
  in {
    homeConfigurations = {
      "alice@workstation" = mkHome {
        system = "x86_64-linux";
        username = "alice";
        hostname = "workstation";
      };

      "alice@macbook" = mkHome {
        system = "aarch64-darwin";
        username = "alice";
        hostname = "macbook";
      };
    };
  };
}
```

### Host-Specific Configuration

```nix
# hosts/workstation.nix
{ pkgs, username, ... }:
{
  home.username = username;
  home.homeDirectory = "/home/${username}";
  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    # Workstation-specific packages
  ];
}
```

---

## 10.3 Creating Reusable Modules

### The Enable Option Pattern

```nix
# modules/programs/mytool.nix
{ config, lib, pkgs, ... }:

let
  cfg = config.programs.myTool;
in
{
  options.programs.myTool = {
    enable = lib.mkEnableOption "myTool";
    package = lib.mkPackageOption pkgs "mytool" { };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
```

### Usage

```nix
{
  imports = [ ./modules/programs/mytool.nix ];
  programs.myTool.enable = true;
}
```

---

## 10.4 Day-to-Day Workflow

### Basic Workflow

```bash
# Edit configuration
$EDITOR home.nix

# Test the build
home-manager build --flake .

# Apply changes
home-manager switch --flake .

# If something breaks, rollback
home-manager rollback
```

### Useful Commands

```bash
# List generations
home-manager generations

# Show what would change
home-manager build --flake .

# Verbose output
home-manager switch --flake . --print-build-logs
```

---

## 10.5 Updating Dependencies

### Update All Inputs

```bash
nix flake update
```

### Update Specific Inputs

```bash
nix flake update nixpkgs
nix flake update home-manager
```

### Review and Apply

```bash
git diff flake.lock
home-manager build --flake .
home-manager switch --flake .
git add flake.lock
git commit -m "chore: update flake inputs"
```

---

## 10.6 Debugging Common Issues

### "Attribute not found"

- Check spelling
- Search for correct package name: `nix search nixpkgs name`
- Check platform availability

### Infinite Recursion

```nix
# BAD
config = if config.foo then { ... } else { };

# GOOD
config = lib.mkIf config.foo { ... };
```

### Hash Mismatches

Update the hash to the value from the error message:

```nix
src = fetchurl {
  url = "https://example.com/file.tar.gz";
  sha256 = "sha256-NEWVALUE...";  # From error message
};
```

### General Debugging

```bash
# Full trace
home-manager build --flake . --show-trace

# Check specific option
nix eval .#homeConfigurations.hostname.config.programs.git.enable

# Interactive exploration
nix repl
:lf .
homeConfigurations.hostname.config.programs.git
```

---

## 10.7 Advanced Patterns

### Overlays

```nix
# overlays/default.nix
final: prev: {
  myPackage = final.callPackage ./my-package.nix {};

  htop = prev.htop.overrideAttrs (old: {
    patches = (old.patches or []) ++ [ ./my-patch.patch ];
  });
}
```

### Using Overlays

```nix
{
  outputs = { nixpkgs, ... }:
  let
    overlays = [ (import ./overlays/default.nix) ];
  in {
    homeConfigurations.myuser = {
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        inherit overlays;
      };
      # ...
    };
  };
}
```

### External Flakes

```nix
{
  inputs = {
    nix-colors.url = "github:misterio77/nix-colors";
  };

  outputs = { nix-colors, ... }: {
    homeConfigurations.myuser = {
      extraSpecialArgs = { inherit nix-colors; };
      modules = [ ./home.nix ];
    };
  };
}
```

---

## 10.8 Configuration Organization

### Recommended Structure

```
~/.config/home-manager/
├── flake.nix
├── flake.lock
├── common/
│   ├── home.nix
│   ├── git.nix
│   └── shell.nix
├── hosts/
│   ├── workstation.nix
│   └── macbook.nix
├── modules/
│   └── programs/
└── overlays/
```

### What Goes Where

- **common/**: Shared across all machines
- **hosts/**: Machine-specific configuration
- **modules/**: Reusable custom modules
- **overlays/**: Package modifications

---

## 10.9 Git Workflow

### .gitignore

```gitignore
result
result-*
*.swp
.direnv/
```

### Branch Strategy

```bash
# Risky changes
git checkout -b experiment/new-shell

# Test
home-manager switch --flake .

# If works, merge
git checkout main
git merge experiment/new-shell

# If fails
home-manager rollback
git checkout main
git branch -D experiment/new-shell
```

### Commit Messages

```
feat: add Python development module
fix: correct zsh plugin order
chore: update flake inputs
```

---

## 10.10 Community Resources

### Official Resources

| Resource | URL |
|----------|-----|
| NixOS Discourse | [discourse.nixos.org](https://discourse.nixos.org) |
| NixOS Manual | [nixos.org/manual/nixos/stable](https://nixos.org/manual/nixos/stable) |
| nix.dev | [nix.dev](https://nix.dev) |

### Real-Time Chat

- **Matrix**: [#nix:nixos.org](https://matrix.to/#/#nix:nixos.org)
- **Discord**: [discord.gg/nix-community](https://discord.gg/nix-community)

### Learning Resources

- [Zero to Nix](https://zero-to-nix.com)
- [NixOS & Flakes Book](https://nixos-and-flakes.thiscute.world)
- [Awesome Nix](https://github.com/nix-community/awesome-nix)

---

## 10.11 Performance Tips

### Garbage Collection

```bash
# Remove unused packages
nix store gc

# Delete old generations first
nix-collect-garbage --delete-older-than 30d

# Delete all old + gc
nix-collect-garbage -d
```

### Store Optimization

```bash
nix store optimise
```

### NixOS Automatic GC

```nix
{
  nix.gc = {
    automatic = true;
    dates = "weekly";
    options = "--delete-older-than 30d";
  };
  nix.settings.auto-optimise-store = true;
}
```

---

## Summary

You have learned:

1. **Adding packages** via search, `home.packages`, and `programs.*`
2. **Managing hosts** with helper functions
3. **Writing modules** with the enable pattern
4. **Daily workflow** for editing and applying changes
5. **Updating** flake inputs
6. **Debugging** common errors
7. **Advanced patterns** like overlays
8. **Organization** of configuration files
9. **Git workflow** for version control
10. **Community resources** for help

---

## Quick Reference

```bash
# Daily Commands
home-manager switch --flake .#hostname
home-manager build --flake .
home-manager generations
home-manager rollback

# Updating
nix flake update
nix flake update nixpkgs

# Debugging
home-manager switch --flake . --show-trace
nix eval .#homeConfigurations.hostname.config.programs.git

# Maintenance
nix store gc
nix-collect-garbage -d
nix store optimise

# Discovery
nix search nixpkgs packagename
# search.nixos.org
# home-manager-options.extranix.com
```

---

## Your Journey Continues

Paths to explore next:
- **NixOS** for full system management
- **nix-darwin** for macOS configuration
- **devenv/direnv** for project environments
- **Contributing to nixpkgs**

Welcome to the Nix community!
