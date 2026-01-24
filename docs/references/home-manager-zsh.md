# Home Manager Zsh Configuration Reference

## Basic Configuration

```nix
{ config, pkgs, ... }:

{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autocd = true;

    # Built-in plugin support
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    # Oh My Zsh configuration
    oh-my-zsh = {
      enable = true;
      theme = "robbyrussell";
      plugins = [
        "git"
        "python"
        "node"
        "golang"
        "aws"
        "terraform"
        "rust"
        "docker"
        "colorize"
        "colored-man-pages"
        "zsh-syntax-highlighting"
        "zsh-autosuggestions"
      ];
    };

    # Shell aliases
    shellAliases = {
      # Navigation
      ".." = "cd ..";
      "..." = "cd ../..";
      "...." = "cd ../../..";

      # Modern CLI tools
      ls = "eza --icons --group-directories-first";
      ll = "eza -la --icons --group-directories-first";
      la = "eza -la --icons";
      lt = "eza --tree --icons --level=2";
      cat = "bat";
      grep = "rg";
      find = "fd";

      # Git
      lg = "lazygit";
      g = "git";
      gst = "git status";
      gco = "git checkout";

      # Workspace shortcuts
      wrks = "cd ~/Work/Sideprojects";
      wrkm = "cd ~/Work/Mainprojects";
      wrkp = "cd ~/Work/Personal";
      wrka = "cd ~/Work/Archive";

      # Claude
      uc = "claude --unsafe-mode";
      sc = "source ~/.claude/hooks/tools/scripts/cc.sh";

      # NixOS/Home Manager
      hms = "home-manager switch --flake ~/dev";
    };

    # Global aliases (substituted anywhere on the command line)
    shellGlobalAliases = {
      G = "| grep";
      L = "| less";
      NE = "2>/dev/null";
    };

    # History configuration
    history = {
      size = 50000;
      save = 50000;
      path = "${config.xdg.dataHome}/zsh/history";
      extended = true;
      ignoreDups = true;
      ignoreAllDups = true;
      ignoreSpace = true;
      expireDuplicatesFirst = true;
      share = true;
    };

    # History substring search
    historySubstringSearch = {
      enable = true;
      searchUpKey = [ "^[[A" "$terminfo[kcuu1]" ];
      searchDownKey = [ "^[[B" "$terminfo[kcud1]" ];
    };

    # Environment variables for zsh
    sessionVariables = {
      ZSH_AUTOSUGGEST_HIGHLIGHT_STYLE = "fg=8";
    };

    # Additional init content
    initExtra = ''
      # Custom keybindings
      bindkey '^[[H' beginning-of-line
      bindkey '^[[F' end-of-line
      bindkey '^[[3~' delete-char

      # Custom functions
      mkcd() {
        mkdir -p "$1" && cd "$1"
      }

      # FZF configuration
      if command -v fzf &> /dev/null; then
        source <(fzf --zsh)
      fi
    '';
  };

  # Global session variables (available to all shells)
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    PAGER = "less -R";
    LANG = "en_US.UTF-8";
  };
}
```

## Syntax Highlighting Options

```nix
programs.zsh.syntaxHighlighting = {
  enable = true;
  highlighters = [ "main" "brackets" "pattern" "cursor" ];
  styles = {
    "builtin" = "fg=blue";
    "command" = "fg=green";
    "alias" = "fg=magenta";
  };
  patterns = {
    "rm -rf *" = "fg=white,bold,bg=red";
  };
};
```

## Manual Plugin Installation

For plugins not in oh-my-zsh:

```nix
programs.zsh.plugins = [
  {
    name = "zsh-nix-shell";
    file = "nix-shell.plugin.zsh";
    src = pkgs.fetchFromGitHub {
      owner = "chisui";
      repo = "zsh-nix-shell";
      rev = "v0.8.0";
      sha256 = "1lzrn0n4fxfcgg65v0qhnj7wnybybqzs4adz7xsrkgmcsr0ii8b7";
    };
  }
];
```

## Setting Zsh as Default Shell (Non-NixOS)

```bash
# Add nix-installed zsh to valid shells
echo "$HOME/.nix-profile/bin/zsh" | sudo tee -a /etc/shells

# Change default shell
chsh -s "$HOME/.nix-profile/bin/zsh"
```

## Available Oh-My-Zsh Plugins

Common useful plugins:
- `git` - Git aliases and functions
- `docker` - Docker completions
- `kubectl` - Kubernetes completions
- `python` - Python aliases
- `node` - Node.js/npm completions
- `golang` - Go completions
- `rust` - Rust/cargo completions
- `aws` - AWS CLI completions
- `terraform` - Terraform completions
- `sudo` - ESC ESC to add sudo
- `z` - Directory jumping
- `colored-man-pages` - Colorized man pages
- `command-not-found` - Suggest packages
