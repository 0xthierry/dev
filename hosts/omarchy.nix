{ config, pkgs, lib, repoPath, ... }:

let
  configsPath = "${repoPath}/configs";
in
{
  home.packages = with pkgs; [
    imagemagick
  ];

  home.sessionVariables = {
    OLLAMA_HOST = "0.0.0.0:11434";
  };

  xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/nvim";

  home.file.".agents".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/agents";

  xdg.configFile."zellij".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/zellij";

  xdg.configFile."hypr".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/hypr";

  home.activation.installAgents = lib.hm.dag.entryAfter ["linkGeneration"] ''
    run ${configsPath}/agents/install.sh --yes
  '';
}
