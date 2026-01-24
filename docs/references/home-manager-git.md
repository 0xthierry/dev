# Home Manager Git Configuration Reference

## Complete Configuration

```nix
{ config, pkgs, ... }:

{
  programs.git = {
    enable = true;
    package = pkgs.gitFull;  # Includes git-send-email

    userName = "Thierry Santos";
    userEmail = "thierrysantoos123@gmail.com";

    aliases = {
      st = "status -sb";
      co = "checkout";
      br = "branch";
      ci = "commit";
      lg = "log --oneline --graph --decorate --all";
      last = "log -1 HEAD --stat";
      unstage = "reset HEAD --";
      amend = "commit --amend --no-edit";
      pushf = "push --force-with-lease";
    };

    extraConfig = {
      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
      diff.algorithm = "histogram";
      rerere.enabled = true;
      merge.conflictStyle = "zdiff3";
      fetch.prune = true;

      rebase = {
        autoSquash = true;
        autoStash = true;
      };

      core = {
        editor = "nvim";
        autocrlf = "input";
      };
    };

    ignores = [
      ".DS_Store"
      "*~"
      "*.swp"
      ".idea/"
      ".vscode/"
      ".env"
      ".envrc"
      "node_modules/"
      "__pycache__/"
      "result"
      "result-*"
    ];

    lfs.enable = true;
  };

  # Delta for enhanced diffs
  programs.delta = {
    enable = true;
    enableGitIntegration = true;
    options = {
      navigate = true;
      line-numbers = true;
      syntax-theme = "Dracula";
    };
  };
}
```

## Key Options

### User Settings

```nix
programs.git = {
  userName = "Your Name";
  userEmail = "you@example.com";
};
```

### Default Branch

```nix
extraConfig = {
  init.defaultBranch = "main";
};
```

### Pull/Push Behavior

```nix
extraConfig = {
  pull.rebase = true;           # Rebase on pull instead of merge
  push.autoSetupRemote = true;  # Auto set upstream on first push
};
```

### Diff Algorithm

```nix
extraConfig = {
  diff.algorithm = "histogram";  # Better diff algorithm
};
```

### Rerere (Reuse Recorded Resolution)

```nix
extraConfig = {
  rerere.enabled = true;  # Remember conflict resolutions
};
```

## Aliases

```nix
aliases = {
  # Status
  st = "status -sb";
  s = "status";

  # Branch/Checkout
  br = "branch";
  co = "checkout";
  sw = "switch";

  # Commit
  ci = "commit";
  cm = "commit -m";
  cam = "commit -am";
  amend = "commit --amend --no-edit";

  # Log
  lg = "log --oneline --graph --decorate";
  lga = "log --oneline --graph --decorate --all";
  last = "log -1 HEAD --stat";

  # Diff
  df = "diff";
  dfs = "diff --staged";

  # Reset
  unstage = "reset HEAD --";
  undo = "reset --soft HEAD~1";
};
```

## Global Ignores

```nix
ignores = [
  # OS
  ".DS_Store"
  "Thumbs.db"

  # Editors
  "*~"
  "*.swp"
  ".idea/"
  ".vscode/"

  # Environment
  ".env"
  ".env.local"
  ".envrc"

  # Dependencies
  "node_modules/"
  "__pycache__/"
  ".venv/"

  # Nix
  "result"
  "result-*"
];
```

## Delta Integration

```nix
programs.delta = {
  enable = true;
  enableGitIntegration = true;

  options = {
    navigate = true;
    line-numbers = true;
    side-by-side = false;
    syntax-theme = "Dracula";

    file-style = "bold yellow ul";
    hunk-header-decoration-style = "cyan box ul";
  };
};
```

## Difftastic (Alternative)

```nix
programs.git.difftastic = {
  enable = true;
  display = "inline";  # or "side-by-side"
  background = "dark";
};
```

## Conditional Includes

```nix
includes = [
  {
    condition = "gitdir:~/work/";
    contents = {
      user.email = "work@company.com";
    };
  }
];
```

## GPG Signing

```nix
signing = {
  key = "YOUR_GPG_KEY_ID";
  signByDefault = true;
};
```

## Git LFS

```nix
lfs = {
  enable = true;
  skipSmudge = false;
};
```
