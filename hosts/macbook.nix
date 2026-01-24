{ config, pkgs, lib, ... }:

{
  imports = [
    ../common/cli-tools.nix
  ];

  programs.ssh = {
    enable = true;
    addKeysToAgent = "yes";
  };
}
