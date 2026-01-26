{ config, pkgs, ... }:

{
  # Packages without dedicated programs.* modules
  home.packages = with pkgs; [
    # Disk & files
    dust          # Disk usage analyzer
    duf           # Modern df replacement
    tree          # Directory tree
    ncdu          # Interactive disk usage
    hexyl         # Hex viewer

    # Text processing
    jq            # JSON processor
    yq            # YAML processor
    sd            # Modern sed replacement
    choose        # Modern cut replacement

    # Network & HTTP
    curl          # HTTP client
    wget          # HTTP downloads
    xh            # Modern HTTPie alternative
    dnsutils      # DNS tools (dig, nslookup, host)
    nmap          # Network scanner
    whois         # Domain lookup
    mitmproxy     # HTTP debugging proxy
    iperf3        # Network performance testing

    # System monitoring
    htop          # Process viewer
    procs         # Modern ps replacement
    fastfetch     # System info
    inxi          # Detailed system info

    # Development
    gh            # GitHub CLI
    gnumake       # Build tool
    shellcheck    # Shell script linter
    gitleaks      # Git secrets scanner
    graphviz      # Diagrams (dot)
    tree-sitter   # Parser generator for neovim
    tokei         # Code statistics
    hyperfine     # Command benchmarking

    # File watching & sync
    entr          # Run commands on file change
    watchexec     # File watcher (better entr)
    rsync         # File synchronization

    # Containers
    lazydocker    # Docker TUI
    dive          # Docker image layer analyzer

    # Utilities
    wl-clipboard  # Wayland clipboard (wl-copy, wl-paste)
    gum           # CLI prompts/spinners
    socat         # Socket utility
    unzip         # Archive extraction
    less          # Pager (used by git, man, etc.)
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
