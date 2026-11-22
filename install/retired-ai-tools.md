# Retired AI CLI opt-out

Setup no longer installs or configures Amp, Cursor Agent, Grok CLI, or OpenCode.
Cursor editor and xAI models in Pi remain supported. Existing binaries, sessions,
credentials, and other user data are not deleted by setup.

Quattro can declare these tools as lazy mise tools in its vendor configuration.
Apply the supported per-user opt-out without running the rest of setup:

```sh
bash install/retired-ai-tools.sh --dry-run
bash install/retired-ai-tools.sh
```

The helper requires Python 3.11+ and a mise version supporting
`mise settings set --override` and `mise config set --override` (verified with
mise 2026.11.12). It unions `amp`, `cursor-agent`, `grok`, and
`opencode` with the effective disabled tools, then writes `disable_tools`
in mise's global `config.override.toml`. Other override settings/comments and
the existing user and vendor configuration are preserved. Setup applies it
before writing its baseline mise configuration, so subsequent setup runs retain
the opt-out. Repeated execution is byte-idempotent.

## Distro Grok command wrapper

`disable_tools` does **not** disable mise command wrappers. When the stock
`/etc/mise/conf.d/omarchy-agent-accounts.toml` declares `wrappers.grok`, the helper
also writes `wrappers.grok = "/usr/bin/false"` into the global override. It honors
`MISE_SYSTEM_CONFIG_DIR` for isolated fixtures/custom system configuration roots.
The override replaces only Grok's wrapper; other agent/account wrappers remain
unchanged. An existing different user override for `wrappers.grok` causes an
explicit error before any writes, requiring manual reconciliation rather than
silently taking ownership. Without the stock declaration no wrapper is added.

**Limitation:** `grok` can still appear in `command -v` and mise still manages its
wrapper file. Invoking that wrapper exits 1 instead of launching the account
manager or installing Grok. It intentionally prints no message. Removing the
wrapper file by hand is ineffective: activation recreates it. Both normal
activation and `activate --shims` are covered by the offline fixture, including
a retained working wrapper and an account-manager sentinel that must not run.

This does not block an explicit account-manager invocation, absolute binary,
arbitrary shell alias/function, npm package, or system package command. Restart
an already activated shell after retiring its binaries. Existing hook files and
user data are retained, but Herdr/Moshi setup no longer refreshes retired
integrations. If the distro changes the wrapper filename, re-audit this gate.

References: [mise command wrappers](https://mise.jdx.dev/dev-tools/shims.html#command-wrappers)
and [configuration precedence](https://mise.jdx.dev/configuration.html#how-config-files-combine).
The documented wrapper schema has command/args/env rather than a per-wrapper
disable flag; this uses the supported command override, not a vendor-file patch.

### Existing machines (explicit retirement, not automatic deletion during setup)

- Run `python3 scripts/retire-apps.py` to preview recognized user binaries and aliases, then `python3 scripts/retire-apps.py --apply` after closing the affected programs. Payloads are moved under `~/.retired-apps/` for recovery. This does not reclaim those bytes, and does not delete accounts, notes, credentials or session history. A surviving Grok mise wrapper on Quattro is expected only if it fails closed as described above. Don't run Quattro setup over an active legacy-linked desktop to uninstall apps.
- Mac: inspect `brew list --cask`; uninstall only installed exact casks among `obsidian`, `grok-bot`, and the old `cursor-cli` using `brew uninstall --cask <name>` **without** `--zap`. Do not uninstall the `cursor` editor. If a different provider installed a copy, verify its bundle/package identity before removal. For older npm installs, inspect `npm ls -g --depth=0` in the relevant Node prefix, then uninstall only confirmed retired package names in that same prefix. No remote Mac or unknown vault path should be assumed.
- Quattro: after removing Obsidian, `scripts/retire-desktop-shortcuts` retires the stock Obsidian and Grok web shortcuts without editing vendor defaults. It backs up and only rewrites a recognized stock bindings file. Customized setups should apply the equivalent unbinds explicitly. Then run `hyprctl reload` and check `hyprctl configerrors`. Keep upstream OS files intact; a future full distribution reinstall or reset can restore vendor apps, so recheck after such an operation.
- Standard setup does not purge user data or uninstall packages. In particular it must never discover and delete a notes vault on another machine. The separate, explicitly requested deletion on this workstation is not part of setup.

Offline fixture verification (real mise, isolated HOME and vendor fixture):

```sh
python3 tests/retired-ai-tools.test.py
bash tests/ai-cli.test.sh
```
