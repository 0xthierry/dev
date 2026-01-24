# Home Manager CLI Tools Configuration Reference

## Note: Omarchy Already Provides

If using omarchy, these tools are **already installed** - do NOT reinstall:
- eza, fzf, zoxide, ripgrep, fd, bat, delta, btop, lazygit

Only use this config for the `dev` host or to add tools omarchy doesn't include.

---

## Complete Example (for dev host or non-omarchy)

```nix
{ config, pkgs, ... }:

{
  # Packages without dedicated programs.* modules
  home.packages = with pkgs; [
    dust        # Disk usage analyzer
    tree        # Directory tree
  ];

  # eza - modern ls replacement
  programs.eza = {
    enable = true;
    enableBashIntegration = true;
    enableZshIntegration = true;
    git = true;
    icons = "auto";
    extraOptions = [ "--group-directories-first" ];
  };

  # fzf - fuzzy finder
  programs.fzf = {
    enable = true;
    enableBashIntegration = true;
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
    settings = {
      theme = "catppuccin-mocha";
      pane_frames = false;
    };
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
      theme = "Catppuccin Mocha";
      style = "numbers,changes,header";
    };
  };

  # btop - system monitor
  programs.btop = {
    enable = true;
    settings = {
      vim_keys = true;
      rounded_corners = true;
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
    enableBashIntegration = true;
    enableZshIntegration = true;
    options = [ "--cmd cd" ];
  };

  # Note: Using oh-my-zsh with robbyrussell theme for prompt
  # See home-manager-zsh.md for shell configuration
}
```

## Tool-by-Tool Reference

### eza (ls replacement)

```nix
programs.eza = {
  enable = true;
  enableZshIntegration = true;  # Aliases ls to eza
  git = true;                   # Show git status
  icons = "auto";               # Show icons
  extraOptions = [
    "--group-directories-first"
    "--header"
  ];
};
```

### fzf (fuzzy finder)

```nix
programs.fzf = {
  enable = true;
  enableZshIntegration = true;  # CTRL-T, CTRL-R, ALT-C

  defaultCommand = "fd --type f --hidden --follow --exclude .git";
  fileWidgetCommand = "fd --type f --hidden --follow --exclude .git";
  changeDirWidgetCommand = "fd --type d --hidden --follow --exclude .git";

  defaultOptions = [
    "--height=40%"
    "--layout=reverse"
    "--border"
    "--preview 'bat --color=always --style=numbers --line-range=:500 {}'"
  ];

  colors = {
    "bg+" = "#363a4f";
    "bg" = "#24273a";
  };
};
```

### lazygit

```nix
programs.lazygit = {
  enable = true;
  settings = {
    gui = {
      showIcons = true;
      nerdFontsVersion = "3";
    };
    git.paging = {
      colorArg = "always";
      pager = "delta --dark --paging=never";
    };
  };
};
```

### zellij

```nix
programs.zellij = {
  enable = true;
  enableZshIntegration = true;  # Auto-attach

  settings = {
    theme = "catppuccin-mocha";
    default_layout = "compact";
    pane_frames = false;
    mouse_mode = true;
    copy_on_select = true;
  };
};
```

### ripgrep

```nix
programs.ripgrep = {
  enable = true;
  arguments = [
    "--max-columns=150"
    "--max-columns-preview"
    "--glob=!.git/*"
    "--smart-case"
    "--hidden"
  ];
};
```

### fd

```nix
programs.fd = {
  enable = true;
  hidden = true;
  ignores = [
    ".git/"
    "node_modules/"
    "target/"
  ];
};
```

### bat

```nix
programs.bat = {
  enable = true;
  config = {
    theme = "Catppuccin Mocha";
    style = "numbers,changes,header";
    italic-text = "always";
    pager = "less -FR";
  };
  extraPackages = with pkgs.bat-extras; [
    batdiff
    batgrep
    batman
  ];
};
```

### btop

```nix
programs.btop = {
  enable = true;
  settings = {
    color_theme = "catppuccin_mocha";
    vim_keys = true;
    rounded_corners = true;
    update_ms = 1000;
    proc_tree = true;
  };
};
```

### tealdeer (tldr)

```nix
programs.tealdeer = {
  enable = true;
  settings = {
    display = {
      compact = false;
      use_pager = true;
    };
    updates = {
      auto_update = true;
      auto_update_interval_hours = 720;
    };
  };
};
```

### zoxide

```nix
programs.zoxide = {
  enable = true;
  enableZshIntegration = true;
  options = [ "--cmd cd" ];  # Replace cd with zoxide
};
```

## Shell Prompt

This project uses **oh-my-zsh with robbyrussell theme** instead of starship.

See [home-manager-zsh.md](./home-manager-zsh.md) for the complete zsh configuration including:
- robbyrussell theme setup
- oh-my-zsh plugins
- Shell aliases

## Packages Without programs.* Modules

Install via `home.packages`:

```nix
home.packages = with pkgs; [
  dust     # Disk usage analyzer (du alternative)
  procs    # Process viewer (ps alternative)
  sd       # sed alternative
  bottom   # System monitor alternative
  hyperfine # Benchmarking tool
  tokei    # Code statistics
  bandwhich # Network monitor
  xh       # HTTP client (httpie alternative)
];
```
