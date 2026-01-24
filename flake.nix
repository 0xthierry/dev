{
  description = "Home Manager configuration for multiple machines";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, home-manager, ... }@inputs:
    let
      # Helper to determine home directory based on system
      homeDir = system: username:
        if builtins.match ".*-darwin" system != null
        then "/Users/${username}"
        else "/home/${username}";

      mkHome = { system, username, hostname, extraModules ? [] }:
        let
          homePath = homeDir system username;
          repoPath = "${homePath}/dev";
        in
        home-manager.lib.homeManagerConfiguration {
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };
          modules = [
            ./home.nix
            ./hosts/${hostname}.nix
          ] ++ extraModules;
          extraSpecialArgs = {
            inherit inputs hostname repoPath;
            homeDirectory = homePath;
          };
        };
    in {
      homeConfigurations = {
        "omarchy" = mkHome {
          system = "x86_64-linux";
          username = "thierry";
          hostname = "omarchy";
          extraModules = [ ./linux/default.nix ];
        };
        "dev" = mkHome {
          system = "x86_64-linux";
          username = "thierry";
          hostname = "dev";
          extraModules = [ ./linux/default.nix ];
        };
        "macbook" = mkHome {
          system = "aarch64-darwin";
          username = "thierry";
          hostname = "macbook";
          extraModules = [ ./darwin/default.nix ];
        };
      };

      # Expose home-manager for bootstrap.sh (uses pinned inputs)
      apps.x86_64-linux.home-manager = {
        type = "app";
        program = "${home-manager.packages.x86_64-linux.default}/bin/home-manager";
      };
      apps.aarch64-darwin.home-manager = {
        type = "app";
        program = "${home-manager.packages.aarch64-darwin.default}/bin/home-manager";
      };
    };
}
