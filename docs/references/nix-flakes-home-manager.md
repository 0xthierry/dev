# Nix Flakes and Home Manager Reference

## Overview

Nix Flakes with Home Manager provide a reproducible, declarative approach to managing user environments. Home Manager can be used **standalone** (independent of NixOS) or as a **NixOS/nix-darwin module**.

## Flake Structure for Standalone Home Manager

```nix
{
  description = "Home Manager configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, home-manager, ... }@inputs:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;  # Required for unfree packages
      };
    in {
      homeConfigurations."username" = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [ ./home.nix ];
        extraSpecialArgs = { inherit inputs; };
      };
    };
}
```

## Multi-Machine Setup Pattern

```nix
{
  description = "Multi-machine Home Manager configuration";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, home-manager, ... }@inputs:
    let
      mkHome = { system, username, hostname, extraModules ? [] }:
        home-manager.lib.homeManagerConfiguration {
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          modules = [
            ./home.nix           # Common configuration
            ./hosts/${hostname}/home.nix  # Host-specific
          ] ++ extraModules;
          extraSpecialArgs = {
            inherit inputs hostname;
          };
        };
    in {
      homeConfigurations = {
        "user@desktop" = mkHome {
          system = "x86_64-linux";
          username = "user";
          hostname = "desktop";
        };
        "user@laptop" = mkHome {
          system = "x86_64-linux";
          username = "user";
          hostname = "laptop";
        };
        "user@macbook" = mkHome {
          system = "aarch64-darwin";
          username = "user";
          hostname = "macbook";
        };
      };
    };
}
```

## Recommended Directory Structure

```
~/dev/
├── flake.nix               # Main flake configuration
├── flake.lock              # Pinned dependencies
├── home.nix                # Main home configuration
├── common/                 # Reusable modules
│   ├── cli-tools.nix
│   ├── git.nix
│   ├── zsh.nix
│   └── mise.nix
├── configs/                # Symlinked configs
│   ├── nvim/
│   ├── claude/
│   ├── zellij/
│   └── hypr/
└── hosts/                  # Host-specific configurations
    ├── omarchy.nix
    ├── dev.nix
    └── macbook.nix
```

## Key Commands

```bash
# Apply configuration
home-manager switch --flake .#hostname

# Update flake inputs
nix flake update

# Update single input
nix flake lock --update-input nixpkgs

# Show flake info
nix flake show
```

## Important Options

| Option | Purpose |
|--------|---------|
| `home-manager.useGlobalPkgs = true` | Uses the global pkgs instance |
| `home-manager.useUserPackages = true` | Installs to per-user profile |
| `inputs.nixpkgs.follows = "nixpkgs"` | Ensures same nixpkgs version |
| `config.allowUnfree = true` | Enable unfree packages (at pkgs import) |

## State Version

The `home.stateVersion` should remain at the version you first installed Home Manager:

```nix
home.stateVersion = "24.11";  # Don't change when upgrading
```

## Resources

- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [Home Manager Option Search](https://home-manager-options.extranix.com/)
- [NixOS & Flakes Book](https://nixos-and-flakes.thiscute.world/)
