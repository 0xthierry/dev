{ config, pkgs, lib, repoPath, ... }:

let
  configsPath = "${repoPath}/configs";
in
{
  xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/nvim";

  home.file.".claude".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/claude";

  xdg.configFile."zellij".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/zellij";

  xdg.configFile."hypr".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/hypr";

  programs.neovim = {
    enable = true;
    defaultEditor = true;
  };

  programs.zellij = {
    enable = true;
  };
}
