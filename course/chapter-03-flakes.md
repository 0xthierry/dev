# Chapter 3: Nix Flakes - Modern Dependency Management

## Introduction

In the previous chapter, you learned the Nix language fundamentals. Now we will explore **Nix Flakes**, a modern approach to managing Nix projects and their dependencies. Flakes solve long-standing problems with reproducibility and project organization in the Nix ecosystem.

By the end of this chapter, you will understand:
- What flakes are and why they exist
- How to structure a `flake.nix` file
- How to declare and manage dependencies (inputs)
- How the lock file ensures reproducibility
- How to expose outputs from your flake
- Essential flake commands for daily use

---

## 3.1 What Are Nix Flakes?

A **flake** is a directory containing a file named `flake.nix` at its root. This file follows a specific schema that defines:

1. **Inputs**: Dependencies your project needs (other flakes, nixpkgs, etc.)
2. **Outputs**: What your flake produces (packages, configurations, development shells)

Flakes introduce several key improvements to Nix:

- **Standardized project structure**: Every flake has a predictable `flake.nix` format
- **Pinned dependencies**: A `flake.lock` file records exact versions of all inputs
- **Pure evaluation**: Flakes are evaluated in isolation, preventing accidental dependencies on system state
- **URL-like references**: A convenient syntax for referencing remote flakes (`github:owner/repo`)
- **Discoverability**: `nix flake show` reveals what a flake provides without reading code

### Why Were Flakes Introduced?

Before flakes, Nix projects suffered from several problems:

1. **Reproducibility gaps**: Two machines with the same Nix code could produce different results
2. **No standard structure**: Projects used ad-hoc conventions (`default.nix`, `shell.nix`, etc.)
3. **Global mutable state**: The `nix-channel` system and `NIX_PATH` variable introduced impurity
4. **Difficult dependency management**: No built-in way to pin and update dependencies

Flakes address all of these issues by providing a declarative, reproducible way to manage Nix projects.

---

## 3.2 The Problem with Channels (The Old Way)

Before flakes, most Nix users managed dependencies through **channels**. A channel is a pointer to a specific commit of a Nix repository (usually nixpkgs) that can be updated independently on each machine.

### How Channels Work

```bash
# Add a channel
sudo nix-channel --add https://nixos.org/channels/nixos-24.11 nixos

# Update channels to latest
sudo nix-channel --update
```

Nix code would then reference packages through `NIX_PATH`:

```nix
# The <nixpkgs> syntax uses NIX_PATH to find nixpkgs
let
  pkgs = import <nixpkgs> {};
in
  pkgs.hello
```

### The Problems

**Problem 1: Different machines, different results**

If Alice runs `nix-channel --update` on Monday and Bob runs it on Friday, their `<nixpkgs>` points to different commits. The same Nix expression produces different outputs.

**Problem 2: Global mutable state**

Channels are stored system-wide. The root user has channels, each user has channels, and they can conflict. Running `sudo nixos-rebuild` might use different nixpkgs than `nix-shell`.

**Problem 3: Invisible dependencies**

Looking at a Nix file that uses `<nixpkgs>`, you cannot tell which version of nixpkgs it expects. The dependency is implicit and external to the code.

**Problem 4: No coordination**

There is no mechanism to ensure a team uses the same nixpkgs version. Manual coordination is required to share the exact commit hash.

---

## 3.3 Flakes (The New Way)

Flakes solve these problems by making dependencies **explicit** and **locked**.

```nix
# flake.nix
{
  inputs = {
    # Explicit: we declare exactly which nixpkgs branch we want
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs = { self, nixpkgs }: {
    # nixpkgs is passed in, not magically imported
    packages.x86_64-linux.hello = nixpkgs.legacyPackages.x86_64-linux.hello;
  };
}
```

When you first evaluate this flake, Nix creates a `flake.lock` file pinning nixpkgs to a specific commit. Anyone who clones your repository gets the exact same nixpkgs version.

### Key Differences

| Aspect | Channels | Flakes |
|--------|----------|--------|
| Dependency declaration | Implicit (`<nixpkgs>`) | Explicit (`inputs.nixpkgs.url`) |
| Version pinning | Manual/external | Automatic (`flake.lock`) |
| Reproducibility | Per-machine | Universal |
| Project structure | Ad-hoc | Standardized |
| Evaluation | Impure by default | Pure by default |

---

## 3.4 Enabling Flakes

Flakes are an experimental feature in upstream Nix. You must explicitly enable them.

### Option 1: Determinate Nix Installer (Recommended)

The [Determinate Nix Installer](https://determinate.systems/) enables flakes by default and provides additional improvements:

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

### Option 2: Enable in Configuration

**On NixOS**, add to your configuration:

```nix
# configuration.nix
{
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}
```

**With Home Manager**:

```nix
# home.nix
{
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}
```

**Standalone Nix** (on macOS, other Linux distros):

Create or edit `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

### Option 3: Per-Command Flag

You can enable flakes for a single command:

```bash
nix --experimental-features 'nix-command flakes' build .#hello
```

This is useful for testing but impractical for regular use.

---

## 3.5 The flake.nix File Structure

Every flake has a `flake.nix` file with up to four top-level attributes:

```nix
{
  description = "A description of your flake";

  inputs = {
    # Dependencies go here
  };

  outputs = { self, ... }@inputs: {
    # What the flake produces
  };

  nixConfig = {
    # Optional: flake-specific Nix settings
  };
}
```

### 3.5.1 description

A human-readable string describing your flake:

```nix
{
  description = "My personal NixOS and Home Manager configurations";
}
```

This appears when running `nix flake show` or `nix flake metadata`.

### 3.5.2 inputs

The `inputs` attribute declares your flake's dependencies. Each input has a name and a URL:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    home-manager.url = "github:nix-community/home-manager/release-24.11";
  };
}
```

We will cover input types in detail in section 3.6.

### 3.5.3 outputs

The `outputs` attribute is a **function** that receives all resolved inputs and returns an attribute set of what the flake produces:

```nix
{
  outputs = { self, nixpkgs, home-manager }: {
    # Packages, configurations, shells, etc.
  };
}
```

The first argument is always `self`, a reference to the flake itself. The remaining arguments are your declared inputs by name.

A common pattern uses `@inputs` to capture all inputs:

```nix
{
  outputs = { self, nixpkgs, ... }@inputs: {
    # Now 'inputs' contains all inputs as an attribute set
  };
}
```

### 3.5.4 nixConfig (Optional)

Override Nix settings for this flake:

```nix
{
  nixConfig = {
    extra-substituters = [
      "https://nix-community.cachix.org"
    ];
    extra-trusted-public-keys = [
      "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
    ];
  };
}
```

**Security note**: Nix will prompt before accepting these settings since they can affect build behavior.

---

## 3.6 Input Types

Flake inputs can come from various sources. Here are the most common types:

### 3.6.1 GitHub Repositories

The most common input type:

```nix
{
  inputs = {
    # Default branch
    nixpkgs.url = "github:NixOS/nixpkgs";

    # Specific branch
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    # Specific commit
    nixpkgs.url = "github:NixOS/nixpkgs/507b63021ada5fee621b6ca371c4fca9ca46f52c";

    # Specific tag
    nixpkgs.url = "github:NixOS/nixpkgs/24.11";
  };
}
```

### 3.6.2 Git URLs

For any Git repository:

```nix
{
  inputs = {
    # HTTPS
    myrepo.url = "git+https://example.com/repo.git";

    # SSH
    private-repo.url = "git+ssh://git@github.com/owner/private-repo.git";

    # Specific branch
    myrepo.url = "git+https://example.com/repo.git?ref=develop";

    # Specific revision
    myrepo.url = "git+https://example.com/repo.git?rev=abc123";
  };
}
```

### 3.6.3 Local Paths

Reference flakes on your filesystem:

```nix
{
  inputs = {
    # Relative path (from flake root)
    local-config.url = "path:./modules/config";

    # Absolute path
    system-flake.url = "path:/etc/nixos";
  };
}
```

**Note**: Local path inputs in Git repositories only see files tracked by Git.

### 3.6.4 Tarballs

Direct URL to a tarball:

```nix
{
  inputs = {
    nixpkgs.url = "https://github.com/NixOS/nixpkgs/archive/nixos-24.11.tar.gz";
  };
}
```

### 3.6.5 Non-Flake Inputs

Not everything needs to be a flake. You can import raw files or non-flake repositories:

```nix
{
  inputs = {
    # A repository without flake.nix
    some-config = {
      url = "github:owner/config-repo";
      flake = false;
    };

    # A single file
    some-file = {
      url = "https://example.com/file.txt";
      flake = false;
    };
  };
}
```

With `flake = false`, the input is fetched but not evaluated as a flake. You access it as a path in your outputs.

### 3.6.6 Following Inputs (The `follows` Attribute)

When you have multiple inputs that depend on nixpkgs, each brings its own version by default. This wastes disk space and can cause compatibility issues.

The `follows` attribute lets you override an input's dependency to use your version instead:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    home-manager = {
      url = "github:nix-community/home-manager/release-24.11";
      # Make home-manager use OUR nixpkgs instead of its own
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Alternative shorthand syntax
    hyprland.url = "github:hyprwm/Hyprland";
    hyprland.inputs.nixpkgs.follows = "nixpkgs";
  };
}
```

**Why use follows?**

1. **Consistency**: All inputs use the same nixpkgs version
2. **Disk space**: Avoid downloading multiple nixpkgs copies
3. **Compatibility**: Prevent version mismatches between libraries

**Best practice**: Always make inputs follow your primary nixpkgs unless you have a specific reason not to.

---

## 3.7 The flake.lock File

When you evaluate a flake for the first time, Nix creates a `flake.lock` file. This JSON file records the exact version (commit hash) of every input.

### What It Contains

```json
{
  "nodes": {
    "nixpkgs": {
      "locked": {
        "lastModified": 1705377448,
        "narHash": "sha256-jhZDfXVKdD7TSEGgzFJQvEEZ2K65UMiqW5YJ2aIqxMA=",
        "owner": "NixOS",
        "repo": "nixpkgs",
        "rev": "507b63021ada5fee621b6ca371c4fca9ca46f52c",
        "type": "github"
      },
      "original": {
        "owner": "NixOS",
        "ref": "nixos-24.11",
        "repo": "nixpkgs",
        "type": "github"
      }
    },
    "root": {
      "inputs": {
        "nixpkgs": "nixpkgs"
      }
    }
  },
  "root": "root",
  "version": 7
}
```

Key fields:
- `locked.rev`: The exact Git commit
- `locked.narHash`: A hash verifying the content
- `locked.lastModified`: Timestamp of the commit
- `original`: What you wrote in `flake.nix`

### How It Ensures Reproducibility

1. You specify `github:NixOS/nixpkgs/nixos-24.11` (a moving target)
2. Nix resolves this to commit `507b63...` and records it in `flake.lock`
3. Anyone evaluating your flake uses commit `507b63...`, not "whatever nixos-24.11 points to now"
4. The `narHash` ensures the content matches exactly

**Always commit `flake.lock` to version control.** This is what makes your builds reproducible across machines and time.

### Updating Dependencies

#### Update All Inputs

```bash
nix flake update
```

This resolves all inputs to their latest versions and updates `flake.lock`.

#### Update a Single Input

```bash
nix flake update nixpkgs
```

Or the older syntax (still works):

```bash
nix flake lock --update-input nixpkgs
```

#### Update Specific Inputs

```bash
nix flake update home-manager nixpkgs
```

#### See What Would Change

```bash
nix flake update --dry-run
```

---

## 3.8 Output Types

The `outputs` function returns an attribute set. Certain attribute names have conventional meanings that Nix tools understand.

### 3.8.1 packages

Packages that can be built with `nix build`:

```nix
{
  outputs = { self, nixpkgs }: {
    packages.x86_64-linux.hello = nixpkgs.legacyPackages.x86_64-linux.hello;
    packages.x86_64-linux.default = self.packages.x86_64-linux.hello;

    packages.aarch64-linux.hello = nixpkgs.legacyPackages.aarch64-linux.hello;
  };
}
```

The structure is `packages.<system>.<name>`. The `default` package is built when you run `nix build` without specifying a package.

### 3.8.2 devShells

Development environments entered with `nix develop`:

```nix
{
  outputs = { self, nixpkgs }:
    let
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
    in {
      devShells.x86_64-linux.default = pkgs.mkShell {
        buildInputs = [ pkgs.nodejs pkgs.yarn pkgs.git ];

        shellHook = ''
          echo "Welcome to the development environment!"
        '';
      };
    };
}
```

### 3.8.3 nixosConfigurations

Full NixOS system configurations:

```nix
{
  outputs = { self, nixpkgs }: {
    nixosConfigurations.my-server = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
      ];
    };
  };
}
```

Build with:
```bash
nixos-rebuild switch --flake .#my-server
```

### 3.8.4 homeConfigurations

Home Manager configurations for user environments:

```nix
{
  outputs = { self, nixpkgs, home-manager }: {
    homeConfigurations."alice@workstation" = home-manager.lib.homeManagerConfiguration {
      pkgs = nixpkgs.legacyPackages.x86_64-linux;
      modules = [ ./home.nix ];
    };
  };
}
```

Apply with:
```bash
home-manager switch --flake .#alice@workstation
```

### 3.8.5 Other Common Outputs

```nix
{
  outputs = { self, nixpkgs }: {
    # Overlays to extend nixpkgs
    overlays.default = final: prev: {
      myPackage = final.callPackage ./package.nix {};
    };

    # NixOS modules
    nixosModules.default = import ./module.nix;

    # Home Manager modules
    homeManagerModules.default = import ./hm-module.nix;

    # Formatter (used by nix fmt)
    formatter.x86_64-linux = nixpkgs.legacyPackages.x86_64-linux.nixfmt-rfc-style;

    # Apps (runnable with nix run)
    apps.x86_64-linux.default = {
      type = "app";
      program = "${self.packages.x86_64-linux.hello}/bin/hello";
    };

    # Project templates
    templates.default = {
      path = ./template;
      description = "A basic project template";
    };
  };
}
```

---

## 3.9 Flake References

Flake references are the strings you use to refer to flakes in commands and inputs.

### Reference Syntax

| Format | Example | Description |
|--------|---------|-------------|
| `.` | `.` | Current directory |
| `.#output` | `.#hello` | Specific output from current directory |
| `path:` | `path:/etc/nixos` | Absolute path |
| `github:` | `github:NixOS/nixpkgs` | GitHub repository |
| `gitlab:` | `gitlab:owner/repo` | GitLab repository |
| `git+` | `git+https://...` | Any Git URL |
| Indirect | `nixpkgs` | Uses flake registry |

### Specifying Outputs

The `#` separator specifies which output to use:

```bash
# Build default package
nix build .

# Build specific package
nix build .#hello

# Build from remote flake
nix build github:NixOS/nixpkgs#cowsay

# Run an app
nix run nixpkgs#hello

# Enter a dev shell
nix develop .#frontend
```

### Flake Registry

Nix maintains a registry mapping short names to flake URLs:

```bash
# Show registry
nix registry list

# Add to registry
nix registry add myflake github:user/repo

# Use registry entry
nix run myflake#app
```

The global registry includes `nixpkgs` by default, which is why `nix run nixpkgs#hello` works.

---

## 3.10 Common Flake Commands

### Inspection Commands

```bash
# Show what a flake provides
nix flake show
nix flake show github:NixOS/nixpkgs

# Show flake metadata (inputs, revision, etc.)
nix flake metadata
nix flake metadata github:owner/repo

# Check flake for errors
nix flake check
```

### Building and Running

```bash
# Build default package
nix build

# Build specific package
nix build .#mypackage

# Build and run
nix run .#myapp

# Enter development shell
nix develop

# Enter shell for specific devShell
nix develop .#frontend
```

### Lock File Management

```bash
# Create or update lock file
nix flake lock

# Update all inputs
nix flake update

# Update specific input
nix flake update nixpkgs

# Show lock file contents in readable form
nix flake metadata --json | jq '.locks'
```

### Creating Flakes

```bash
# Initialize new flake from template
nix flake init

# Initialize from specific template
nix flake init -t templates#rust

# Create new flake in specific directory
nix flake new ./my-project
nix flake new -t templates#python ./my-python-project
```

### Other Useful Commands

```bash
# Archive flake and all inputs
nix flake archive

# Copy flake closure to another store
nix copy --to ssh://server .#package

# Prefetch a flake (useful for getting hashes)
nix flake prefetch github:owner/repo
```

---

## 3.11 A Complete Example

Here is a practical flake that brings together everything we have learned:

```nix
{
  description = "My development environment and home configuration";

  inputs = {
    # Primary nixpkgs input
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    # Home Manager for user configuration
    home-manager = {
      url = "github:nix-community/home-manager/release-24.11";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # A useful utility library (non-flake)
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, home-manager, flake-utils }:
    let
      # Helper to generate outputs for multiple systems
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      # Packages available via `nix build .#<name>`
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          hello = pkgs.hello;
          default = pkgs.hello;
        }
      );

      # Development shells via `nix develop`
      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            buildInputs = with pkgs; [
              git
              nixfmt-rfc-style
              nil  # Nix LSP
            ];
          };

          # Additional shell for web development
          web = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs
              yarn
              typescript
            ];
          };
        }
      );

      # Home Manager configuration
      homeConfigurations = {
        "myuser@myhost" = home-manager.lib.homeManagerConfiguration {
          pkgs = nixpkgs.legacyPackages.x86_64-linux;
          modules = [ ./home.nix ];
        };
      };

      # Formatter for `nix fmt`
      formatter = forAllSystems (system:
        nixpkgs.legacyPackages.${system}.nixfmt-rfc-style
      );
    };
}
```

### Using This Flake

```bash
# Build the default package
nix build

# Enter development environment
nix develop

# Enter web development environment
nix develop .#web

# Apply Home Manager configuration
home-manager switch --flake .#myuser@myhost

# Format all Nix files
nix fmt

# Update all dependencies
nix flake update

# See what the flake provides
nix flake show
```

---

## 3.12 Best Practices

### 1. Always Commit flake.lock

The lock file is essential for reproducibility. Without it, builds depend on the current state of your inputs.

### 2. Use follows for Shared Dependencies

Especially for nixpkgs. This avoids downloading multiple versions and ensures compatibility:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
    my-other-input.inputs.nixpkgs.follows = "nixpkgs";
  };
}
```

### 3. Pin to Stable Branches

For production systems, use release branches rather than `nixpkgs-unstable`:

```nix
nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";  # Good
nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";  # More risk
```

### 4. Update Deliberately

Do not blindly run `nix flake update`. Review changes and test before committing:

```bash
# See what would change
nix flake update --dry-run

# Update and test
nix flake update
nix build
nix flake check
```

### 5. Use Explicit URLs in flake.nix

Avoid relying on the flake registry inside your flake. Use full URLs:

```nix
# Good: explicit
inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

# Avoid: relies on registry
inputs.nixpkgs.url = "nixpkgs";
```

### 6. Support Multiple Systems

Use helpers to generate outputs for multiple architectures:

```nix
let
  systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
  forAllSystems = nixpkgs.lib.genAttrs systems;
in
{
  packages = forAllSystems (system: { ... });
}
```

### 7. Include a Default Output

Always define `default` for packages and devShells so users can run `nix build` or `nix develop` without arguments.

### 8. Add Git Files Before Building

In a Git repository, Nix only sees tracked files. If you create a new file, add it to Git:

```bash
git add flake.nix  # Required before nix build can see it
```

---

## 3.13 Summary

Nix Flakes provide a modern, reproducible approach to Nix projects:

- **flake.nix** declares your project's structure, inputs, and outputs
- **inputs** specify dependencies with precise URLs
- **follows** prevents dependency duplication
- **flake.lock** pins exact versions for reproducibility
- **outputs** expose packages, shells, configurations, and more
- The new **nix commands** (build, develop, run, flake) work with flakes

In the next chapter, we will explore Nixpkgs - the massive package collection that powers the Nix ecosystem.

---

## Exercises

1. Create a minimal flake that exposes a "hello world" shell script as a package
2. Add a `devShell` to your flake with your favorite development tools
3. Add a second input (e.g., `flake-utils`) and make it follow your nixpkgs
4. Run `nix flake update` and examine the changes to `flake.lock`
5. Use `nix flake show` on several public flakes to see what they provide

---

## Quick Reference

```bash
# Essential commands
nix flake init          # Create new flake
nix flake show          # Show outputs
nix flake metadata      # Show metadata and inputs
nix flake update        # Update all inputs
nix flake lock          # Create/update lock file
nix flake check         # Validate flake

# Building and running
nix build               # Build default package
nix build .#name        # Build specific package
nix develop             # Enter default devShell
nix run .#app           # Run an app

# System management
nixos-rebuild switch --flake .#hostname
home-manager switch --flake .#user@host
```
