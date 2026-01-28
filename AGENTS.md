# Nix Home Manager Configuration

Reproducible development environment using Nix Flakes for multi-machine setup (omarchy: desktop, dev: VM, macbook: future).

## Structure

```
flake.nix          # Multi-machine entrypoint
home.nix           # Main Home Manager config
common/            # Shared modules (cli-tools, git, zsh, mise, neovim)
hosts/             # Machine-specific configs
configs/           # Editable symlinked configs (nvim, claude, zellij, hypr)
install/           # Bootstrap scripts (idempotent)
```

## Key Constraints

- **Never modify flake.lock directly** - use `nix flake update` with review
- **Use mkOutOfStoreSymlink** for editable configs to preserve Git repos
- **Bootstrap must be idempotent** - safe to re-run
- **Desktop apps use pacman** on omarchy, not Nix (avoid conflicts)
- **SSH keys not in Nix** - handled via 1Password

## Testing Changes

```bash
# Check flake syntax
nix flake check

# Test on dev VM first
home-manager switch --flake .#dev

# Then apply to desktop
home-manager switch --flake .#omarchy

# Verify symlinks
ls -la ~/.config/nvim
```

## Common Tasks

| Task | Command |
|------|---------|
| Add CLI tool | Edit `common/cli-tools.nix`, add to `home.packages` |
| Add runtime version | Edit `common/mise.nix`, update config.toml content |
| Machine-specific app | Edit `hosts/{machine}.nix` |
| New editable config | Use `config.lib.file.mkOutOfStoreSymlink` pattern |

## Claude Code Integration

Hooks and skills in `configs/claude/` use **Bun + TypeScript**:
- Run tests: `cd configs/claude/hooks && bun test`
- Lint: `bun run lint`
- Style: @antfu/eslint-config

## Documentation

- `docs/references/` - Deep dives on Nix, Home Manager, tools
- `course/` - 10-chapter Nix/Home Manager tutorial
- `ai_docs/plans/` - Implementation plans (use writing-plans skill)
- Home Manager options: https://home-manager-options.extranix.com

## Patterns

1. **Modular**: Shared config in `common/`, overrides in `hosts/`
2. **Symlinks**: Complex configs (nvim, claude, zellij) symlinked for editability
3. **Mise for runtimes**: Node, Python, Go, Bun, Rust, Zig managed separately from Nix
4. **Linux only**: Uses `targets.genericLinux.enable = true` for Arch
