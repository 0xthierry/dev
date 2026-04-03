{ config, pkgs, lib, repoPath, ... }:

let
  configsPath = "${repoPath}/configs";
in
{
  home.packages = with pkgs; [
    ollama
  ];

  home.sessionVariables = {
    OLLAMA_HOST = "http://172.16.0.1:11434";
    TZ = "America/Sao_Paulo";
    LANG = "en_US.UTF-8";
    LC_ALL = "en_US.UTF-8";
  };

  # Config symlinks
  xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/nvim";

  home.file.".agents".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/agents";

  xdg.configFile."zellij".source = config.lib.file.mkOutOfStoreSymlink
    "${configsPath}/zellij";

  home.activation.installAgents = lib.hm.dag.entryAfter ["linkGeneration"] ''
    run ${configsPath}/agents/install.sh --yes
  '';

  # Create work directories
  home.activation.createWorkDirs = lib.hm.dag.entryAfter ["writeBoundary"] ''
    mkdir -p ~/Work/Sideprojects
    mkdir -p ~/Work/Meistrari
  '';

  # SSH configuration for remote development
  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
    matchBlocks."*" = {
      addKeysToAgent = "yes";
    };
    matchBlocks."github.com" = {
      hostname = "github.com";
      user = "git";
      identityFile = "~/.ssh/id_ed25519_github_vm";
      identitiesOnly = true;
    };
  };
}
