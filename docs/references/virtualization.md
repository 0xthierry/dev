# Virtualization Setup on Arch Linux

## Note: Omarchy Context

Omarchy does NOT include virtualization packages. All virtualization setup is additional.

---

## Overview

Virtualization requires a **hybrid approach**: system-level components via pacman, user configuration via Home Manager.

## System Requirements (pacman)

```bash
# Core packages - MUST use pacman
sudo pacman -S qemu-full qemu-img libvirt virt-manager virt-viewer \
  edk2-ovmf dnsmasq swtpm guestfs-tools firecracker

# Enable services
sudo systemctl enable --now libvirtd.socket
sudo systemctl enable --now virtnetworkd.socket

# Add user to groups
sudo usermod -aG kvm,libvirt $USER

# Enable default network
sudo virsh net-start default
sudo virsh net-autostart default

# Configure bridge helper for user session
echo "allow virbr0" | sudo tee /etc/qemu/bridge.conf
```

## Home Manager Configuration

```nix
{ config, pkgs, ... }:
{
  home.packages = with pkgs; [
    libguestfs     # VM image tools
    cloud-utils    # cloud-localds for cloud-init
  ];

  # Default to user session (no root password prompts)
  home.file.".config/libvirt/libvirt.conf".text = ''
    uri_default = "qemu:///session"
  '';

  home.sessionVariables = {
    LIBVIRT_DEFAULT_URI = "qemu:///session";
  };

  programs.zsh.shellAliases = {
    vm-list = "virsh list --all";
    vm-start = "virsh start";
    vm-stop = "virsh shutdown";
  };
}
```

## Connection URIs

| URI | Best For | Features |
|-----|----------|----------|
| `qemu:///system` | Servers, production | Full networking, PCI passthrough, autostart |
| `qemu:///session` | Desktop, development | No root needed, user-owned VMs |

## Required Groups

| Group | Purpose |
|-------|---------|
| `kvm` | Access to `/dev/kvm` |
| `libvirt` | Access to libvirt socket |

## Verify Setup

```bash
# Check virtualization support
lscpu | grep -i Virtualization

# Validate host
sudo virt-host-validate qemu

# Verify group membership
groups $USER
```

## Firecracker

Firecracker is installed via pacman (see above). It's a lightweight microVM hypervisor by AWS.

```bash
# Verify installation
firecracker --version

# Requires /dev/kvm access (kvm group membership)
```

Note: Firecracker doesn't support 9p/virtiofs shares. Use volumes or network file sharing.

For declarative VM management with Nix, see [microvm.nix](https://github.com/microvm-nix/microvm.nix).

## Limitations on Non-NixOS

Home Manager **cannot**:
- Enable systemd system services
- Modify `/etc/libvirt/` configs
- Add users to system groups

These must be done via pacman/systemctl.
