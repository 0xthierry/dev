{ config, pkgs, ... }:

{
  # XDG integration
  xdg.enable = true;

  # macOS session variables
  home.sessionVariables = {
    LANG = "en_US.UTF-8";
    LC_ALL = "en_US.UTF-8";
  };
}
