{ config, pkgs, ... }:

{
  programs.mise = {
    enable = true;
    enableZshIntegration = true;
    enableBashIntegration = true;

    globalConfig = {
      tools = {
        node = "lts";
        python = "3.12";
        go = "latest";
        bun = "latest";
        rust = "latest";
        zig = "latest";
        "aws-cli" = "latest";
      };
      settings = {
        experimental = false;
        verbose = false;
        not_found_auto_install = true;
        trusted_config_paths = [ "~/Work" ];
      };
    };
  };
}
