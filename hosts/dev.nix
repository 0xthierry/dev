{ config, pkgs, lib, repoPath, ... }:

let
  configsPath = "${repoPath}/configs";
in
{
  imports = [
    ../common/cli-tools.nix
  ];

  # Config symlinks
  xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/nvim";

  home.file.".claude".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/claude";

  xdg.configFile."zellij".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/zellij";

  # SSH configuration for remote development
  programs.ssh = {
    enable = true;
    matchBlocks."*" = {
      addKeysToAgent = "yes";
    };
  };
}
