{ config, pkgs, lib, ... }:

{
  # Omarchy host configuration
  # Minimal - omarchy provides most tools via pacman
  # Only shell config (git, zsh, mise) from home-manager

  # SSH configuration
  programs.ssh = {
    enable = true;
    addKeysToAgent = "yes";
  };
}
