# Chapter 9: Shell & Development Environment Setup

## Introduction

Your shell is the nerve center of your development workflow. Home Manager transforms shell configuration from chaotic imperative scripting into declarative, reproducible infrastructure. This chapter covers everything from basic shell setup to advanced tool integration.

---

## 9.1 Shell Configuration with programs.zsh

### Basic Configuration

```nix
{ config, pkgs, ... }:

{
  programs.zsh = {
    enable = true;
    autocd = true;
    defaultKeymap = "emacs";  # or "viins"
    autosuggestion.enable = true;
    enableCompletion = true;
    syntaxHighlighting.enable = true;
  };
}
```

### History Configuration

```nix
{
  programs.zsh = {
    enable = true;

    history = {
      size = 50000;
      save = 50000;
      path = "${config.xdg.dataHome}/zsh/history";
      share = true;
      ignoreDups = true;
      expireDuplicatesFirst = true;
      ignoreSpace = true;
      extended = true;
    };
  };
}
```

### Custom Initialization

```nix
{
  programs.zsh = {
    enable = true;

    initExtra = ''
      bindkey '^[[A' history-substring-search-up
      bindkey '^[[B' history-substring-search-down
    '';

    envExtra = ''
      export EDITOR="nvim"
    '';
  };
}
```

---

## 9.2 Oh-My-Zsh Integration

```nix
{
  programs.zsh = {
    enable = true;

    oh-my-zsh = {
      enable = true;
      theme = "robbyrussell";
      plugins = [
        "git"
        "docker"
        "kubectl"
        "aws"
        "sudo"
        "z"
        "colored-man-pages"
      ];
    };
  };
}
```

### Custom Plugins

```nix
{ pkgs, ... }:

{
  programs.zsh = {
    enable = true;

    plugins = [
      {
        name = "zsh-autosuggestions";
        src = pkgs.fetchFromGitHub {
          owner = "zsh-users";
          repo = "zsh-autosuggestions";
          rev = "v0.7.0";
          sha256 = "sha256-KLUYpUu4DHRumQZ3w59m9aTW6TBKMCXl2UcKi4uMd7w=";
        };
      }
    ];
  };
}
```

---

## 9.3 Alternative Shells

### Bash Configuration

```nix
{
  programs.bash = {
    enable = true;
    historySize = 50000;
    historyControl = [ "erasedups" "ignorespace" ];

    shellOptions = [
      "histappend"
      "checkwinsize"
      "extglob"
      "globstar"
    ];

    initExtra = ''
      PS1='\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]\$ '
    '';
  };
}
```

### Fish Configuration

```nix
{
  programs.fish = {
    enable = true;

    interactiveShellInit = ''
      set -g fish_greeting
      fish_vi_key_bindings
    '';

    shellAbbrs = {
      gco = "git checkout";
      gst = "git status";
    };

    functions = {
      mkcd = "mkdir -p $argv[1] && cd $argv[1]";
    };
  };
}
```

---

## 9.4 Shell Aliases

### Shell-Agnostic Aliases

```nix
{
  home.shellAliases = {
    ".." = "cd ..";
    "..." = "cd ../..";
    rm = "rm -i";
    cp = "cp -i";
    mv = "mv -i";
    grep = "grep --color=auto";
  };
}
```

### Comprehensive Alias Set

```nix
{
  home.shellAliases = {
    # Modern CLI tools
    ls = "eza --icons";
    ll = "eza -la --icons --git";
    cat = "bat --paging=never";

    # Git shortcuts
    g = "git";
    gst = "git status -sb";
    gd = "git diff";
    gco = "git checkout";
    gp = "git push";
    gpl = "git pull --rebase";

    # Docker
    d = "docker";
    dc = "docker compose";
    dps = "docker ps";

    # Kubernetes
    k = "kubectl";
    kgp = "kubectl get pods";

    # Home Manager
    hms = "home-manager switch --flake .";
  };
}
```

---

## 9.5 Environment Variables

### Session Variables

```nix
{
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    PAGER = "less -R";
    MANPAGER = "sh -c 'col -bx | bat -l man -p'";
    LANG = "en_US.UTF-8";
  };
}
```

### Session Path

```nix
{
  home.sessionPath = [
    "$HOME/.local/bin"
    "$HOME/go/bin"
    "${config.xdg.dataHome}/cargo/bin"
  ];
}
```

---

## 9.6 Starship Prompt

```nix
{
  programs.starship = {
    enable = true;

    settings = {
      format = "$directory$git_branch$git_status$nix_shell$line_break$character";

      character = {
        success_symbol = "[❯](bold green)";
        error_symbol = "[❯](bold red)";
      };

      directory = {
        truncation_length = 5;
        style = "bold cyan";
      };

      git_branch = {
        symbol = " ";
        style = "bold purple";
      };

      nix_shell = {
        symbol = " ";
        style = "bold blue";
      };
    };
  };
}
```

---

## 9.7 Development Tools

### Git with Delta

```nix
{
  programs.git = {
    enable = true;
    userName = "Your Name";
    userEmail = "your@email.com";

    delta = {
      enable = true;
      options = {
        line-numbers = true;
        syntax-theme = "Catppuccin Mocha";
      };
    };

    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
    };

    aliases = {
      st = "status -sb";
      lg = "log --oneline --graph --decorate";
    };
  };

  programs.gh = {
    enable = true;
    settings.git_protocol = "ssh";
  };
}
```

### Neovim

```nix
{ pkgs, ... }:

{
  programs.neovim = {
    enable = true;
    defaultEditor = true;
    viAlias = true;
    vimAlias = true;

    plugins = with pkgs.vimPlugins; [
      nvim-lspconfig
      telescope-nvim
      nvim-treesitter.withAllGrammars
      catppuccin-nvim
    ];

    extraPackages = with pkgs; [
      lua-language-server
      nil
      nodePackages.typescript-language-server
    ];

    extraLuaConfig = ''
      vim.opt.number = true
      vim.opt.relativenumber = true
      vim.opt.expandtab = true
      vim.opt.shiftwidth = 2
    '';
  };
}
```

### tmux

```nix
{ pkgs, ... }:

{
  programs.tmux = {
    enable = true;
    terminal = "tmux-256color";
    historyLimit = 50000;
    baseIndex = 1;
    keyMode = "vi";
    mouse = true;
    prefix = "C-a";
    escapeTime = 0;

    plugins = with pkgs.tmuxPlugins; [
      sensible
      vim-tmux-navigator
      yank
    ];

    extraConfig = ''
      bind | split-window -h -c "#{pane_current_path}"
      bind - split-window -v -c "#{pane_current_path}"

      bind h select-pane -L
      bind j select-pane -D
      bind k select-pane -U
      bind l select-pane -R
    '';
  };
}
```

---

## 9.8 Runtime Version Managers with mise

```nix
{
  programs.mise = {
    enable = true;
    enableZshIntegration = true;

    globalConfig = {
      tools = {
        node = "lts";
        python = [ "3.12" "3.11" ];
        go = "latest";
        ruby = "3.3";
      };

      settings = {
        legacy_version_file = true;
      };
    };
  };

  home.sessionPath = [
    "${config.xdg.dataHome}/mise/shims"
  ];
}
```

---

## 9.9 Modern CLI Tool Replacements

```nix
{ pkgs, ... }:

{
  # eza - Modern ls
  programs.eza = {
    enable = true;
    icons = "auto";
    git = true;
    extraOptions = [ "--group-directories-first" ];
  };

  # bat - Modern cat
  programs.bat = {
    enable = true;
    config = {
      theme = "Catppuccin Mocha";
      style = "numbers,changes,header";
    };
  };

  # fd - Modern find
  programs.fd = {
    enable = true;
    hidden = true;
    ignores = [ ".git/" "node_modules/" ];
  };

  # ripgrep - Modern grep
  programs.ripgrep = {
    enable = true;
    arguments = [ "--smart-case" "--hidden" ];
  };

  # fzf - Fuzzy finder
  programs.fzf = {
    enable = true;
    enableZshIntegration = true;
    defaultCommand = "fd --type f --hidden --follow --exclude .git";
    defaultOptions = [
      "--height=40%"
      "--layout=reverse"
      "--border=rounded"
    ];
    fileWidgetOptions = [
      "--preview 'bat --color=always --style=numbers --line-range=:500 {}'"
    ];
  };

  # zoxide - Smart cd
  programs.zoxide = {
    enable = true;
    enableZshIntegration = true;
    options = [ "--cmd cd" ];
  };

  # btop - Modern top
  programs.btop = {
    enable = true;
    settings = {
      vim_keys = true;
      rounded_corners = true;
    };
  };

  # Additional tools
  home.packages = with pkgs; [
    duf      # Modern df
    dust     # Modern du
    jq       # JSON processor
    yq       # YAML processor
    httpie   # Modern curl
    lazygit  # Git TUI
  ];
}
```

---

## 9.10 direnv for Per-Project Environments

```nix
{
  programs.direnv = {
    enable = true;
    enableZshIntegration = true;
    nix-direnv.enable = true;

    stdlib = ''
      layout_python-venv() {
        local python=''${1:-python3}
        VIRTUAL_ENV=$PWD/.venv
        if [[ ! -d $VIRTUAL_ENV ]]; then
          "$python" -m venv "$VIRTUAL_ENV"
        fi
        PATH_add "$VIRTUAL_ENV/bin"
      }
    '';
  };
}
```

### Example .envrc Files

```bash
# Pure Nix flake
use flake

# Python project
layout python-venv python3.12

# Node project
PATH_add node_modules/.bin
```

---

## 9.11 Complete Development Environment

```nix
{ config, pkgs, lib, ... }:

{
  # Shell
  programs.zsh = {
    enable = true;
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;
    oh-my-zsh = {
      enable = true;
      plugins = [ "git" "docker" "kubectl" ];
    };
  };

  # Prompt
  programs.starship.enable = true;

  # Environment
  home.sessionVariables = {
    EDITOR = "nvim";
    PAGER = "less -R";
  };

  home.sessionPath = [ "$HOME/.local/bin" ];

  home.shellAliases = {
    ls = "eza --icons";
    ll = "eza -la --icons --git";
    cat = "bat --paging=never";
    hms = "home-manager switch --flake .";
  };

  # Tools
  programs.git = {
    enable = true;
    delta.enable = true;
  };

  programs.eza = { enable = true; icons = "auto"; git = true; };
  programs.bat.enable = true;
  programs.fd.enable = true;
  programs.ripgrep.enable = true;
  programs.fzf = { enable = true; enableZshIntegration = true; };
  programs.zoxide = { enable = true; enableZshIntegration = true; };
  programs.direnv = { enable = true; nix-direnv.enable = true; };
  programs.mise = { enable = true; enableZshIntegration = true; };

  home.packages = with pkgs; [ jq lazygit btop duf dust ];
}
```

---

## Summary

1. **Shell configuration** with history, completion, and syntax highlighting
2. **Oh-My-Zsh** for plugins and themes
3. **Aliases** for productivity
4. **Environment variables** and PATH management
5. **Starship** for a modern, fast prompt
6. **Development tools**: Git, Neovim, tmux
7. **mise** for runtime version management
8. **Modern CLI tools**: eza, bat, fd, ripgrep, fzf, zoxide
9. **direnv** for per-project environment automation

---

## Exercises

1. Configure Starship to show Kubernetes context
2. Create a project template with flake.nix and .envrc
3. Set up machine-specific Git email based on directory
4. Build a unified search keybinding with fzf
