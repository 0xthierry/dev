{ config, pkgs, lib, ... }:

{
  # Macbook host configuration (stub)
  # TODO: Implement when macbook setup is needed

  # SSH configuration
  programs.ssh = {
    enable = true;
    addKeysToAgent = "yes";
  };
}
