# Pinned Claude Desktop / Code and staged snapshot patch

## Current status — patch deployment is blocked

**Version pinning works. The Desktop snapshot patch is NOT installed.**

The exact ASAR change is reproducible and integrity-checked. A complete patched
copy also passed `codesign --verify --deep --strict`. However, a contained macOS
startup test killed the ad-hoc-signed executable before JavaScript ran:

```text
Restricted entitlements not validated, bailing out.
AMFI: bailing out because of restricted entitlements.
```

The vendor app has restricted team/application/Keychain entitlements. Preserving
those entitlements under ad-hoc signing is not enough for macOS to permit launch.
The installer therefore **refuses patch deployment before changing the app or
settings**, even with an explicitly prepared candidate. Do not delete the block
marker merely to get past the error, strip authentication entitlements, disable
AMFI/Gatekeeper/SIP, or disable Electron's integrity fuses. A working alternative
must be implemented and runtime-tested first. A native SDK-protocol proxy is a
possible future design, not included here.

The installed vendor application, its valid signature, existing sessions and
credentials were left unchanged. Closing Desktop does NOT resolve this signing
blocker. The shell's `claude()` snapshot-off default remains a separate working
terminal-only setting.

## Version pins and normal setup

`release.json` is the public download/version/signing manifest:

- Desktop **4.23118.1**, official universal ZIP URL and exact SHA-256.
- Code **2.1.321**, the exact Desktop-pinned release commit, compressed bundle
  sizes/hashes and executable hashes for Darwin arm64 and x86_64.
- Vendor signing team and Desktop identifier, entitlements hash, runtime version
  and signing flags.

`manifest.json` additionally pins the original and patched ASAR, raw JSON header,
modified member and Info.plist bytes. An unsupported or changed build is refused;
setup does not silently upgrade, downgrade, or patch a similar-looking release.

```sh
./setup.sh macbook
```

The macbook package layer installs `zstd`. Its AI CLI installer downloads the
checksum-pinned, signed Code `.app.tar.zst` directly; it does not execute a mutable
`install.sh`. The CLI symlink points at the same checksum-keyed managed executable
path Desktop selects:

```text
~/Library/Application Support/Claude/claude-code/2.1.321/<bundle-hash-prefix>/claude.app/Contents/MacOS/claude
```

Existing launchers are backed up before replacement. Existing engine slots must
pass their executable hash, vendor signature, checksum marker and version checks;
unknown populated slots are not merged or overwritten. Downloads use the version
component in the pinned release URL as Desktop does. Tar paths/types/links are
validated and extracted through Python's `data` filter.

The macbook config target `claude-desktop-pinned` installs the original vendor
Desktop only when absent. Existing apps must match the original pins. Claude is
removed from the macbook Homebrew cask list and explicit upgrade list, so setup
cannot independently replace this pinned app. This does not prevent an explicit
manual Homebrew upgrade or another external updater; rerun status after one.

The updater policy helper preserves the selected local provider profile and adds
only `disableAutoUpdates: true`, with a backup. On a new profile it creates a
minimal named policy entry. Nonempty `hybridPointer` is refused because the vendor
reader would bypass this local profile. CLI update-disable and nonessential
traffic flags remain in the repo's `configs/agents/claude-settings.json`.

No Linux package/version behavior is changed. The standalone Linux CLI keeps its
existing pin. Pinned versions postpone upstream fixes and may eventually stop
supporting a server-side model; updates require deliberate re-audit.

Targeted, repeatable commands (no whole-machine setup):

```sh
python3 scripts/claude_desktop_code_install.py
bash install/claude-desktop-patch.sh  # pins ORIGINAL Desktop; does not install patch
python3 scripts/claude_desktop_snapshot_install.py status
```

## Reproduce the patch without deployment

```sh
python3 scripts/claude_desktop_snapshot_install.py prepare
```

This creates a private staging copy, applies the exact patch and integrity
metadata, and re-signs it locally while preserving original entitlements. It
reports `prepared-not-installed` and the known deployment blocker. It does not
launch the app. Staging is for inspection; the current candidate will not pass
macOS launch authorization. Staging directories are retained for inspection and
are about 1 GB each; avoid repeated preparations when disk space is limited.

For an explicitly supplied disposable bundle:

```sh
python3 scripts/claude_desktop_snapshot_patch.py check \
  --app /path/to/staging/Claude.app \
  --manifest configs/claude-desktop-patch/manifest.json
python3 scripts/claude_desktop_snapshot_patch.py apply \
  --app /path/to/staging/Claude.app \
  --manifest configs/claude-desktop-patch/manifest.json
```

The low-level patcher refuses installed application directories, symlinked target
paths and hardlinked target files. It preserves all unrelated member bytes,
unpacked metadata, shared payload spans, gaps and trailing bytes. It updates only
the target contents, its integrity hashes, subsequent offsets, and the ASAR-header
hash in Info.plist. A second apply is a verified no-op. Interrupted mixed staging
states are refused; discard/re-copy staging instead of adopting unknown data.

## What the patch changes

For the local backend, after Desktop's existing prompt-normalization steps, set:

```js
options.systemPrompt.snapshot = false;
```

The exact minified anchor is in the manifest. The placement deliberately preserves
Desktop's host-side appended-prompt snapshots, saved tool choices and environment
normalizers. It does not turn off the global feature gate. Desktop's host append
snapshot and the engine's whole-system-prompt snapshot are different mechanisms.

SDK initialization maps this option to `request.systemPromptSnapshot`. Real-engine
protocol tests established that this first initialize Boolean overrides the CLI
option. Later reinitialize calls do not change it. A successful future deployment
must start a new engine process, including when resuming saved history.

This is not a custom replacement prompt, permission bypass, backend modification,
or claim that every client instruction is removed. The shared exact-string filter
has its own prompt-surface limits.

## Checks and known limits

```sh
python3 tests/claude-desktop-snapshot-patch.test.py
python3 tests/claude-desktop-install.test.py
bash tests/ai-cli.test.sh
bash tests/shell.test.sh
bash -n setup.sh install/*.sh install/hosts/*.sh
shellcheck setup.sh install/*.sh install/hosts/*.sh
./setup.sh macbook --dry-run
```

Verified in the implementation session:

- 33 patcher fixture tests; 15 installer/policy tests.
- Actual vendor archive apply/noop: 1,003 entries preserved, including all 994
  non-target packed member contents, eight unpacked entries and 44 shared spans.
- Full private bundle staging, integrity verification and signature verification.
- Actual fresh arm64 Code download, checksum, extraction, vendor signature,
  version probe and shared CLI link in an isolated HOME.
- Intel bundle downloaded and checksum-verified to derive its executable hash;
  its executable was not run on Intel hardware.
- Actual macOS startup rejected the staged ad-hoc build; no production replacement.
- Pin command succeeds against the original installed app; patch install and
  restore commands refuse before state creation. No authenticated patched GUI
  conversation was run.

Pyright LSP diagnostics were blocked by a local mise version mismatch:
`pyright-langserver` is installed for Node 26.3.0, not the active Node 26.13.0.
Install it through the repo-managed tooling for the active Node version, or set
`PI_PYRIGHT_LSP_COMMAND` to a compatible installed server. This is not a passing
static-type check.

The broader `tests/agents-install.test.sh` suite stopped when its isolated HOME
made mise reject the existing global config as untrusted; no trust settings were
changed. The `dev` and `omarchy` setup dry-runs stop at the existing Linux-only
Cua Driver check on this Mac. The affected Claude tests, AI CLI/shell tests,
ShellCheck, shell syntax, Python compilation and macbook dry-run passed.
