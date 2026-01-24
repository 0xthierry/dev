# Chapter 6: Home Manager Modules Deep Dive

## Introduction

You have Home Manager working and can install packages and configure programs. Now it is time to understand the engine behind it all: the Nix module system. This chapter takes you from module consumer to module creator, giving you the power to build your own abstractions and create reusable configurations.

The module system is not specific to Home Manager. It is a Nix library that powers NixOS, Home Manager, and nix-darwin. Understanding it once means you can apply that knowledge across all three systems.

---

## 6.1 What is a Nix Module?

### The Module System Architecture

The module system enables you to:

1. **Declare** one attribute set using many separate Nix expressions
2. **Impose type constraints** on values in that attribute set
3. **Define values** for the same attribute in different expressions and merge them automatically

These Nix expressions are called *modules* and must have a particular structure.

### Modules vs Plain Nix Files

A plain Nix file can contain any Nix expression:

```nix
# plain-file.nix
{
  name = "my-package";
  version = "1.0";
}
```

A module has a specific structure - it is a function that takes an attribute set and returns an attribute set:

```nix
# module.nix
{ config, pkgs, lib, ... }:
{
  # module content here
}
```

### The `{ config, pkgs, lib, ... }` Function Pattern

Every module is a function. The module system calls this function with a set of arguments:

```nix
{ config, pkgs, lib, ... }:
{
  # your module content
}
```

The ellipsis (`...`) is critical - without it, your function would fail when it receives additional arguments.

---

## 6.2 Module Arguments

When the module system evaluates your module, it passes several arguments.

### `config`: The Full Resolved Configuration

The `config` argument contains the result of all modules after their values have been merged:

```nix
{ config, lib, pkgs, ... }:
{
  programs.git.enable = true;
  programs.git.userName = config.home.username; # Reference another option
}
```

### `pkgs`: The Package Set

The `pkgs` argument provides access to Nixpkgs:

```nix
{ pkgs, ... }:
{
  home.packages = [
    pkgs.ripgrep
    pkgs.fd
    pkgs.bat
  ];
}
```

### `lib`: Library Functions

The `lib` argument contains utility functions:

```nix
{ lib, config, ... }:
{
  config = lib.mkIf config.programs.myTool.enable {
    home.packages = [ ... ];
  };
}
```

Key functions:
- `lib.mkOption`, `lib.mkEnableOption` - Create option declarations
- `lib.mkIf`, `lib.mkMerge`, `lib.mkForce`, `lib.mkDefault` - Control config merging
- `lib.types.*` - Option type definitions

### The Ellipsis: `...`

The `...` captures any additional arguments:

```nix
# WRONG - will fail if extra args are passed
{ config, lib }: { ... }

# CORRECT - accepts any additional arguments
{ config, lib, ... }: { ... }
```

---

## 6.3 Module Structure

A complete module has up to three main sections:

```nix
{ config, lib, pkgs, ... }:
{
  imports = [
    # paths to other modules
  ];

  options = {
    # option declarations
  };

  config = {
    # option definitions (values)
  };
}
```

### `imports = [ ]`

The imports list specifies other modules to include:

```nix
{ ... }:
{
  imports = [
    ./programs/git.nix
    ./programs/neovim.nix
  ];
}
```

### `options = { }` (Declaring New Options)

The options section declares what configuration is possible:

```nix
{ lib, ... }:
{
  options = {
    programs.myTool.enable = lib.mkEnableOption "my tool";

    programs.myTool.package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.myTool;
      description = "The package to install";
    };
  };
}
```

### `config = { }` (Setting Option Values)

The config section sets values for declared options:

```nix
{ config, lib, pkgs, ... }:
let
  cfg = config.programs.myTool;
in
{
  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];
  };
}
```

### Shorthand: Setting Values Directly

When your module only defines values, you can omit the `config` wrapper:

```nix
# Full form
{ pkgs, ... }:
{
  config = {
    home.packages = [ pkgs.git ];
  };
}

# Shorthand (equivalent)
{ pkgs, ... }:
{
  home.packages = [ pkgs.git ];
}
```

---

## 6.4 The Imports Mechanism

### How Imports Work

When you write:

```nix
{
  imports = [ ./foo.nix ./bar.nix ];
}
```

The module system:
1. Loads each file
2. Evaluates each module function
3. Collects all options declarations
4. Collects all config definitions
5. Merges everything according to option types

### Import Order and Merging

Import order does not determine priority. Priority is controlled by functions like `mkDefault` and `mkForce`.

```nix
# File A
{ ... }: { home.packages = [ pkgs.git ]; }

# File B
{ ... }: { home.packages = [ pkgs.vim ]; }

# Result: home.packages contains BOTH git and vim (lists merge)
```

---

## 6.5 Option Types (`lib.mkOption`)

### Basic Types

```nix
lib.types.str      # String
lib.types.int      # Integer
lib.types.bool     # Boolean
lib.types.path     # Filesystem path
lib.types.package  # A derivation
lib.types.attrs    # Attribute set
```

### Composed Types

```nix
lib.types.listOf t      # List where elements have type t
lib.types.attrsOf t     # Attrset where values have type t
lib.types.nullOr t      # Either null or type t
lib.types.either t1 t2  # Either type t1 or type t2
lib.types.enum [...]    # One of the listed values
```

### Example

```nix
{
  options.myModule = {
    ports = lib.mkOption {
      type = lib.types.listOf lib.types.port;
      default = [ 8080 8443 ];
      description = "List of ports to open";
    };

    level = lib.mkOption {
      type = lib.types.enum [ "debug" "info" "warn" "error" ];
      default = "info";
    };
  };
}
```

### `types.submodule`: Nested Option Sets

```nix
{ lib, ... }:
{
  options.myModule.servers = lib.mkOption {
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        host = lib.mkOption { type = lib.types.str; };
        port = lib.mkOption { type = lib.types.port; default = 22; };
      };
    });
    default = { };
  };
}
```

---

## 6.6 Defining Custom Options

### `lib.mkOption`

```nix
lib.mkOption {
  type = lib.types.str;           # Required: the option type
  default = "value";              # Optional: default value
  example = "example value";      # Optional: example for docs
  description = "What this does"; # Optional but recommended
}
```

### `lib.mkEnableOption`

A shortcut for the common "enable" pattern:

```nix
# These are equivalent:
options.foo.enable = lib.mkEnableOption "foo service";

options.foo.enable = lib.mkOption {
  type = lib.types.bool;
  default = false;
  description = "Whether to enable foo service.";
};
```

---

## 6.7 Config Merging

### `lib.mkIf`: Conditional Configuration

```nix
{ config, lib, pkgs, ... }:
let
  cfg = config.programs.myTool;
in
{
  config = lib.mkIf cfg.enable {
    home.packages = [ pkgs.myTool ];
  };
}
```

### `lib.mkMerge`: Combining Multiple Config Blocks

```nix
{
  config = lib.mkMerge [
    { home.packages = [ pkgs.base-tools ]; }

    (lib.mkIf cfg.enable {
      home.packages = [ pkgs.myTool ];
    })
  ];
}
```

### `lib.mkForce`: Override Priority

```nix
{
  programs.git.userName = lib.mkForce "Overridden Name";
}
```

### `lib.mkDefault`: Low Priority Default

```nix
{
  programs.git.userName = lib.mkDefault "Suggested Name";
}
```

Priority levels (lower = higher priority):
- `mkForce`: priority 50
- Normal: priority 100
- `mkDefault`: priority 1000

---

## 6.8 `extraSpecialArgs`

### Passing Custom Arguments to All Modules

```nix
# flake.nix
{
  homeConfigurations.myuser = home-manager.lib.homeManagerConfiguration {
    pkgs = nixpkgs.legacyPackages.x86_64-linux;

    extraSpecialArgs = {
      username = "alice";
      hostname = "workstation";
    };

    modules = [ ./home.nix ];
  };
}
```

Now every module receives these arguments:

```nix
# home.nix
{ username, hostname, config, pkgs, ... }:
{
  home.username = username;
  home.homeDirectory = "/home/${username}";
}
```

---

## 6.9 Creating Reusable Modules

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

    settings = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
    };
  };

  config = lib.mkIf cfg.enable {
    home.packages = [ cfg.package ];

    xdg.configFile."mytool/config".text = ''
      ${lib.concatStringsSep "\n"
        (lib.mapAttrsToList (k: v: "${k} = ${v}") cfg.settings)}
    '';
  };
}
```

Usage:

```nix
{
  imports = [ ./modules/programs/mytool.nix ];

  programs.myTool = {
    enable = true;
    settings = {
      theme = "nord";
    };
  };
}
```

---

## 6.10 Debugging Modules

### `builtins.trace`

```nix
{ config, lib, ... }:
{
  config = lib.mkIf cfg.enable (
    builtins.trace "myModule is enabled" {
      # actual config here
    }
  );
}
```

### `nix repl`

```bash
$ nix repl
nix-repl> :lf .
nix-repl> homeConfigurations.myuser.config.programs.git
```

### Common Errors

**"infinite recursion encountered"**
```nix
# BAD
config = if config.foo then { ... } else { };

# GOOD
config = lib.mkIf config.foo { ... };
```

**"attribute not found"**
- Check spelling
- Ensure the option is declared
- Verify imports

---

## Summary

The module system is the heart of Home Manager:

1. **Modules are functions** that take `{ config, lib, pkgs, ... }` and return a set
2. **Three sections**: `imports`, `options`, `config`
3. **Options declare** what can be configured; **config defines** values
4. **Types** provide validation and determine merge behavior
5. **`lib.mkIf`** and **`lib.mkMerge`** control conditional configuration
6. **`lib.mkForce`** and **`lib.mkDefault`** control priority
7. **`extraSpecialArgs`** passes custom arguments to all modules
8. **The enable pattern** is the standard way to write reusable modules

---

## Exercises

1. Create a module with an `enable` option and a `languages` list option
2. Write a module with a submodule option for project directories
3. Extract an existing configuration into a proper module
4. Use `nix repl` to explore your configuration

---

## Further Reading

- [nix.dev Module System Tutorial](https://nix.dev/tutorials/module-system/)
- [Home Manager Manual - Writing Modules](https://nix-community.github.io/home-manager/)
- [NixOS Manual - Option Types](https://nixos.org/manual/nixos/stable/#sec-option-types)
