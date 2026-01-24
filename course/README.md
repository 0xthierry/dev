# Nix & Home Manager Complete Course

A comprehensive 10-chapter course covering Nix, Nix Flakes, and Home Manager from zero knowledge to advanced configuration management.

## Course Overview

This course is designed to help you:
- Understand the Nix ecosystem from fundamentals
- Master the Nix language
- Use Nix Flakes for reproducible dependency management
- Configure your user environment with Home Manager
- Manage multiple machines with a single configuration
- Build reusable modules and extend your setup

## Prerequisites

- Basic command-line familiarity
- Any operating system (Linux, macOS, or WSL)
- No prior Nix knowledge required

## Course Structure

| Chapter | Title | Topics |
|---------|-------|--------|
| 1 | [Introduction to Nix](chapter-01-introduction.md) | What is Nix, the ecosystem, key concepts, history |
| 2 | [Nix Language Fundamentals](chapter-02-nix-language.md) | Syntax, types, functions, let bindings, imports |
| 3 | [Nix Flakes](chapter-03-flakes.md) | Modern dependency management, inputs, outputs, flake.lock |
| 4 | [Nixpkgs](chapter-04-nixpkgs.md) | Package collection, branches, finding and using packages |
| 5 | [Home Manager Basics](chapter-05-home-manager.md) | Installation, configuration, programs.* modules |
| 6 | [Module System Deep Dive](chapter-06-modules.md) | Module structure, options, types, creating modules |
| 7 | [Multi-System Configuration](chapter-07-multi-system.md) | Cross-platform, multiple machines, nix-darwin |
| 8 | [XDG & File Management](chapter-08-xdg-files.md) | Dotfiles, mkOutOfStoreSymlink, activation scripts |
| 9 | [Shell & Dev Environment](chapter-09-shell-dev-environment.md) | Zsh, Oh-My-Zsh, modern CLI tools, direnv, mise |
| 10 | [Extending Your Config](chapter-10-extending.md) | Debugging, overlays, organization, workflows |

## How to Use This Course

1. **Read sequentially** - Each chapter builds on previous concepts
2. **Practice with exercises** - Each chapter includes practical exercises
3. **Reference your project** - Use the `/home/thierry/dev` project as a real-world example
4. **Experiment** - Try the code examples in `nix repl`

## Project Context

This course was created based on a real Home Manager configuration project with:
- Multi-machine support (desktop, VM, macOS)
- Nix Flakes for dependency management
- Modular organization (common/, hosts/, configs/)
- Modern CLI tool setup (eza, bat, fzf, zoxide, etc.)
- Out-of-store symlinks for editable configs

## Quick Start

If you want to dive in immediately:

```bash
# Install Nix (Determinate Systems installer - recommended)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Try a package without installing
nix shell nixpkgs#cowsay --command cowsay "Hello Nix!"

# Clone your config (or start fresh)
cd ~/.config
git clone <your-config-repo> home-manager
cd home-manager

# Apply configuration
home-manager switch --flake .#$(hostname)
```

## Key Resources

### Official Documentation
- [Nix Manual](https://nix.dev/manual/nix/stable/)
- [Nixpkgs Manual](https://nixos.org/manual/nixpkgs/stable/)
- [Home Manager Manual](https://nix-community.github.io/home-manager/)
- [NixOS Manual](https://nixos.org/manual/nixos/stable/)

### Search Tools
- [Package Search](https://search.nixos.org/packages)
- [Option Search](https://search.nixos.org/options)
- [Home Manager Options](https://home-manager-options.extranix.com/)

### Community
- [NixOS Discourse](https://discourse.nixos.org/)
- [Matrix Chat](https://matrix.to/#/#nix:nixos.org)
- [Discord](https://discord.gg/nix-community)

### Learning
- [Zero to Nix](https://zero-to-nix.com/)
- [NixOS & Flakes Book](https://nixos-and-flakes.thiscute.world/)
- [Awesome Nix](https://github.com/nix-community/awesome-nix)

## Course Statistics

- **10 chapters**
- **~50,000 words**
- **Comprehensive code examples**
- **Exercises in each chapter**

## License

This course content is provided for educational purposes.

---

*Generated based on the Nix Home Manager project structure and best practices.*
