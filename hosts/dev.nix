{ config, pkgs, lib, ... }:

{
  imports = [
    ../common/cli-tools.nix
  ];

  # Dev-specific settings
  # Minimal - just common modules + CLI tools
  # No desktop apps, no GUI

  # SSH configuration for remote development
  programs.ssh = {
    enable = true;
    addKeysToAgent = "yes";
  };
}
