{ config, pkgs, hostname, homeDirectory, repoPath, ... }:

{
  imports = [
    ./common/git.nix
    ./common/zsh.nix
    ./common/mise.nix
  ];

  home.username = "thierry";
  home.homeDirectory = homeDirectory;  # Platform-aware from flake.nix
  home.stateVersion = "24.11";

  # Global session variables
  home.sessionVariables = {
    EDITOR = "nvim";
    VISUAL = "nvim";
    PAGER = "less -R";
    LANG = "en_US.UTF-8";
  };

  # Let Home Manager manage itself
  programs.home-manager.enable = true;
}
