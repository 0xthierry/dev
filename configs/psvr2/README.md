# PSVR2Toolkit on Omarchy

Run `./setup.sh omarchy` to install the pinned, SHA256-verified Ignition v1.1.0, PSVR2Toolkit v1.0.0-experimental-2 (wrapper and CAPIApps), and UnitySetup v1.1.0 releases under `~/.local/share/psvr2`. The launcher is `~/.local/bin/psvr2`. This setup never downloads Sony files: install **SteamVR** (`steam://install/250820`), **Proton Experimental**, and **PlayStation VR2 App** (`steam://install/2580190`) from native Steam. Missing Sony app leaves setup successful but **pending**; after Steam installs it, stop SteamVR and run `psvr2 configure`. Configuration requires Proton Experimental (`steam://install/1493710`) and uses a separate `~/.local/share/psvr2/proton-prefix`, rather than the upstream launcher's shared prefix or automatic Proton fallback. The parent host setup provides Linux USB/udev prerequisites and SteamVRLinuxFixes separately.

- `psvr2 doctor`: report releases, app, preserved original, and SteamVR process state.
- `psvr2 configure`: with SteamVR stopped, preserve Sony's `driver_playstation_vr2.dll` as `driver_playstation_vr2_orig.dll`, install the Toolkit wrapper and all five accompanying win64 support libraries (backing up changed existing files), configure Ignition, register the external driver via SteamVR `vrpathreg.sh`, and merge `enableLinuxVulkanAsync` / `useFacetRenderer` into `steamvr.vrsettings`. Changed settings and pre-existing Ignition files receive numbered `.bak` copies. Configure accepts `--driver-dir`, `--vrpathreg`, `--settings` for a nondefault Steam library. Supply all three paths if SteamVR and Sony app are outside the usual default library.
- `psvr2 openxr`: select SteamVR as the native OpenXR runtime, preserving any previous selection in a numbered `.bak`. Also runs during `configure`. This is required by OpenXR games such as Beat Saber through Proton. It can run while SteamVR is open; restart the game afterward. Supports `--runtime /path/to/SteamVR/steamxr_linux64.json` for a nondefault library and honors `XDG_CONFIG_HOME`.
- `psvr2 room-setup`: launch the pinned Unity room setup for position tracking after SteamVR and the driver work.
- `psvr2 start`: launch SteamVR through Steam. Check `~/.steam/steam/logs/vrserver.txt` and `vrcompositor.txt` on failures.

## Custom songs and BSManager

Omarchy installs `bs-manager-bin`. Use Proton Experimental in BSManager and keep
modded copies separate from the working Steam installation. BeatMods currently
provides SongCore, BetterSongSearch and BeatSaverDownloader for 1.40.8; recheck
compatibility before choosing another version.

The AUR 1.6.0-1 recipe strips its bundled .NET `DepotDownloader`, causing exit 159
with `Arithmetic overflow while reading bundle`. `install/bs-manager.sh` repairs
only the exact known damaged binary using the checksum-verified official RPM,
backs it up, and atomically restores the unstripped executable. Omarchy runs this
through its `bs-manager` config target after package installation. Other binary
versions are left unchanged. `pacman -Qkk bs-manager-bin` will consequently report
the repaired file as different from the broken package; this is intentional.
Retire the workaround once the upstream AUR package disables stripping.

**Steam updates:** The first configuration keeps Sony's DLL at `_orig.dll`. A later Steam update may replace the Toolkit wrapper with a new Sony DLL. Configuration deliberately **refuses** to overwrite either file in that state: inspect the current DLL and `_orig.dll`, back up the old `_orig.dll` yourself, then move the new Steam DLL to `_orig.dll` before rerunning `psvr2 configure`. Do not discard either original without knowing what it contains. Never run configure while `vrserver` or `vrcompositor` is active. This setup does not flash firmware, jailbreak hardware, or run Sony's Windows-only apps. Upstream warns that Linux Room View and controller poll-rate support are limited; headset firmware must already be PC-compatible (v5.00 or later). See the [upstream Linux guide](https://github.com/BnuuySolutions/PSVR2Toolkit/wiki/Linux-support).
