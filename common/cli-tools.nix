{ config, pkgs, ... }:

{
  # Packages without dedicated programs.* modules
  home.packages = with pkgs; [
    dust          # Disk usage analyzer
    tree          # Directory tree
    tldr          # Simplified man pages
    wl-clipboard  # Wayland clipboard (wl-copy, wl-paste)
    dnsutils      # DNS tools (dig, nslookup, host)
    jq            # JSON processor
    yq            # YAML processor
    gum           # CLI prompts/spinners
    lazydocker    # Docker TUI
    socat         # Socket utility
    htop          # Process viewer
    shellcheck    # Shell script linter
    fastfetch     # System info
    unzip         # Archive extraction
    gh            # GitHub CLI
    curl          # HTTP client
    wget          # HTTP downloads
    gnumake       # Build tool
    entr          # Run commands on file change
    gitleaks      # Git secrets scanner
    graphviz      # Diagrams (dot)
  ];

  # eza - modern ls replacement
  programs.eza = {
    enable = true;
    enableZshIntegration = true;
    git = true;
    icons = "auto";
    extraOptions = [ "--group-directories-first" ];
  };

  # fzf - fuzzy finder
  programs.fzf = {
    enable = true;
    enableZshIntegration = true;
    defaultCommand = "fd --type f --hidden --follow --exclude .git";
    fileWidgetCommand = "fd --type f --hidden --follow --exclude .git";
    changeDirWidgetCommand = "fd --type d --hidden --follow --exclude .git";
    defaultOptions = [
      "--height=40%"
      "--layout=reverse"
      "--border"
    ];
  };

  # lazygit - Git TUI
  programs.lazygit = {
    enable = true;
    settings = {
      gui.showIcons = true;
    };
  };

  # zellij - terminal multiplexer
  programs.zellij = {
    enable = true;
  };

  # ripgrep - fast grep
  programs.ripgrep = {
    enable = true;
    arguments = [
      "--smart-case"
      "--hidden"
      "--glob=!.git/*"
    ];
  };

  # fd - fast find
  programs.fd = {
    enable = true;
    hidden = true;
    ignores = [ ".git/" "node_modules/" ];
  };

  # bat - cat with syntax highlighting
  programs.bat = {
    enable = true;
    config = {
      theme = "ansi";
      style = "numbers,changes,header";
    };
  };

  # btop - system monitor
  programs.btop = {
    enable = true;
    settings = {
      vim_keys = true;
    };
  };

  # tealdeer - tldr pages
  programs.tealdeer = {
    enable = true;
    settings = {
      updates.auto_update = true;
    };
  };

  # zoxide - smarter cd
  programs.zoxide = {
    enable = true;
    enableZshIntegration = true;
  };

  # direnv - auto-load .envrc
  programs.direnv = {
    enable = true;
    enableZshIntegration = true;
    nix-direnv.enable = true;
  };
}
