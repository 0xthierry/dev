{ config, pkgs, lib, ... }:

{
  imports = [
    ../common/cli-tools.nix
  ];

  home.packages = with pkgs; [
    ollama
  ];

  programs.ssh = {
    enable = true;
    enableDefaultConfig = false;
    matchBlocks."*" = {
      addKeysToAgent = "yes";
    };
  };
}
