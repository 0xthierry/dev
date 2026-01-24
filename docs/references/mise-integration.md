# Mise Integration with Nix Home Manager

## Overview

Mise (formerly rtx) handles per-project tool version management. Use Nix/Home Manager to install mise itself, while mise manages development runtime versions.

## Home Manager Configuration

```nix
{ config, pkgs, ... }:

{
  programs.mise = {
    enable = true;
    enableZshIntegration = true;
    enableBashIntegration = true;

    globalConfig = {
      tools = {
        node = "lts";
        python = "3.12";
        go = "latest";
        bun = "latest";
        rust = "latest";
        zig = "latest";
        "aws-cli" = { version = "latest"; symlink_bins = true; };
      };
      settings = {
        experimental = false;
        verbose = false;
        not_found_auto_install = true;
        trusted_config_paths = ["~/Work"];
        env_file = ".env";
      };
    };
  };
}
```

## Global Config File

Location: `~/.config/mise/config.toml`

```toml
[tools]
node = "lts"
python = ["3.13", "3.12"]  # Multiple versions
go = "1.22"
bun = "latest"
rust = "1.83"
zig = "0.13"
aws-cli = { version = "latest", symlink_bins = true }

[settings]
experimental = false
verbose = false
jobs = 4
not_found_auto_install = true
env_file = ".env"
trusted_config_paths = ["~/Work", "~/projects"]

[settings.python]
uv_venv_auto = true
```

## When to Use Nix vs Mise

| Use Case | Tool | Rationale |
|----------|------|-----------|
| System packages (git, curl, jq) | Nix | Reproducible, declarative |
| CLI tools (ripgrep, fd, bat) | Nix | System-wide, version-locked |
| Development runtimes (node, python) | Mise | Per-project versions, fast switching |
| Project-specific tool versions | Mise | Auto-switching on cd |
| Team/shared tooling | Mise | Works without Nix knowledge |

## Trust System

Mise requires explicit trust for config files with potentially dangerous features:

```bash
# Trust a specific config file
mise trust ~/some_dir/mise.toml

# Trust the mise.toml in current or parent directory
mise trust

# Show trust status
mise trust --show
```

Auto-trust via settings:
```toml
[settings]
trusted_config_paths = [
  "~/Work",
  "~/projects",
]
```

## Install Workflow

```bash
# Install tools defined in mise.toml
mise install

# Install specific tool
mise install node@20

# Install and set as active globally
mise use -g node@20

# Install and set for current project
mise use node@20
```

## Project Setup

```bash
cd new-project
mise trust              # Trust the project's mise.toml
mise install            # Install all defined tools
```

## CI/CD (GitHub Actions)

```yaml
- name: Setup mise
  uses: jdx/mise-action@v3
  with:
    install: true
    cache: true
```

## Configuration Hierarchy

```
/etc/mise/config.toml           # System-wide (highest precedence)
~/.config/mise/config.toml      # Global user config
~/work/mise.toml                # Work-wide settings
~/work/myproject/mise.toml      # Project config
~/work/myproject/mise.local.toml # Local overrides (lowest precedence)
```

## Resources

- [Mise Documentation](https://mise.jdx.dev/)
- [Mise Configuration](https://mise.jdx.dev/configuration.html)
- [Mise Registry](https://mise.jdx.dev/registry.html)
