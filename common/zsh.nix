{ config, pkgs, repoPath, ... }:

{
  home.packages = [
    pkgs.spaceship-prompt
  ];

  programs.zsh = {
    enable = true;
    enableCompletion = true;
    autocd = true;
    dotDir = "${config.xdg.configHome}/zsh";

    # Built-in plugin support
    autosuggestion.enable = true;
    syntaxHighlighting.enable = true;

    # Oh My Zsh configuration (theme disabled - using Spaceship)
    oh-my-zsh = {
      enable = true;
      theme = "";
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

    };

    # Session variables
    sessionVariables = {
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

    # Early environment setup (runs before profile scripts)
    envExtra = ''
      # Fallback TERM for unknown terminals (e.g., ghostty on remote without terminfo)
      if ! infocmp "$TERM" &>/dev/null 2>&1; then
        export TERM=xterm-256color
      fi
    '';

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

      # Source secrets
      [[ -f ~/.secrets ]] && source ~/.secrets

      # SSH-aware EDITOR
      if [[ -n $SSH_CONNECTION ]]; then
        export EDITOR='vim'
      else
        export EDITOR='nvim'
      fi

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

      # Source omarchy bash aliases if available (for compatibility)
      if [ -f "$HOME/.local/share/omarchy/default/bash/aliases" ]; then
        source "$HOME/.local/share/omarchy/default/bash/aliases"
      fi

      # Custom terminal title (folder-aware)
      ZSH_THEME_TERM_TAB_TITLE_IDLE="%1~ - %15<..<%~%<<"
      ZSH_THEME_TERM_TITLE_IDLE="%1~ - %n@%m:%~"

      # Override preexec to include folder name during command execution
      function omz_termsupport_preexec {
        [[ "''${DISABLE_AUTO_TITLE:-}" != true ]] || return 0
        emulate -L zsh
        setopt extended_glob

        local -a cmdargs
        cmdargs=("''${(z)2}")
        if [[ "''${cmdargs[1]}" = fg ]]; then
          local job_id jobspec="''${cmdargs[2]#%}"
          case "$jobspec" in
            <->) job_id=''${jobspec} ;;
            ""|%|+) job_id=''${(k)jobstates[(r)*:+:*]} ;;
            -) job_id=''${(k)jobstates[(r)*:-:*]} ;;
            [?]*) job_id=''${(k)jobtexts[(r)*''${(Q)jobspec}*]} ;;
            *) job_id=''${(k)jobtexts[(r)''${(Q)jobspec}*]} ;;
          esac
          if [[ -n "''${jobtexts[$job_id]}" ]]; then
            1="''${jobtexts[$job_id]}"
            2="''${jobtexts[$job_id]}"
          fi
        fi

        local CMD="''${1[(wr)^(*=*|sudo|ssh|mosh|rake|-*)]:gs/%/%%}"
        local LINE="''${2:gs/%/%%}"
        local FOLDER="''${PWD##*/}"
        title "''${FOLDER} - ''${CMD}" "''${FOLDER} - %100>...>''${LINE}%<<"
      }

      # Custom IP section for Spaceship
      spaceship_ip() {
        local ip
        # Get primary IP (works on Linux and macOS)
        if command -v ip &> /dev/null; then
          ip=$(ip route get 1 2>/dev/null | awk '{print $7; exit}')
        elif command -v ifconfig &> /dev/null; then
          ip=$(ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1)
        fi
        [[ -z "$ip" ]] && return
        spaceship::section --color "blue" --prefix "(" --suffix ") " "$ip"
      }

      # Spaceship prompt order
      SPACESHIP_PROMPT_ORDER=(
        user          # Username
        dir           # Current directory
        host          # Hostname
        ip            # IP address (custom)
        git           # Git branch & status
        node          # Node.js
        python        # Python
        golang        # Go
        rust          # Rust
        docker        # Docker
        exec_time     # Execution time
        line_sep      # Line break
        char          # Prompt character
      )

      # User/Host settings
      SPACESHIP_USER_SHOW=always
      SPACESHIP_HOST_SHOW=always
      SPACESHIP_HOST_PREFIX="at "

      # Git settings
      SPACESHIP_GIT_SHOW=true
      SPACESHIP_GIT_ASYNC=false
      SPACESHIP_GIT_STATUS_SHOW=true

      # Directory settings
      SPACESHIP_DIR_TRUNC=3
      SPACESHIP_DIR_TRUNC_REPO=false

      # Spaceship prompt
      source "${pkgs.spaceship-prompt}/share/zsh/themes/spaceship.zsh-theme"
    '';
  };
}
