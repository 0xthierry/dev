# Omarchy on Parallels VM (Apple Silicon)

Step-by-step guide to install Omarchy in a Parallels VM on Apple Silicon Macs using the ARM-native approach with jondkinney's armarchy fork.

Tested on: MacBook Pro M4 Pro, 24GB RAM, macOS 26.4, Parallels 26.3.0.

## Prerequisites

- Parallels Desktop (14-day trial available, ~$100/year)
- Internet connection
- ~1 hour for the full process

## Step 1: Download the archboot ISO

```bash
curl -L -o ~/Downloads/archboot-aarch64.iso \
  "https://release.archboot.com/aarch64/latest/iso/$(curl -s https://release.archboot.com/aarch64/latest/iso/ | grep -o 'archboot-[^"]*-latest-aarch64.iso' | head -1)"
```

Or browse https://release.archboot.com/aarch64/latest/iso/ and download the `-latest-aarch64.iso` file (~285MB).

## Step 2: Create and configure the Parallels VM

All VM configuration is done from the Mac host via `prlctl`.

### Create the VM

```bash
prlctl create omarchy -d linux --ostype linux
```

### Set resources (CPU, RAM, disk)

```bash
prlctl set omarchy --cpus 8 --memsize 18432 --device-set hdd0 --size 262144
```

### Attach the archboot ISO

```bash
prlctl set omarchy --device-set cdrom0 --image ~/Downloads/archboot-aarch64.iso --connect
```

### Enable EFI boot and GPU acceleration

```bash
prlctl set omarchy --efi-boot on
prlctl set omarchy --3d-accelerate highest
```

### Enable HiDPI / Retina display

```bash
prlctl set omarchy --high-resolution on
```

### Start the VM

```bash
prlctl start omarchy
```

This creates an ARM VM with 8 CPUs, 18GB RAM, 256GB disk, EFI boot, GPU acceleration, and Retina display support.

## Step 3: Boot into archboot

The VM opens in Parallels. Archboot boots automatically and drops you into a root shell:

```
[root@archboot /] #
```

## Step 4: Partition the disk

```bash
cfdisk /dev/sda
```

1. Select **gpt** label type
2. Create partition 1: **512M**, type **EFI System**
3. Create partition 2: **remaining space**, type **Linux filesystem**
4. **Write**, then **Quit**

## Step 5: Format with btrfs (not ext4)

Omarchy expects btrfs. Using ext4 will cause problems.

```bash
mkfs.vfat -F32 /dev/sda1
mkfs.btrfs -f /dev/sda2
```

## Step 6: Mount partitions

```bash
mount /dev/sda2 /mnt
mkdir /mnt/boot
mount /dev/sda1 /mnt/boot
```

## Step 7: Install base system

```bash
pacstrap /mnt base linux-aarch64 linux-firmware sudo wget btrfs-progs grub efibootmgr dosfstools openssh
```

Warnings about missing firmware modules (ast, qla1280, etc.) and microcode are normal for a VM — ignore them.

## Step 8: Generate fstab and chroot

```bash
genfstab -U /mnt >> /mnt/etc/fstab
arch-chroot /mnt
```

## Step 9: Configure the system

### DNS (critical — without this, pacman won't work)

```bash
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 8.8.4.4" >> /etc/resolv.conf
```

### Locale and hostname

```bash
echo "omarchy" > /etc/hostname
ln -sf /usr/share/zoneinfo/Europe/Paris /etc/localtime
echo "en_US.UTF-8 UTF-8" > /etc/locale.gen
locale-gen
echo "LANG=en_US.UTF-8" > /etc/locale.conf
```

### Root password

```bash
passwd
```

## Step 10: Install and configure GRUB

```bash
grub-install --target=arm64-efi --efi-directory=/boot --bootloader-id=GRUB --removable
```

The `--removable` flag is critical — it prevents "efibootmgr failed to register the boot entry" errors.

Add a boot entry for the aarch64 kernel (grub-mkconfig won't detect it automatically because the kernel is named `Image` instead of `vmlinuz-linux`):

```bash
tee -a /etc/grub.d/40_custom << 'EOF'
menuentry "Arch Linux ARM" {
    linux /Image root=/dev/sda2 rw
    initrd /initramfs-linux.img
}
EOF

sed -i 's/^GRUB_DEFAULT=.*/GRUB_DEFAULT="Arch Linux ARM"/' /etc/default/grub
grub-mkconfig -o /boot/grub/grub.cfg
```

## Step 11: Create user with passwordless sudo

```bash
useradd -m -G wheel USER
passwd USER
echo "USER ALL=(ALL:ALL) NOPASSWD: ALL" >> /etc/sudoers
```

Replace `USER` with your username. Passwordless sudo is required — the omarchy install takes a long time and sudo's password cache expires during builds, causing failures.

## Step 12: Enable networking and SSH

```bash
tee /etc/systemd/network/20-wired.network << 'EOF'
[Match]
Name=enp0s5

[Network]
DHCP=yes
EOF

systemctl enable systemd-networkd
systemctl enable systemd-resolved
systemctl enable sshd
```

## Step 13: Exit chroot and reboot

```bash
exit
umount -R /mnt
reboot
```

## Step 14: Disconnect the ISO and configure display (Mac host)

Run these from a Mac terminal:

```bash
# Disconnect the archboot ISO so it doesn't interfere with boot
prlctl set omarchy --device-set cdrom0 --disconnect
```

## Step 15: First boot

The VM may show the UEFI firmware menu instead of GRUB. If so:

1. Select **Boot Manager**, choose the hard drive / GRUB entry
2. Or select **Continue** to follow the default boot order

GRUB should appear and auto-select "Arch Linux ARM". Log in with your user.

### If GRUB shows but has no "Arch Linux ARM" entry

Press `c` for the GRUB command line and boot manually:

```
linux (hd0,gpt1)/Image root=/dev/sda2 rw
initrd (hd0,gpt1)/initramfs-linux.img
boot
```

Then fix GRUB from inside the system (repeat Step 10's custom entry commands).

## Step 16: Verify networking

```bash
ping -c 2 archlinux.org
```

If DNS fails, fix resolv.conf again:

```bash
sudo rm -f /etc/resolv.conf
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

## Step 17: SSH from Mac (recommended)

Copy/paste doesn't work in the Parallels console until Parallels Tools are installed. SSH from the Mac host instead.

### Get the VM's IP address

```bash
prlctl list -f
```

Output shows the IP (e.g., `10.211.55.5`).

### SSH into the VM

```bash
ssh USER@<VM_IP>
```

### Useful prlctl commands reference

```bash
# Check VM status, IP, and resource usage
prlctl list -f

# Detailed VM configuration
prlctl list --info omarchy

# Stop / start / restart the VM
prlctl stop omarchy
prlctl start omarchy
prlctl restart omarchy

# Suspend and resume (saves state to disk)
prlctl suspend omarchy
prlctl resume omarchy

# Take a snapshot before risky operations
prlctl snapshot omarchy --name "before-omarchy-install"

# List snapshots
prlctl snapshot-list omarchy

# Restore a snapshot
prlctl snapshot-switch omarchy --id <SNAP_ID>

# Reconfigure resources (VM must be stopped)
prlctl set omarchy --cpus 6 --memsize 12288

# Attach/detach ISO images
prlctl set omarchy --device-set cdrom0 --image /path/to/file.iso --connect
prlctl set omarchy --device-set cdrom0 --disconnect

# Enable/disable high-resolution (Retina)
prlctl set omarchy --high-resolution on

# Delete the VM entirely
prlctl delete omarchy
```

## Step 18: Switch /tmp to disk-based storage

The default tmpfs /tmp is limited to 50% of RAM and will fill up during large AUR builds (e.g., CEF/Chromium). Switch to disk-based /tmp before installing omarchy:

```bash
sudo systemctl mask tmp.mount
sudo mkdir -p /tmp
sudo chmod 1777 /tmp
```

This persists across reboots and avoids "No space left on device" errors during the install.

## Step 19: Install omarchy

```bash
wget -qO- https://raw.githubusercontent.com/jondkinney/armarchy/amarchy-3-x/boot.sh | \
  OMARCHY_REPO=jondkinney/armarchy OMARCHY_REF=amarchy-3-x bash
```

This takes 30-60 minutes depending on your hardware. The installer will:

- Detect the Parallels VM and ask to mount Parallels Tools — go to **Actions > Install Parallels Tools** in the Parallels menu bar, then retry
- Install ARM-specific packages with custom build scripts
- Configure Hyprland with VM-appropriate rendering (Vulkan ICD, Zink/lavapipe)

If Signal Desktop Beta fails, prepend `SKIP_SIGNAL_DESKTOP_BETA=true`:

```bash
wget -qO- https://raw.githubusercontent.com/jondkinney/armarchy/amarchy-3-x/boot.sh | \
  SKIP_SIGNAL_DESKTOP_BETA=true OMARCHY_REPO=jondkinney/armarchy OMARCHY_REF=amarchy-3-x bash
```

## Step 20: Fix resolution after install

Without this, the VM boots at 1024x768.

### Enable Retina display from Mac host

```bash
prlctl set omarchy --high-resolution on
```

### GRUB kernel parameter (in VM)

Sets the framebuffer resolution at boot:

```bash
sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="loglevel=3 quiet video=Virtual-1:2560x1600@60"/' /etc/default/grub
sudo grub-mkconfig -o /boot/grub/grub.cfg
```

### Hyprland monitor config (in VM)

```bash
echo 'monitor=Virtual-1,2560x1600@60,auto,2' >> ~/.config/hypr/monitors.conf
```

Also set GDK_SCALE for GTK apps:

```bash
echo 'env = GDK_SCALE,2' >> ~/.config/hypr/monitors.conf
```

| Scale | Effective resolution | Best for |
|---|---|---|
| `2` | 1280x800 | Retina-crisp text, comfortable on 14" MBP |
| `1.5` | ~1707x1067 | More screen real estate, slightly less crisp |
| `1` | 2560x1600 | Maximum space, tiny text |

Adjust resolution to match your screen. For 16" MBP try `3456x2234@60`.

Press **Super+Esc** to relaunch Hyprland without rebooting, or reboot to apply both changes.

## Syncing ~/dev from Mac to VM

### First sync (from Mac host)

```bash
VM_IP=$(prlctl list -f | grep omarchy | awk '{print $3}')
rsync -avz --progress ~/dev/ thierry@${VM_IP}:~/dev/
```

### Subsequent syncs (only changed files)

```bash
VM_IP=$(prlctl list -f | grep omarchy | awk '{print $3}')
rsync -avz --progress --delete ~/dev/ thierry@${VM_IP}:~/dev/
```

The `--delete` flag removes files on the VM that no longer exist on the Mac. Omit it if you want to keep VM-only files.

### Exclude patterns

To skip large or unwanted directories:

```bash
VM_IP=$(prlctl list -f | grep omarchy | awk '{print $3}')
rsync -avz --progress --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'target' \
  --exclude '.venv' \
  ~/dev/ thierry@${VM_IP}:~/dev/
```

### Sync from VM back to Mac

```bash
VM_IP=$(prlctl list -f | grep omarchy | awk '{print $3}')
rsync -avz --progress thierry@${VM_IP}:~/dev/ ~/dev/
```

### Quick alias (add to Mac ~/.zshrc)

```bash
alias sync-to-vm='VM_IP=$(prlctl list -f | grep omarchy | awk "{print \$3}") && rsync -avz --progress --delete --exclude node_modules --exclude .git ~/dev/ thierry@${VM_IP}:~/dev/'
alias sync-from-vm='VM_IP=$(prlctl list -f | grep omarchy | awk "{print \$3}") && rsync -avz --progress thierry@${VM_IP}:~/dev/ ~/dev/'
```

## Post-install configuration

### Browser

Chromium doesn't work on aarch64. Omarchy installs omarchy-chromium-bin as a replacement. If it doesn't work, install Brave:

```bash
yay -S brave-bin
```

### Apple keyboard mapping

Edit `~/.config/hypr/hyprland.conf`, keyboard section:

```
kb_layout = us
kb_variant = mac
kb_model = apple
```

### Super key (Caps Lock remap)

On the Mac, install [Karabiner-Elements](https://karabiner-elements.pqrs.org/) and remap Caps Lock to F16.

In the VM, install keyd:

```bash
yay -S keyd
sudo tee /etc/keyd/default.conf << 'EOF'
[ids]
*

[main]
f16 = leftmeta
EOF
sudo systemctl enable --now keyd
```

## Troubleshooting

### Password reset via GRUB

If you get locked out, reboot and at the GRUB command line (`c`):

```
linux (hd0,gpt1)/Image root=/dev/sda2 rw init=/bin/bash
initrd (hd0,gpt1)/initramfs-linux.img
boot
```

Then: `passwd USER && sync && reboot -f`

### AUR build failures

AUR mirrors have intermittent outages. If builds fail with 404 errors, wait and retry. The installer has a retry option.

### gtk-engine-murrine failure

Known flaky AUR package. Retry usually fixes it.

## References

- [GitHub Discussion #452](https://github.com/basecamp/omarchy/discussions/452) — community installation notes
- [jondkinney/armarchy](https://github.com/jondkinney/armarchy/tree/amarchy-3-x) — ARM support fork
- [PR #1897](https://github.com/basecamp/omarchy/pull/1897) — upstream ARM support (not yet merged)
