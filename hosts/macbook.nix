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
    matchBlocks."*" = {
      addKeysToAgent = "yes";
    };
  };
}
