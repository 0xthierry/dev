# Chapter 4: Nixpkgs - The Package Collection

Welcome to Chapter 4! In this chapter, you will learn about Nixpkgs, the heart of the Nix ecosystem. Understanding Nixpkgs is essential because it provides the packages, modules, and library functions you will use in nearly every Nix project.

---

## Learning Objectives

By the end of this chapter, you will be able to:

- Explain what Nixpkgs is and why it matters
- Choose the appropriate channel/branch for your needs
- Search for and discover packages
- Understand the basic structure of Nix packages
- Use packages in different contexts (temporary shells, configurations, Home Manager)
- Understand overlays and when you might need them
- Work with the `pkgs` argument in modules

---

## 4.1 What is Nixpkgs?

**Nixpkgs** (Nix Packages) is a massive collection of software packages and NixOS modules, all written in the Nix language. It is the largest software repository in existence, containing over **120,000 packages** as of late 2025.

### The Scale of Nixpkgs

To put this in perspective:

| Repository | Approximate Package Count |
|------------|---------------------------|
| Nixpkgs | ~120,000+ |
| AUR (Arch) | ~90,000 |
| Debian | ~60,000 |
| Fedora | ~35,000 |

Not only is Nixpkgs the largest, it is also consistently ranked as one of the most up-to-date repositories. According to Repology (a cross-repository package tracking service), Nixpkgs has the highest percentage of packages at their latest upstream versions compared to any other major distribution.

### Community Maintained

Nixpkgs is maintained by the community with official backing from the NixOS Foundation. As of the NixOS 25.11 release:

- **2,742 contributors** participated
- **59,430 commits** were made since the previous release
- **4,400+ maintainers** are responsible for individual packages

Anyone can contribute packages or improvements through pull requests on GitHub.

### Monorepo Structure

Nixpkgs is a **monorepo** - a single Git repository containing everything:

```
nixpkgs/
├── pkgs/           # Package definitions (~95% of the repo)
│   ├── applications/
│   ├── development/
│   ├── tools/
│   └── ...
├── nixos/          # NixOS modules and configuration options
│   ├── modules/
│   └── tests/
├── lib/            # Utility functions (pkgs.lib)
├── doc/            # Documentation
└── maintainers/    # Maintainer information
```

This structure allows:
- Packages to easily reference each other
- Atomic updates where everything is tested together
- Consistent tooling across the entire collection

### The Repository

Nixpkgs is hosted on GitHub at:

```
https://github.com/NixOS/nixpkgs
```

With over 930,000 commits, 23,000+ stars, and 17,000+ forks, it is one of the most active open-source projects in the world.

---

## 4.2 Nixpkgs Branches and Channels

Understanding the different branches and channels is crucial for managing your system effectively. The terms "branch" and "channel" are related but slightly different:

- **Branch**: A Git branch in the nixpkgs repository
- **Channel**: A tested, verified snapshot of a branch, distributed via channels.nixos.org

### The Main Channels

#### nixos-unstable (Rolling Release for NixOS)

```
URL: https://channels.nixos.org/nixos-unstable
Branch: nixos-unstable
```

- Rolling release following the `master` branch
- Packages must pass **build tests AND integration tests** (VM tests)
- Tests include X server, desktop environments, bootloaders, and installation procedures
- Updated every few days after tests pass on Hydra (the Nix CI system)

**Best for**: NixOS users who want the latest packages while maintaining system stability.

#### nixpkgs-unstable (Rolling Release for Non-NixOS)

```
URL: https://channels.nixos.org/nixpkgs-unstable
Branch: nixpkgs-unstable
```

- Rolling release following the `master` branch
- Only requires basic **build tests** to pass
- Updates more frequently than nixos-unstable

**Best for**: Users of Nix on macOS, other Linux distributions, or WSL who want the latest packages.

#### Stable Releases (nixos-25.11, nixos-25.05, etc.)

```
URL: https://channels.nixos.org/nixos-25.11
Branch: nixos-25.11
```

Stable releases are published twice per year:
- **May releases**: 25.05 (Warbler), 24.05 (Uakari), etc.
- **November releases**: 25.11 (Xantusia), 24.11 (Vicuna), etc.

Each stable release:
- Receives **security updates and critical bug fixes** for 7 months
- Does **not** receive new package versions (only patches)
- Provides **API stability** - your configuration keeps working

**Current Release Timeline (as of January 2026)**:
- **nixos-25.11** "Xantusia" - Current stable (released November 30, 2025)
- **nixos-25.05** "Warbler" - End-of-life December 31, 2025
- **nixos-26.05** "Yarara" - Upcoming (May 2026)

#### Small Channels

For each channel, there is also a `-small` variant:

```
nixos-unstable-small
nixos-25.11-small
```

These update faster because they only test a smaller set of essential packages. They are intended for servers where quick security updates are more important than testing all desktop applications.

### When to Use Which Channel

| Use Case | Recommended Channel |
|----------|---------------------|
| NixOS desktop, want stability | nixos-25.11 (stable) |
| NixOS desktop, want latest packages | nixos-unstable |
| NixOS server, critical security | nixos-25.11-small |
| macOS or non-NixOS Linux | nixpkgs-unstable |
| Production systems | stable release |
| Learning and experimenting | nixos-unstable |

### Setting Your Channel

**Traditional (imperative) method:**

```bash
# List current channels
nix-channel --list

# Add a channel
sudo nix-channel --add https://channels.nixos.org/nixos-25.11 nixos

# Update channels
sudo nix-channel --update
```

**With Flakes (declarative, recommended):**

```nix
# flake.nix
{
  inputs = {
    # Use stable
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    
    # Or use unstable
    # nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  };
  
  outputs = { nixpkgs, ... }: {
    # Your configuration
  };
}
```

The flakes approach is preferred because:
- Versions are pinned in `flake.lock`
- Updates are explicit (`nix flake update`)
- Reproducible across machines

---

## 4.3 Finding Packages

Before you can use a package, you need to know its **attribute name** in Nixpkgs. There are several ways to search.

### Method 1: search.nixos.org (Recommended)

The official web interface at **https://search.nixos.org** is the easiest way to find packages:

1. Go to https://search.nixos.org/packages
2. Select your channel (e.g., "25.11" or "unstable")
3. Enter your search term
4. Browse results with descriptions, versions, and platforms

**Example search results for "ripgrep":**

| Attribute | Version | Description |
|-----------|---------|-------------|
| ripgrep | 14.1.0 | Fast grep alternative |
| ripgrep-all | 0.10.6 | ripgrep with PDF, DOCX support |

The **attribute name** (like `ripgrep`) is what you use in your Nix expressions.

**Pro tip**: The URL updates with your search, so you can bookmark or share specific searches.

### Method 2: nix search Command

Search from the command line:

```bash
# Search nixpkgs for a term
nix search nixpkgs ripgrep

# Output:
# * legacyPackages.x86_64-linux.ripgrep (14.1.0)
#   A fast grep alternative
# * legacyPackages.x86_64-linux.ripgrep-all (0.10.6)
#   ripgrep with additional file type support
```

**Useful search options:**

```bash
# Search with regex
nix search nixpkgs "^python3[0-9]+$"

# Search specific flake input
nix search nixpkgs#ripgrep

# Limit results
nix search nixpkgs vim --json | jq '.[:5]'
```

**Note**: The first search may take time as Nix downloads and caches the package index.

### Method 3: nix-env (Legacy)

The traditional command still works:

```bash
# Search for packages (can be slow)
nix-env -qaP '.*ripgrep.*'

# Output:
# nixos.ripgrep        ripgrep-14.1.0
# nixos.ripgrep-all    ripgrep-all-0.10.6
```

### Method 4: Browse GitHub

For the most current packages (even those not yet in any channel), browse the nixpkgs repository:

```
https://github.com/NixOS/nixpkgs/tree/master/pkgs
```

Use GitHub's search with `path:pkgs` to search within the package definitions.

### Method 5: REPL Exploration

For interactive exploration:

```bash
nix repl
```

```nix
nix-repl> :lf nixpkgs
Added 5 variables.

nix-repl> pkgs.ripgrep
«derivation /nix/store/...-ripgrep-14.1.0.drv»

nix-repl> pkgs.ripgrep.version
"14.1.0"

nix-repl> pkgs.ripgrep.meta.description
"A fast grep alternative"

# Tab completion works!
nix-repl> pkgs.python3<TAB>
pkgs.python3      pkgs.python310    pkgs.python311    pkgs.python312
```

---

## 4.4 Package Structure Basics

Understanding how packages work in Nix helps you troubleshoot issues and eventually create your own packages.

### What is a Derivation?

A **derivation** is a specification for building something. It is the fundamental building block in Nix. When you see a package like `pkgs.hello`, it is actually a derivation.

Think of a derivation as a recipe that specifies:
- **What** to build (source code)
- **How** to build it (build commands)
- **What dependencies** are needed (build inputs)
- **Where** the output goes (Nix store path)

**Simple derivation example:**

```nix
{ stdenv, fetchurl }:

stdenv.mkDerivation {
  pname = "hello";
  version = "2.12.1";
  
  src = fetchurl {
    url = "https://ftp.gnu.org/gnu/hello/hello-2.12.1.tar.gz";
    sha256 = "sha256-jZkUKv2SV28wsM18tCqNxoCZmLxdYH2Idh9RLibH2yA=";
  };
  
  # Build phases: unpack -> configure -> build -> install
  # mkDerivation handles these automatically for standard ./configure && make
}
```

When Nix evaluates this, it produces a `.drv` file (the derivation) that describes exactly how to build the package. The actual build happens in an isolated sandbox.

### Build Inputs vs Runtime Inputs

Nix distinguishes between different types of dependencies:

**Build Inputs (`buildInputs`)**: Required at build time
- Compilers, build tools
- Header files for compilation
- May not be needed at runtime

**Native Build Inputs (`nativeBuildInputs`)**: Build tools that run on the build machine
- Important for cross-compilation
- Examples: cmake, pkg-config, makeWrapper

**Propagated Build Inputs (`propagatedBuildInputs`)**: Dependencies that consumers also need
- Libraries that appear in public APIs
- Headers that downstream packages include

**Example showing the difference:**

```nix
{ stdenv, cmake, openssl, zlib }:

stdenv.mkDerivation {
  pname = "my-app";
  version = "1.0.0";
  
  # cmake is only needed to build, not to run
  nativeBuildInputs = [ cmake ];
  
  # openssl and zlib are linked and needed at runtime
  buildInputs = [ openssl zlib ];
}
```

### How Packages Reference Each Other

Nixpkgs uses a pattern called **callPackage** to wire dependencies together:

```nix
# In pkgs/applications/misc/hello/default.nix
{ stdenv, fetchurl }:  # Function that takes dependencies

stdenv.mkDerivation {
  # ... package definition
}
```

```nix
# In pkgs/top-level/all-packages.nix
{
  hello = callPackage ../applications/misc/hello { };
}
```

The `callPackage` function:
1. Looks at the function's arguments (`stdenv`, `fetchurl`)
2. Automatically passes matching packages from Nixpkgs
3. Allows overriding specific dependencies: `callPackage ./hello.nix { stdenv = stdenv32; }`

This pattern enables the entire package collection to be interconnected while remaining flexible.

---

## 4.5 Using Packages

Now that you can find packages, let's use them! There are several contexts for using packages.

### Temporary Shell: nix-shell -p (Legacy)

For quick, temporary access to a package:

```bash
# Enter a shell with ripgrep available
nix-shell -p ripgrep

# Run a single command
nix-shell -p ripgrep --run "rg --version"

# Multiple packages
nix-shell -p ripgrep fd bat

# Specific nixpkgs version
nix-shell -p ripgrep -I nixpkgs=https://github.com/NixOS/nixpkgs/archive/nixos-25.11.tar.gz
```

The package is downloaded/built if needed, but **not installed permanently**. When you exit the shell, it is as if the package was never there (though it remains cached in the Nix store).

### Temporary Shell: nix shell (Flakes)

The modern flakes equivalent:

```bash
# Enter a shell with ripgrep
nix shell nixpkgs#ripgrep

# Run a single command
nix shell nixpkgs#ripgrep --command rg --version

# Multiple packages
nix shell nixpkgs#ripgrep nixpkgs#fd nixpkgs#bat

# From a specific branch
nix shell github:nixos/nixpkgs/nixos-25.11#ripgrep
```

### Run Without Shell: nix run

Execute a package's default program directly:

```bash
# Run ripgrep's main binary
nix run nixpkgs#ripgrep -- --version

# Run cowsay
nix run nixpkgs#cowsay -- "Hello Nix!"
```

### Home Manager: home.packages

For permanent installation in your user environment with Home Manager:

```nix
# home.nix
{ pkgs, ... }:

{
  home.packages = with pkgs; [
    # CLI tools
    ripgrep
    fd
    bat
    jq
    
    # Development
    git
    nodejs
    python3
    
    # Applications
    firefox
    vscode
  ];
}
```

After applying (`home-manager switch`), these packages are available in your `$PATH`.

### Home Manager: programs.* Modules

Many packages have dedicated modules that provide richer configuration:

```nix
# home.nix
{ pkgs, ... }:

{
  # Instead of: home.packages = [ pkgs.git ];
  # Use the module:
  programs.git = {
    enable = true;
    userName = "Your Name";
    userEmail = "you@example.com";
    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
    };
    delta.enable = true;  # Better diff viewer
  };
  
  # Another example: neovim with plugins
  programs.neovim = {
    enable = true;
    viAlias = true;
    vimAlias = true;
    plugins = with pkgs.vimPlugins; [
      nvim-treesitter
      telescope-nvim
      lualine-nvim
    ];
  };
  
  # Shell with plugins and configuration
  programs.zsh = {
    enable = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    oh-my-zsh = {
      enable = true;
      plugins = [ "git" "docker" ];
      theme = "robbyrussell";
    };
  };
}
```

**When to use which:**

| Approach | Use When |
|----------|----------|
| `home.packages` | Simple installation, no configuration needed |
| `programs.*` | Module exists and you want integrated configuration |

Check available modules at https://nix-community.github.io/home-manager/options.html

### NixOS: environment.systemPackages

For system-wide installation on NixOS:

```nix
# configuration.nix
{ pkgs, ... }:

{
  environment.systemPackages = with pkgs; [
    vim
    wget
    curl
    htop
  ];
}
```

### NixOS: services.* and programs.*

NixOS has modules for system services:

```nix
# configuration.nix
{ pkgs, ... }:

{
  # Enable Docker
  virtualisation.docker.enable = true;
  
  # Enable PostgreSQL with configuration
  services.postgresql = {
    enable = true;
    package = pkgs.postgresql_16;
    authentication = ''
      local all all trust
    '';
  };
  
  # Enable SSH server
  services.openssh = {
    enable = true;
    settings.PasswordAuthentication = false;
  };
}
```

---

## 4.6 Package Overlays (Brief Introduction)

Sometimes you need to modify packages: change a version, add patches, or alter build options. Overlays provide a way to do this.

### What are Overlays?

An **overlay** is a function that modifies Nixpkgs. It takes two arguments:
- `final` (or `self`): The final, fully composed package set
- `prev` (or `super`): The previous/original package set

```nix
# Basic overlay structure
final: prev: {
  # Your modifications here
}
```

### Simple Overlay Example

Override a package version:

```nix
# overlays/custom.nix
final: prev: {
  # Replace htop with a specific version
  htop = prev.htop.overrideAttrs (old: {
    version = "3.2.0";
    src = prev.fetchFromGitHub {
      owner = "htop-dev";
      repo = "htop";
      rev = "3.2.0";
      sha256 = "sha256-...";
    };
  });
}
```

### Applying Overlays

**In a flake:**

```nix
{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  
  outputs = { nixpkgs, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        {
          nixpkgs.overlays = [
            (final: prev: {
              # Your overlay modifications
            })
          ];
        }
      ];
    };
  };
}
```

**In Home Manager:**

```nix
{ config, pkgs, ... }:

{
  nixpkgs.overlays = [
    (final: prev: {
      # Modifications
    })
  ];
}
```

### When You Might Need Overlays

- **Version pinning**: Need a specific older or newer version
- **Patching**: Apply bug fixes or custom patches
- **Configuration changes**: Different compile-time options
- **Adding packages**: Bring in packages not yet in Nixpkgs
- **Wrapping**: Modify how a program is launched (environment variables, etc.)

### A Note of Caution

Overlays are powerful but should be used sparingly:
- They can cause rebuilds of dependent packages
- Maintaining custom patches is work
- Consider contributing fixes upstream instead

For beginners, you likely will not need overlays right away. Focus on learning the standard patterns first.

---

## 4.7 Understanding pkgs

When you write Nix modules (for NixOS or Home Manager), you will frequently see `pkgs` as an argument. Understanding this is key.

### The pkgs Argument

In a module, `pkgs` gives you access to the entire Nixpkgs collection:

```nix
{ config, pkgs, lib, ... }:

{
  home.packages = [
    pkgs.ripgrep      # A package
    pkgs.python311    # Another package
    pkgs.python311Packages.requests  # A Python package
  ];
}
```

### pkgs.lib - Library Functions

`pkgs.lib` (or just `lib` from the module arguments) provides utility functions:

```nix
{ config, pkgs, lib, ... }:

{
  # String manipulation
  home.sessionVariables.GREETING = lib.toUpper "hello";
  
  # Conditionals
  home.packages = lib.optionals config.programs.git.enable [
    pkgs.git-lfs
    pkgs.gitAndTools.gh
  ];
  
  # List operations
  environment.systemPackages = lib.flatten [
    [ pkgs.vim pkgs.wget ]
    (lib.optional true pkgs.curl)
  ];
}
```

Common `lib` functions:

| Function | Purpose |
|----------|---------|
| `lib.mkIf` | Conditional configuration |
| `lib.mkDefault` | Set default value (can be overridden) |
| `lib.mkForce` | Force a value (overrides others) |
| `lib.optional` | Include if condition is true |
| `lib.optionals` | Include list if condition is true |
| `lib.flatten` | Flatten nested lists |
| `lib.concatStrings` | Join strings |
| `lib.mapAttrs` | Map over attribute set |

### pkgs.<package> Access Pattern

Packages are organized hierarchically:

```nix
pkgs.ripgrep                    # Top-level package
pkgs.python311                  # Python interpreter
pkgs.python311Packages.numpy    # Python packages
pkgs.nodePackages.typescript    # Node.js packages
pkgs.haskellPackages.pandoc     # Haskell packages
pkgs.vimPlugins.telescope-nvim  # Vim/Neovim plugins
pkgs.gnome.nautilus             # GNOME packages
pkgs.kdePackages.kate           # KDE Plasma 6 packages
```

### with pkgs Pattern

To avoid repeating `pkgs.` everywhere:

```nix
{ pkgs, ... }:

{
  home.packages = with pkgs; [
    ripgrep
    fd
    bat
    python311
    nodejs
  ];
}
```

The `with pkgs;` brings all package names into scope. Use judiciously - it can make code harder to read if overused.

---

## 4.8 Common Package Patterns

Nixpkgs uses several patterns you will encounter when working with packages.

### Meta Packages

Some "packages" are actually collections:

```nix
{ pkgs, ... }:

{
  home.packages = with pkgs; [
    # Installs multiple related tools
    gitAndTools.gitFull  # git with additional tools
    texlive.combined.scheme-full  # Complete TeX Live
  ];
}
```

### Packages with Plugins

Some applications support plugins defined in Nixpkgs:

**Neovim:**
```nix
{ pkgs, ... }:

{
  programs.neovim = {
    enable = true;
    plugins = with pkgs.vimPlugins; [
      nvim-treesitter
      telescope-nvim
      { 
        plugin = nvim-lspconfig;
        config = "lua require('lspconfig').rust_analyzer.setup{}";
      }
    ];
  };
}
```

**Emacs:**
```nix
{ pkgs, ... }:

{
  programs.emacs = {
    enable = true;
    package = pkgs.emacs29;
    extraPackages = epkgs: with epkgs; [
      magit
      company
      use-package
      evil
    ];
  };
}
```

**Firefox:**
```nix
{ pkgs, ... }:

{
  programs.firefox = {
    enable = true;
    profiles.default = {
      extensions = with pkgs.nur.repos.rycee.firefox-addons; [
        ublock-origin
        bitwarden
      ];
    };
  };
}
```

### Wrapped Packages

Sometimes you need to modify how a program runs. Nixpkgs provides wrapper utilities:

```nix
{ pkgs, ... }:

let
  myScript = pkgs.writeShellScriptBin "my-app" ''
    export MY_CONFIG="/etc/my-app"
    exec ${pkgs.someApp}/bin/someApp "$@"
  '';
  
  # Or use wrapProgram in a derivation
  wrappedApp = pkgs.symlinkJoin {
    name = "wrapped-app";
    paths = [ pkgs.someApp ];
    buildInputs = [ pkgs.makeWrapper ];
    postBuild = ''
      wrapProgram $out/bin/someApp \
        --set MY_VAR "value" \
        --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.git ]}
    '';
  };
in
{
  home.packages = [ myScript wrappedApp ];
}
```

### Packages with Features/Options

Some packages support compile-time options:

```nix
{ pkgs, ... }:

{
  home.packages = [
    # Default ffmpeg
    pkgs.ffmpeg
    
    # ffmpeg with all features
    pkgs.ffmpeg-full
    
    # Custom build (using override)
    (pkgs.ffmpeg.override {
      withVpx = true;
      withWebp = true;
    })
  ];
}
```

---

## 4.9 Package Versioning and Pinning

### Understanding Package Versions

Every package in Nixpkgs has a version:

```bash
nix eval nixpkgs#ripgrep.version
# "14.1.0"
```

The version in your channel depends on:
1. Which channel you are using
2. When the channel was last updated
3. The channel's update policy (stable vs unstable)

### Pinning with Flakes

Flakes provide built-in pinning via `flake.lock`:

```nix
# flake.nix
{
  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
  
  outputs = { nixpkgs, ... }: {
    # Your configuration
  };
}
```

Running `nix flake lock` or `nix flake update` creates/updates `flake.lock`:

```json
{
  "nodes": {
    "nixpkgs": {
      "locked": {
        "lastModified": 1703801845,
        "narHash": "sha256-...",
        "owner": "NixOS",
        "repo": "nixpkgs",
        "rev": "a1b2c3d4...",
        "type": "github"
      }
    }
  }
}
```

This ensures everyone using the flake gets exactly the same package versions.

### Using Multiple Nixpkgs Versions

Sometimes you need a package from a different nixpkgs version:

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-25.11";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";
  };
  
  outputs = { self, nixpkgs, nixpkgs-unstable, ... }:
  let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages.${system};
    unstable = nixpkgs-unstable.legacyPackages.${system};
  in {
    homeConfigurations.myuser = home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [{
        home.packages = [
          pkgs.git           # Stable version
          unstable.neovim    # Latest from unstable
        ];
      }];
    };
  };
}
```

### Pinning to Specific Commits

For maximum reproducibility:

```nix
{
  inputs = {
    # Pin to exact commit
    nixpkgs.url = "github:nixos/nixpkgs/a1b2c3d4e5f6...";
    
    # Pin to specific tag
    nixpkgs.url = "github:nixos/nixpkgs?ref=25.11";
  };
}
```

---

## 4.10 Summary

In this chapter, you learned about Nixpkgs, the backbone of the Nix ecosystem:

**Key Takeaways:**

1. **Nixpkgs is massive**: 120,000+ packages, community maintained, monorepo structure

2. **Channels and branches**:
   - `nixos-unstable` / `nixpkgs-unstable` for latest packages
   - `nixos-XX.YY` for stable, supported releases
   - Flakes provide declarative, pinned dependencies

3. **Finding packages**:
   - https://search.nixos.org (easiest)
   - `nix search nixpkgs <term>`
   - REPL exploration

4. **Package concepts**:
   - Derivations are build recipes
   - Build inputs vs runtime inputs
   - `callPackage` wires dependencies

5. **Using packages**:
   - Temporary: `nix shell nixpkgs#package`
   - Home Manager: `home.packages` or `programs.*`
   - NixOS: `environment.systemPackages` or `services.*`

6. **Overlays** modify packages when needed (use sparingly)

7. **The `pkgs` argument** gives you access to everything in Nixpkgs

---

## 4.11 Exercises

### Exercise 1: Package Discovery
Use search.nixos.org to find:
- The attribute name for the "Visual Studio Code" editor
- All packages related to "kubernetes"
- The Python package for "requests"

### Exercise 2: Temporary Environments
Create temporary shells for:
1. A shell with Python 3.11 and pip
2. A shell with Node.js 20 and npm
3. A shell with both ripgrep and fd

### Exercise 3: REPL Exploration
Use `nix repl` to:
1. Find the version of `pkgs.git`
2. List all packages that start with "python3"
3. Find what `pkgs.firefox.meta.homepage` is

### Exercise 4: Home Manager Configuration
Add to your Home Manager configuration:
1. Three CLI tools using `home.packages`
2. Configure `programs.git` with your name and email
3. Enable `programs.bat` (a cat clone) with a custom theme

---

## 4.12 Additional Resources

- **Nixpkgs Manual**: https://nixos.org/manual/nixpkgs/stable/
- **Package Search**: https://search.nixos.org/packages
- **NixOS Options Search**: https://search.nixos.org/options
- **Home Manager Options**: https://nix-community.github.io/home-manager/options.html
- **Nixpkgs GitHub**: https://github.com/NixOS/nixpkgs
- **Repology (package tracking)**: https://repology.org/repository/nix_unstable
- **Channel Status**: https://status.nixos.org/

---

**Next Chapter**: In Chapter 5, we will dive deep into Home Manager, learning how to configure your entire user environment declaratively.
