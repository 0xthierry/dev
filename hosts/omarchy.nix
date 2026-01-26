{ config, pkgs, lib, repoPath, ... }:

let
  configsPath = "${repoPath}/configs";
in
{
  imports = [
    ../common/cli-tools.nix
  ];

  home.packages = with pkgs; [
    imagemagick   # Image processing
  ];

  home.sessionVariables = {
    OLLAMA_HOST = "0.0.0.0:11434";
  };
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
}
