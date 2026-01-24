# Chapter 4: Nixpkgs - The Package Collection

## Introduction

Nixpkgs is the beating heart of the Nix ecosystem. It is one of the largest and most actively maintained software repositories in existence, containing over 100,000 packages covering everything from command-line utilities to complete desktop environments. Understanding how to navigate, use, and extend Nixpkgs is essential for any serious Nix user.

This chapter explores Nixpkgs from the ground up: what it is, how it is organized, how to find packages, and how packages work internally.

---

## 4.1 What is Nixpkgs?

Nixpkgs is a **monorepo** - a single Git repository containing Nix expressions for building tens of thousands of software packages. It is hosted on GitHub at [github.com/NixOS/nixpkgs](https://github.com/NixOS/nixpkgs).

### Scale and Statistics

- **100,000+ packages** - More packages than Debian, Arch AUR, or Homebrew
- **Thousands of contributors** - One of the most active repositories on GitHub
- **Continuous updates** - Packages are updated daily
- **Cross-platform** - Supports Linux (x86_64, aarch64) and macOS (Intel and Apple Silicon)

### Community Maintained

Nixpkgs is entirely community-driven. Anyone can:
- Submit pull requests to add or update packages
- Review and merge changes (with appropriate permissions)
- Report issues and request packages

The project has a loose governance structure with specialized teams for different areas (security, release management, specific package sets like Python or Haskell).

### Monorepo Structure

All packages live in a single repository, which provides:
- **Atomic updates**: Changes to multiple packages can be coordinated
- **Consistent tooling**: All packages use the same build infrastructure
- **Easy cross-references**: Packages can easily depend on each other
- **Single source of truth**: No fragmentation across multiple repositories

---

## 4.2 Nixpkgs Branches and Channels

Nixpkgs uses branches to manage stability levels. Understanding which branch to use is important for balancing freshness against stability.

### Main Branches

| Branch | Purpose | Update Frequency | Stability |
|--------|---------|------------------|-----------|
| `master` | Development | Continuous | Unstable |
| `nixpkgs-unstable` | Tested master | Daily | Semi-stable |
| `nixos-unstable` | NixOS-tested | Daily | Better tested |
| `nixos-24.11` | Stable release | Security/critical only | High |
| `nixos-24.05` | Previous stable | Security only | High |

### Understanding the Branches

**`master`**: The main development branch. All changes land here first. Not recommended for general use - things may be broken.

**`nixpkgs-unstable`**: A tested snapshot of master. Packages here have passed basic CI tests. Good for non-NixOS systems that want fresh packages.

**`nixos-unstable`**: Like `nixpkgs-unstable`, but also tested as a complete NixOS system. The recommended "unstable" choice for NixOS users.

**`nixos-YY.MM`** (e.g., `nixos-24.11`): Stable releases that happen every six months (May and November). These receive:
- Security updates
- Critical bug fixes
- No new features or major version bumps

### When to Use Which

| Use Case | Recommended Branch |
|----------|-------------------|
| Production servers | `nixos-24.11` (latest stable) |
| Desktop daily driver | `nixos-unstable` or stable |
| Development workstation | `nixos-unstable` |
| Bleeding edge | `nixpkgs-unstable` |
| Non-NixOS Linux | `nixpkgs-unstable` |
| macOS | `nixpkgs-unstable` |

### In Flakes

```nix
{
  inputs = {
    # Stable
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

    # Unstable
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # Specific commit (maximum reproducibility)
    nixpkgs.url = "github:NixOS/nixpkgs/507b63021ada5fee621b6ca371c4fca9ca46f52c";
  };
}
```

---

## 4.3 Finding Packages

### search.nixos.org (Recommended)

The official package search at [search.nixos.org/packages](https://search.nixos.org/packages) is the best way to find packages.

**Features:**
- Full-text search across names and descriptions
- Filter by platform (x86_64-linux, aarch64-darwin, etc.)
- Shows package version, description, and homepage
- Links to source code in Nixpkgs
- Option to search different channels

**Using the Search:**

1. Enter a search term (e.g., "video editor")
2. Click on a result to see details
3. Note the "Install" instructions showing the attribute path
4. The "Source" link shows the Nix expression

### nix search Command

Search from the terminal:

```bash
# Basic search
nix search nixpkgs firefox

# Search with regex
nix search nixpkgs "^python3[0-9]+$"

# Search descriptions too
nix search nixpkgs --long "video editor"

# Search a specific flake
nix search github:NixOS/nixpkgs/nixos-24.11 neovim
```

**Note:** The first search downloads a package index and can be slow. Subsequent searches are fast.

### REPL Exploration

For interactive exploration:

```bash
$ nix repl
nix-repl> :l <nixpkgs>
Added 20000 variables.

nix-repl> pkgs.firefox
«derivation /nix/store/...-firefox-121.0.drv»

nix-repl> pkgs.python3Packages.requests
«derivation /nix/store/...-python3.11-requests-2.31.0.drv»

# Tab completion works
nix-repl> pkgs.python3Packages.req<TAB>
pkgs.python3Packages.requests
pkgs.python3Packages.requests-cache
pkgs.python3Packages.requests-mock
...
```

### GitHub Browsing

For exploring package definitions:

1. Go to [github.com/NixOS/nixpkgs](https://github.com/NixOS/nixpkgs)
2. Navigate to `pkgs/` directory
3. Packages are organized by category:
   - `pkgs/applications/` - GUI applications
   - `pkgs/development/` - Development tools
   - `pkgs/tools/` - CLI utilities
   - `pkgs/servers/` - Server software

---

## 4.4 Package Structure Basics

### What is a Derivation?

In Nix, a **derivation** is the fundamental unit of building. It describes:
- What to build (source code, patches)
- How to build it (build commands, compiler flags)
- What dependencies are needed
- Where to put the output

When you write `pkgs.firefox`, you get a derivation. When Nix builds it, the derivation becomes a realized store path like `/nix/store/abc123-firefox-121.0/`.

### A Simple Package

Here is a minimal package definition:

```nix
{ lib, stdenv, fetchurl }:

stdenv.mkDerivation rec {
  pname = "hello";
  version = "2.12";

  src = fetchurl {
    url = "https://ftp.gnu.org/gnu/hello/hello-${version}.tar.gz";
    sha256 = "sha256-abc123...";
  };

  meta = {
    description = "A program that produces a familiar, friendly greeting";
    homepage = "https://www.gnu.org/software/hello/";
    license = lib.licenses.gpl3Plus;
    platforms = lib.platforms.all;
  };
}
```

### Key Components

**`stdenv.mkDerivation`**: The standard function for building packages. It handles:
- Unpacking source archives
- Running configure/make/make install
- Setting up the build environment

**`pname` and `version`**: Package name and version. Combined to form the store path name.

**`src`**: The source to build from. Usually fetched with `fetchurl`, `fetchFromGitHub`, etc.

**`meta`**: Metadata about the package (description, license, platforms).

### Build Inputs vs Runtime Inputs

Nix distinguishes between dependencies needed at build time and runtime:

```nix
{ stdenv, cmake, openssl, zlib }:

stdenv.mkDerivation {
  # ...

  # Build-time only dependencies
  nativeBuildInputs = [ cmake ];

  # Runtime dependencies (also available at build time)
  buildInputs = [ openssl zlib ];
}
```

- **`nativeBuildInputs`**: Tools needed to build (compilers, build systems, code generators). Not included in the final package's runtime closure.

- **`buildInputs`**: Libraries and tools needed both to build AND at runtime. These become dependencies of the final package.

### How Packages Reference Each Other

Packages form a dependency graph. When you use a package:

```nix
{ pkgs }:
{
  home.packages = [ pkgs.ripgrep ];
}
```

Nix automatically:
1. Builds all dependencies of ripgrep
2. Makes those dependencies available at runtime
3. Ensures the correct versions are used

---

## 4.5 Using Packages

### Temporary Usage with nix-shell / nix shell

Try a package without installing:

```bash
# Classic nix-shell
nix-shell -p nodejs python3 git

# Modern nix shell (with flakes)
nix shell nixpkgs#nodejs nixpkgs#python3 nixpkgs#git

# Run a single command
nix shell nixpkgs#cowsay --command cowsay "Hello!"
```

The packages are available only in that shell session.

### Adding to home.packages

In Home Manager, install packages to your user profile:

```nix
{ pkgs, ... }:
{
  home.packages = with pkgs; [
    # CLI tools
    ripgrep
    fd
    bat
    jq

    # Development
    nodejs
    python3
    rustc
    cargo

    # Applications
    firefox
    vscode
  ];
}
```

### Using programs.* Modules

Many programs have dedicated Home Manager modules that provide structured configuration:

```nix
{ pkgs, ... }:
{
  # Instead of: home.packages = [ pkgs.git ];
  # Use the module for richer configuration:
  programs.git = {
    enable = true;
    userName = "Your Name";
    userEmail = "your@email.com";

    extraConfig = {
      init.defaultBranch = "main";
    };
  };
}
```

The `programs.*` approach is preferred when available because:
- It generates correct configuration files
- Options are type-checked
- Documentation is available

### NixOS System Packages

On NixOS, system-wide packages go in configuration.nix:

```nix
{ pkgs, ... }:
{
  environment.systemPackages = with pkgs; [
    vim
    git
    wget
    curl
  ];
}
```

---

## 4.6 Package Overlays

Overlays let you modify or extend Nixpkgs. They are functions that take two arguments (`final` and `prev`) and return a set of packages to add or override.

### What Overlays Are

```nix
final: prev: {
  # Add a new package
  myPackage = final.callPackage ./my-package.nix {};

  # Override an existing package
  htop = prev.htop.overrideAttrs (old: {
    patches = old.patches or [] ++ [ ./my-htop-patch.patch ];
  });
}
```

- **`prev`**: The previous (unmodified) package set
- **`final`**: The final package set (including this overlay's changes)

### When to Use Overlays

- **Custom packages**: Add packages not in Nixpkgs
- **Patches**: Apply custom patches to existing packages
- **Version pinning**: Use a specific version of a package
- **Configuration**: Build packages with different options

### Using Overlays in Flakes

```nix
{
  outputs = { nixpkgs, ... }:
  let
    overlays = [
      (final: prev: {
        myApp = final.callPackage ./my-app.nix {};
      })
    ];
  in {
    homeConfigurations.myuser = home-manager.lib.homeManagerConfiguration {
      pkgs = import nixpkgs {
        system = "x86_64-linux";
        inherit overlays;
      };
      modules = [ ./home.nix ];
    };
  };
}
```

---

## 4.7 Understanding pkgs

### The pkgs Argument

In modules, `pkgs` is your gateway to all packages:

```nix
{ pkgs, ... }:
{
  home.packages = [
    pkgs.ripgrep           # A package
    pkgs.python3           # Another package
    pkgs.python3Packages.requests  # A package from a package set
  ];
}
```

### pkgs.lib - Library Functions

`pkgs.lib` (or just `lib`) provides utility functions:

```nix
{ lib, pkgs, ... }:
{
  home.packages = lib.optionals pkgs.stdenv.isLinux [
    pkgs.xclip
  ];
}
```

Common lib functions:
- `lib.mkIf` - Conditional configuration
- `lib.optionals` - Conditional list items
- `lib.mkOption` - Declare options
- `lib.strings.*` - String manipulation
- `lib.lists.*` - List manipulation

### Package Access Patterns

```nix
{ pkgs, ... }:
let
  # Extract specific packages
  inherit (pkgs) git vim firefox;

  # Access nested package sets
  python = pkgs.python3;
  pythonPackages = pkgs.python3Packages;
in
{
  home.packages = [
    git
    vim
    firefox
    python
    pythonPackages.requests
  ];
}
```

---

## 4.8 Common Package Patterns

### Meta Packages

Some "packages" are just collections of other packages:

```nix
{ pkgs, ... }:
{
  home.packages = [
    pkgs.texlive.combined.scheme-full  # Complete TeX Live
  ];
}
```

### Packages with Plugins

Editors like Neovim and Emacs have special support for plugins:

```nix
{ pkgs, ... }:
{
  programs.neovim = {
    enable = true;
    plugins = with pkgs.vimPlugins; [
      nvim-treesitter
      telescope-nvim
      catppuccin-nvim
    ];
  };
}
```

### Wrapped Packages

Some packages are "wrapped" to set environment variables or paths:

```nix
{ pkgs, ... }:
let
  myPython = pkgs.python3.withPackages (ps: [
    ps.requests
    ps.numpy
    ps.pandas
  ]);
in
{
  home.packages = [ myPython ];
}
```

This creates a Python with specific packages pre-installed.

---

## 4.9 Package Versioning and Pinning

### Version in Flakes

Your `flake.lock` pins the exact nixpkgs commit:

```bash
# See current nixpkgs version
nix flake metadata

# Update to latest
nix flake update nixpkgs

# Pin to specific commit
# In flake.nix:
nixpkgs.url = "github:NixOS/nixpkgs/abc123def456...";
```

### Multiple Nixpkgs Versions

Sometimes you need packages from different nixpkgs versions:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    nixpkgs-stable.url = "github:NixOS/nixpkgs/nixos-24.11";
  };

  outputs = { nixpkgs, nixpkgs-stable, ... }:
  let
    pkgs = nixpkgs.legacyPackages.x86_64-linux;
    pkgs-stable = nixpkgs-stable.legacyPackages.x86_64-linux;
  in {
    # Use packages from different versions
    packages.x86_64-linux.default = pkgs.mkShell {
      buildInputs = [
        pkgs.nodejs      # Latest from unstable
        pkgs-stable.ruby # Stable Ruby
      ];
    };
  };
}
```

---

## 4.10 Summary

Nixpkgs is the foundation of practical Nix usage:

1. **It is massive**: 100,000+ packages, actively maintained
2. **Multiple branches** provide different stability levels
3. **search.nixos.org** is the best way to find packages
4. **Packages are derivations** that describe how to build software
5. **Use `home.packages`** for simple installs, **`programs.*`** for configuration
6. **Overlays** let you customize and extend Nixpkgs
7. **The pkgs argument** gives you access to everything
8. **Flake locks** ensure reproducible package versions

---

## 4.11 Exercises

1. Search for your favorite editor on search.nixos.org and note its attribute path
2. Use `nix shell` to temporarily install a package you have never used
3. Add three new packages to your Home Manager configuration
4. Explore `pkgs.python3Packages` in `nix repl` using tab completion
5. Find a package's source code on GitHub by clicking through search.nixos.org

---

## 4.12 Additional Resources

- **Package Search**: [search.nixos.org/packages](https://search.nixos.org/packages)
- **Nixpkgs Manual**: [nixos.org/manual/nixpkgs/stable](https://nixos.org/manual/nixpkgs/stable)
- **Nixpkgs GitHub**: [github.com/NixOS/nixpkgs](https://github.com/NixOS/nixpkgs)
- **Repology**: [repology.org/repositories/statistics](https://repology.org/repositories/statistics) - Package count comparisons
