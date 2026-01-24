{ config, pkgs, ... }:

{
  # Critical for non-NixOS systems
  targets.genericLinux.enable = true;

  # Fix locale issues on Arch
  home.sessionVariables = {
    LOCALE_ARCHIVE = "/usr/lib/locale/locale-archive";
  };

  # XDG integration
  xdg.enable = true;
  xdg.mimeApps.enable = true;
}
