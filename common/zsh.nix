{ config, pkgs, repoPath, ... }:

{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autocd = true;
    dotDir = "${config.xdg.configHome}/zsh";

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

      # Claude (using cclaude wrapper)
      uc = "cclaude --rw";
      ucr = "cclaude --rw -- --resume";
      sc = "cclaude --ro";
      scr = "cclaude --ro -- --resume";

      # Zellij
      zj = "zellij";
      zl = "zellij list-sessions";
      za = "zellij attach";
      zk = "zellij kill-session";
      zka = "zellij kill-all-sessions";

      # Docker
      dstop = "docker ps -q | xargs -r docker stop";

      # Home Manager - use hms function defined in initContent
      # hms = defined as function below
    };

    # Session variables
    sessionVariables = {
      OLLAMA_HOST = "http://localhost:11434";
      OPENCODE_ENABLE_EXA = "true";
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
    initContent = ''
      # Fallback TERM for unknown terminals (e.g., ghostty on remote without terminfo)
      if ! infocmp "$TERM" &>/dev/null 2>&1; then
        export TERM=xterm-256color
      fi

      # Additional PATH entries
      export PATH="$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH"
      export PATH="$HOME/.opencode/bin:$PATH"
      export PATH="/opt/rocm/bin:$PATH"
      export PATH="$HOME/.cache/.bun/bin:$PATH"

      # Source Nix daemon (required for Nix on Arch)
      if [ -e '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]; then
        . '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
      fi

      # Load omarchy-zsh configuration (Arch-specific)
      if [[ -d /usr/share/omarchy-zsh/conf.d ]]; then
        for config in /usr/share/omarchy-zsh/conf.d/*.zsh; do
          [[ -f "$config" ]] && source "$config"
        done
      fi
      if [[ -d /usr/share/omarchy-zsh/functions ]]; then
        for func in /usr/share/omarchy-zsh/functions/*.zsh; do
          [[ -f "$func" ]] && source "$func"
        done
      fi

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

      # Home Manager switch (uses hostname to pick config)
      hms() {
        home-manager switch --flake ${repoPath}#"$(hostname)"
      }

      # Source omarchy bash aliases if available (for compatibility)
      if [ -f "$HOME/.local/share/omarchy/default/bash/aliases" ]; then
        source "$HOME/.local/share/omarchy/default/bash/aliases"
      fi

      # Custom terminal title (folder-aware)
      ZSH_THEME_TERM_TAB_TITLE_IDLE="%1~ - %15<..<%~%<<"
      ZSH_THEME_TERM_TITLE_IDLE="%1~ - %n@%m:%~"
    '';
  };
}
