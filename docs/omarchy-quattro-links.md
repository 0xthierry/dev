# Quattro pre-upgrade symlink review (3.8.5 → stable 4.5.0)

**This is not upgrade clearance. No live links were detached.** The preflight is
read-only, is not called by `setup.sh`, and has no apply/detach flag. Do not run
setup to prepare this boundary: it can put repository links back. Post-upgrade
`apply_hypr` and the final relink/cutover are a separate integration step.

## Reproduce the inventory

```bash
# From the root of the separate Quattro candidate checkout, not the live 3.x checkout:
python3 scripts/omarchy-quattro-preflight.py \
  --home "$HOME" \
  --bridge "$HOME/.local/share/omarchy/bin/omarchy-upgrade-to-quattro" \
  --upstream /path/to/omarchy-v4.5.0
```

Use `--json` for all links, their logical paths (`observed_via`), scope provenance,
and candidate paths. Exit 0 means **report produced**, never safe to upgrade.
The report contains filenames/link targets, not config contents; treat saved
reports as private. It never executes/sources upstream or bridge code. Traversal
is read-only and follows directory links to detect nested links, including links
in the target's parent components. Dangling links, cycles, permission failures,
and traversal limits are visible; missing ordinary paths are not failures.

The candidate footprint combines bridge hash-table entries, always-copy entries,
literal HOME/TARGET_HOME references (including reads), and every upstream config
file/link. It deliberately over-approximates conditions and retirement exclusions.
A broader scope inventory includes `.config`, state, launchers, keyrings, legacy
Omarchy, shell startup files and the four Omarchy skill paths. Links in broad
scopes are **review candidates, not demonstrated write-through defects**.

## Reviewed sources and confirmed reachability

Read-only host inspection on 2026-11-22:

- Legacy checkout: `v3.8.4-5-gf4378f0d`, `version` = `3.8.5`.
- Bridge SHA-256:
  `57ec1e8ae249e4e96ec33ddcf5d66cc2216863b62dfc7e9a8d81c53b00eebbd4`.
- Pristine package source: tag `v4.5.0`, commit
  `ac2690cd7be4f47e4a255f5e2e78d904d436b068`. Its `version` file still
  says `4.0.0.alpha`; the git tag/commit, not that stale file, identifies this review.
- The first 20,000-entry-per-subtree scan reported 321 links / 154 candidate
  paths. BraveSoftware, Claude, Slack and chromium hit traversal limits. These
  are unresolved inventory gaps, not clean results; counts can change live.

Bridge references below are to `bin/omarchy-upgrade-to-quattro` at the hash above.

| Reachable operation | Host overlap / consequence |
|---|---|
| `copy_config_default` (1693–1707), `copy_missing_config_defaults` (1710–1722), `always_copy_config_files` (1631–1642) | `~/.config/hypr` points to `/home/thierry/dev/configs/hypr`. Always-installed Lua entry points and missing package defaults create/replace files **inside the repository**, even though each leaf is not a symlink. |
| `replace_legacy_current_path` and its six callers (2121–2153) | Python `Path.write_text` follows the leaf symlink and writes even when replacement makes no textual change. `~/.config/ghostty/config` points to `/home/thierry/dev/configs/ghostty/config`; Hypr's parent link is also affected. These are confirmed unsafe write-through paths. |
| Chromium flags repair / profile Preferences repair (1753–1860) | Leaf aliases and browser-profile directory aliases matter. The host `brave-origin-beta-flags.conf -> brave-flags.conf` is a real relative alias; browser preference globs are dynamic. Close browsers for any eventual repair; do not detach browser lock/socket links. |
| Agent skill `ln -sfn` (2023–2029) | Replaces `.agents`, `.claude`, `.codex`, `.pi/agent` Omarchy skill links. All four currently point into `~/dev/configs/agents/skills/omarchy`. Leaf replacement alone does not overwrite that source, but loses the repo-managed link until explicitly restored. Parent directory aliases could change that conclusion. |
| `.config/omarchy/current` move/copy, theme link regeneration (2107–2158); headless theme refresh (2335–2385) | Current-theme links are intentional generated state. Do not turn them all into copies. The bridge also writes the live legacy `hyprland.conf` theme shim in the new state tree. |
| Cleanup shims/overlay (921–1054), retired configs/services, app/icon refresh (2218–2288) | Parent aliases can redirect mkdir/copy/move/remove operations. Retired UI directories are moved, not simply overwritten. Legacy-root backups and generated shims must remain available until reboot/cutover review. |
| Startup, keyring, bookmarks, Nautilus, WirePlumber, units (1908–2250) | Writes extend beyond Hypr and package `config/`; a defaults-only intersection is insufficient. |

For package-default consumers, inspect `../upstream/bin/omarchy-theme-set`,
`omarchy-theme-set-templates`, `omarchy-refresh-applications`, `omarchy-bar`,
`omarchy-shell-config`, `omarchy-migrate`, and the selected migration scripts.
Headless theme mode is not proof of no writes: it still stages/render themes and
runs non-visible configuration helpers. Never execute these tools to discover
writes against the live HOME.

## Mandatory unresolved review gates

- A shell token extractor is not a shell interpreter. Variables, sourced helpers,
  glob expansion, migration eligibility, package hooks and user-defined hooks
  have **unknown/dynamic footprints**. A different bridge hash requires a fresh
  full review. An unchanged hash does not clear the dynamic gates.
- Stable package repositories move. Verify the actual packages selected at
  execution time against the reviewed source; `--channel stable` does not pin
  `v4.5.0`. No packages or bridge commands were installed/run in this rehearsal.
- Review custom XDG/OMARCHY paths and environment, system `/etc`, `/usr`, `/boot`,
  `/var`, `/run` writes, mounts/bind aliases, hard links, permissions/ACLs and
  available disk space separately. The reporter does not certify those.
- Resolve every `INCOMPLETE` for the relevant destinations (raise `--max-entries`
  or inspect the omitted subtree explicitly). Inspect backup names too: an
  existing backup symlink can redirect a later backup write.
- Keep an independent, tested system/data backup. The bridge's own snapshot and
  per-file backups are not sufficient proof of repository protection. Record
  repository diff/status before and after; do not stage or discard unrelated work.
- **Never blanket-detach** `.config`, `.local`, a whole home, service masks such
  as `/dev/null`, browser locks, theme links, or every link in this report. Review
  each actual operation: leaf `rm`/`mv` versus write-through have different risks.

## Manual, specific, reversible detachment runbook

This procedure is for a later explicitly approved maintenance window, **not for
this read-only review**. Rehearsal tests use only a temporary fake HOME. Stop
installers, theme changes and other writers; work from a terminal not sourcing
files being swapped. The two renames are not a transaction and readers may
observe a short gap. If exclusive access cannot be established, stop. Do not
claim this protects against an adversarial concurrent writer.

1. Review the fresh inventory and source content. The currently confirmed choices
   are only `~/.config/hypr` (directory link) and
   `~/.config/ghostty/config` (file link). Decide separately about other findings.
2. In a fresh **Bash** shell, select **one** exact link and its observed target;
   never use a report-fed loop. Set either pair:

   ```bash
   LINK="$HOME/.config/hypr"
   EXPECTED_TARGET=/home/thierry/dev/configs/hypr
   # OR, in a separate invocation after reviewing it:
   # LINK="$HOME/.config/ghostty/config"
   # EXPECTED_TARGET=/home/thierry/dev/configs/ghostty/config
   ```

3. Run the block below only after authorization. It refuses parent aliases,
   unexpected targets, dangling links, special files, cycles, existing backups
   and changed selection. Nested valid file/directory links are dereferenced
   into independent copies; review that semantic change first. Dangling nested
   links abort the copy without moving the active link. GNU `cp`, `find`, `diff`,
   `mv` and `realpath` are required on this Linux host.

<!-- materialize-rehearsal:start -->
```bash
set -euo pipefail
: "${LINK:?select one link}" "${EXPECTED_TARGET:?record its literal target}"
case "$LINK" in
  "$HOME/.config/hypr"|"$HOME/.config/ghostty/config") ;;
  *) echo 'Not one of the two reviewed paths' >&2; exit 1 ;;
esac
parent=$(dirname -- "$LINK")
[[ $(realpath -e -- "$parent") == "$parent" ]]  # no HOME/.config/parent alias
[[ -L $LINK && $(readlink -- "$LINK") == "$EXPECTED_TARGET" ]]
[[ -e $LINK ]]  # no dangling root
BACKUP="$LINK.pre-quattro-link"
[[ ! -e $BACKUP && ! -L $BACKUP ]]
special=$(find -L "$LINK" ! -type d ! -type f -print)
[[ -z $special ]]  # cycles/find errors also fail under set -e
STAGE=$(mktemp -d -- "$parent/.quattro-stage.XXXXXXXX")
printf 'Stage: %s\nOriginal link backup: %s\n' "$STAGE" "$BACKUP"
# On failure, retain the printed stage for inspection; never auto-delete data.
cp -aL -- "$LINK" "$STAGE/materialized"
[[ -z $(find "$STAGE/materialized" -type l -print) ]]
diff -r -- "$LINK" "$STAGE/materialized"
[[ -L $LINK && $(readlink -- "$LINK") == "$EXPECTED_TARGET" ]]
[[ ! -e $BACKUP && ! -L $BACKUP ]]
mv -T -- "$LINK" "$BACKUP"
mv -T -- "$STAGE/materialized" "$LINK"
rmdir -- "$STAGE"
[[ ! -L $LINK && -e $LINK && -L $BACKUP ]]
printf 'Detached only %s; retained original link at %s\n' "$LINK" "$BACKUP"
```
<!-- materialize-rehearsal:end -->

4. Verify bytes/modes and all nested links of the materialized path, original
   repository unchanged, original link target recorded in `BACKUP`. Rerun
   preflight; backups will still be reported. Review their provenance rather
   than deleting them to make a report look clean. Do not run setup before the
   bridge: it may restore the dangerous links.
5. If interruption occurred after the first rename, do not rerun blindly. Inspect
   the printed `BACKUP` and `STAGE`; if `LINK` is absent, move the original link
   back from `BACKUP` or finish the reviewed second rename. Never overwrite an
   unexpected new `LINK`. Preserve all paths until the incident is understood.
6. To undo **before the upgrade**, or after an explicit post-upgrade reconciliation,
   preserve the entire materialized copy (including any new changes) and restore
   the original symlink. Use the same `LINK`/`EXPECTED_TARGET` selection:

<!-- restore-rehearsal:start -->
```bash
set -euo pipefail
: "${LINK:?select reviewed link}" "${EXPECTED_TARGET:?record its literal target}"
case "$LINK" in
  "$HOME/.config/hypr"|"$HOME/.config/ghostty/config") ;;
  *) exit 1 ;;
esac
[[ $(realpath -e -- "$(dirname -- "$LINK")") == "$(dirname -- "$LINK")" ]]
BACKUP="$LINK.pre-quattro-link"
POST="$LINK.post-quattro-copy"
[[ -L $BACKUP && $(readlink -- "$BACKUP") == "$EXPECTED_TARGET" && -e $BACKUP ]]
[[ ! -L $LINK && -e $LINK ]]
[[ ! -e $POST && ! -L $POST ]]
mv -T -- "$LINK" "$POST"
mv -T -- "$BACKUP" "$LINK"
[[ -L $LINK && -e $POST ]]
printf 'Restored %s; preserved materialized content at %s\n' "$LINK" "$POST"
```
<!-- restore-rehearsal:end -->

A checkout of the Quattro branch does not contain `configs/hypr/`. For a deliberate rollback to 3.x, first restore the matching pre-cutover repo revision (or recover its tree from backup) and confirm the saved link resolves, **before** moving the working desktop config. On Quattro never restore that whole-directory link; use the separate `apply_hypr` deployment. This rollback restores
only link topology; it does **not** downgrade Omarchy or undo package migrations.

## Verification boundary

```bash
python3 tests/omarchy-quattro-preflight.test.py
python3 scripts/omarchy-quattro-preflight-rehearse.py \
  --bridge "$HOME/.local/share/omarchy/bin/omarchy-upgrade-to-quattro" \
  --upstream /path/to/omarchy-v4.5.0
```

The second command refuses any other bridge checksum, extracts only
`backup_config_file`, `copy_config_default`, and `replace_legacy_current_path`,
and runs those exact functions before/after the runbook on a newly created fake
HOME and fake repository. It accepts no HOME override, uses a clean shell
environment, runs no package/service/upgrade entry point, and cleans its own
fixture. The observed result was: before detachment the fake repository gained
`hyprland.lua` and its `.conf` was rewritten; after materialization only the fake
HOME changed and the fake repository remained unchanged.

The tests invoke the report CLI and the exact two runbook blocks on a real,
isolated filesystem. They cover directory/leaf/nested/dangling links, target
parent aliases, cycles, unknown bridge sources, traversal limits, no report
mutation, copy independence and reversal without discarding changed copies.
They do not run the upgrade, install packages, restart services, or prove live
cutover compatibility. The bridge write-through reproduction is a deliberately
narrow filesystem check, not a mocked full-upgrade claim.
