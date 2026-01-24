{ config, pkgs, repoPath, ... }:

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
      ];
    };

    # Shell aliases
    shellAliases = {
      # Navigation
      ".." = "cd ..";
      "..." = "cd ../..";
      "...." = "cd ../../..";

      # Modern CLI tools
      ls = "eza -lh --group-directories-first --icons=auto";
      ll = "eza -la --icons --group-directories-first";
      la = "eza -la --icons";
      lt = "eza --tree --icons --level=2";

      # Editors
      vim = "nvim";
      vi = "nvim";

      # Git
      lg = "lazygit";
      g = "git";

      # Workspace shortcuts
      wrks = "cd ~/Work/Sideprojects";
      wrkm = "cd ~/Work/Meistrari";
      wrkp = "cd ~/Work/Pagarme";
      wrka = "cd ~/Work/Arado";

      # Claude
      uc = "claude --unsafe-mode";
      sc = "source ~/.claude/hooks/tools/scripts/cc.sh";

      # Zellij
      zj = "zellij";
      zl = "zellij list-sessions";
      za = "zellij attach";
      zk = "zellij kill-session";
      zka = "zellij kill-all-sessions";

      # Home Manager (uses repoPath from flake)
      hms = "home-manager switch --flake ${repoPath}";
    };

    # History configuration
    history = {
      size = 32768;
      save = 32768;
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
    };

    # Additional init content
    initExtra = ''
      # FZF configuration
      if command -v fzf &> /dev/null; then
        source <(fzf --zsh)
      fi

      # Zoxide integration
      if command -v zoxide &> /dev/null; then
        eval "$(zoxide init zsh)"
      fi

      # Custom function for mkdir + cd
      mkcd() {
        mkdir -p "$1" && cd "$1"
      }

      # Source omarchy bash aliases if available (for compatibility)
      if [ -f "$HOME/.local/share/omarchy/default/bash/aliases" ]; then
        source "$HOME/.local/share/omarchy/default/bash/aliases"
      fi
    '';
  };
}
