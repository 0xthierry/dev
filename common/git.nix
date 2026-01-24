{ config, pkgs, ... }:

{
  programs.git = {
    enable = true;
    package = pkgs.gitFull;

    settings = {
      user.name = "Thierry Santos";
      user.email = "thierrysantoos123@gmail.com";

      alias = {
        co = "checkout";
        br = "branch";
        ci = "commit";
        st = "status";
      };

      init.defaultBranch = "main";
      pull.rebase = true;
      push.autoSetupRemote = true;
      diff.algorithm = "histogram";
      diff.colorMoved = "plain";
      diff.mnemonicPrefix = true;
      commit.verbose = true;
      rerere.enabled = true;
      rerere.autoupdate = true;
      branch.sort = "-committerdate";
      tag.sort = "-version:refname";
      column.ui = "auto";
      worktree.useRelativePaths = true;
      core.editor = "nvim";
    };

    ignores = [
      "**/.claude/settings.local.json"
      ".DS_Store"
      "*~"
      "*.swp"
      ".idea/"
      ".vscode/"
      "result"
      "result-*"
    ];

    lfs.enable = true;
  };

  # Delta for enhanced diffs
  programs.delta = {
    enable = true;
    options = {
      navigate = true;
      line-numbers = true;
      syntax-theme = "Dracula";
    };
  };
}
