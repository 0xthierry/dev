#!/usr/bin/env python3
"""Filesystem integration fixtures for the repo-owned PSVR2 launcher."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
COMMAND = REPO / "configs/psvr2/psvr2"


class PSVR2SetupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="psvr2 fixture ")
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name) / "Home with spaces"
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), XDG_DATA_HOME=str(self.home / ".local/share"), XDG_CONFIG_HOME=str(self.home / ".config"))
        self.root = self.home / ".local/share/psvr2"
        self.driver = self.home / ".local/share/Steam/steamapps/common/PlayStation VR2 App/SteamVR_Plug-In"
        self.win = self.driver / "bin/win64"
        self.linux = self.driver / "bin/linux64"
        self.settings = self.home / ".local/share/Steam/config/steamvr.vrsettings"
        self.registry = self.home / ".local/share/Steam/steamapps/common/SteamVR/bin/vrpathreg.sh"
        self.wrapper = self.root / "releases/toolkit-v1.0.0-experimental-2/driver_playstation_vr2.dll"
        self.ignition = self.root / "releases/ignition-v1.1.0"

    def run_command(self, *args, check_active=False):
        # Filesystem fixtures must not depend on the user's live VR session.
        # The dedicated active-process test exercises the real /proc guard.
        if check_active:
            command = [sys.executable, str(COMMAND), *args]
        else:
            bootstrap = """import importlib.machinery, importlib.util, sys
path = sys.argv.pop(1)
loader = importlib.machinery.SourceFileLoader('psvr2_fixture', path)
spec = importlib.util.spec_from_loader(loader.name, loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
module.active_steamvr = lambda: False
module.main()
"""
            command = [sys.executable, "-c", bootstrap, str(COMMAND), *args]
        return subprocess.run(command, env=self.env, capture_output=True, text=True)

    def fixture(self):
        self.win.mkdir(parents=True)
        (self.driver / "driver.vrdrivermanifest").write_text('{"name":"playstation_vr2"}')
        (self.win / "driver_playstation_vr2.dll").write_bytes(b"Sony Steam DLL v1")
        self.wrapper.parent.mkdir(parents=True)
        self.wrapper.write_bytes(b"Toolkit wrapper")
        for name in ("libusb-1.0.dll", "psvr2_toolkit_capi.dll", "libcrossipc.so", "libcrossipc.dll", "libpsvr2_toolkit_capi.so"):
            (self.wrapper.parent / name).write_bytes(("Toolkit " + name).encode())
        self.ignition.mkdir(parents=True)
        for name in ("libdriver_ignition.so", "ignition_server.exe", "proton", "launch_serverhelper.sh", "wine_hidraw.reg"):
            (self.ignition / name).write_bytes(("Ignition " + name).encode())
        proton = self.home / ".local/share/Steam/steamapps/common/Proton - Experimental/proton"
        proton.parent.mkdir(parents=True)
        proton.write_text("#!/usr/bin/env bash\n")
        self.registry.parent.mkdir(parents=True)
        self.registry.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$1" "$2" >> "$HOME/vrpathreg.log"\nmkdir -p "$HOME/.config/openvr"\nprintf \'{"external_drivers":["%s"]}\\n\' "$2" > "$HOME/.config/openvr/openvrpaths.vrpath"\n')
        self.registry.chmod(0o755)
        self.manifest = self.registry.parent.parent / "steamxr_linux64.json"
        self.manifest.write_text(json.dumps({"runtime": {"name": "SteamVR", "library_path": "bin/linux64/vrclient.so"}}))
        library = self.registry.parent / "linux64/vrclient.so"
        library.parent.mkdir()
        library.write_bytes(b"fixture runtime")
        self.settings.parent.mkdir(parents=True)
        self.settings.write_text('{"steamvr":{"showMirrorView":false},"other":{"keep":12}}\n')

    def test_configure_preserves_sony_and_settings_with_space_paths(self):
        self.fixture()
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Toolkit wrapper")
        self.assertEqual((self.linux / "driver_playstation_vr2.so").resolve(), self.ignition / "libdriver_ignition.so")
        ignition_config = json.loads((self.linux / "ignition.json").read_text())
        self.assertEqual(ignition_config["driver_dll"], "../win64/driver_playstation_vr2.dll")
        self.assertEqual(ignition_config["wine_cmd"], ["/usr/bin/env", "PROTONVERSION=Proton - Experimental", f"PROTONPREFIX={self.root / 'proton-prefix'}", "./launch_serverhelper.sh"])
        self.assertEqual((self.home / "vrpathreg.log").read_text(), f"adddriver\n{self.driver}\n")
        self.assertEqual(json.loads(self.settings.read_text()), {"steamvr": {"showMirrorView": False, "enableLinuxVulkanAsync": True, "useFacetRenderer": True}, "other": {"keep": 12}})
        self.assertEqual(json.loads(Path(str(self.settings) + ".bak").read_text()), {"steamvr": {"showMirrorView": False}, "other": {"keep": 12}})

    def test_toolkit_runtime_files_copy_and_backup_unrelated_file(self):
        self.fixture()
        (self.win / "libcrossipc.dll").write_bytes(b"unrelated crossipc")
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        for name in ("libusb-1.0.dll", "psvr2_toolkit_capi.dll", "libcrossipc.so", "libcrossipc.dll", "libpsvr2_toolkit_capi.so"):
            self.assertEqual((self.win / name).read_bytes(), ("Toolkit " + name).encode(), name)
        self.assertEqual((self.win / "libcrossipc.dll.bak").read_bytes(), b"unrelated crossipc")
        self.assertEqual(self.run_command("configure").returncode, 0)
        self.assertFalse((self.win / "libcrossipc.dll.bak.1").exists())

    def test_null_external_drivers_registers_without_losing_state(self):
        self.fixture()
        paths = self.home / ".config/openvr/openvrpaths.vrpath"
        paths.parent.mkdir(parents=True)
        paths.write_text('{"runtime":["keep"],"external_drivers":null}\n')
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / "vrpathreg.log").read_text(), f"adddriver\n{self.driver}\n")
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")

    def test_rerun_keeps_original_and_does_not_create_extra_backups(self):
        self.fixture()
        self.assertEqual(self.run_command("configure").returncode, 0)
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertFalse(Path(str(self.settings) + ".bak.1").exists())
        self.assertEqual((self.home / "vrpathreg.log").read_text().count("adddriver\n"), 1)

    def test_steam_replacement_refuses_to_overwrite_sony_original(self):
        self.fixture()
        self.assertEqual(self.run_command("configure").returncode, 0)
        (self.win / "driver_playstation_vr2.dll").write_bytes(b"Sony Steam DLL v2")
        result = self.run_command("configure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Steam replaced or modified", result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Sony Steam DLL v2")
        self.assertFalse(Path(str(self.settings) + ".bak.1").exists())

    def test_interrupted_original_rename_recovers_without_replacing_original(self):
        self.fixture()
        (self.win / "driver_playstation_vr2.dll").rename(self.win / "driver_playstation_vr2_orig.dll")
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Toolkit wrapper")

    def test_registration_failure_preserves_original_and_rerun_completes(self):
        self.fixture()
        self.registry.write_text("#!/usr/bin/env bash\nexit 7\n")
        result = self.run_command("configure")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.win / "driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Toolkit wrapper")
        self.assertEqual(json.loads(self.settings.read_text()), {"steamvr": {"showMirrorView": False}, "other": {"keep": 12}})
        self.registry.write_text('#!/usr/bin/env bash\nprintf \'{"external_drivers":["%s"]}\\n\' "$2" > "$HOME/.config/openvr/openvrpaths.vrpath"\n')
        (self.home / ".config/openvr").mkdir(parents=True)
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(self.settings.read_text())["steamvr"]["useFacetRenderer"])

    def test_missing_proton_experimental_refuses_before_patching_sony_file(self):
        self.fixture()
        (self.home / ".local/share/Steam/steamapps/common/Proton - Experimental/proton").unlink()
        result = self.run_command("configure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("steam://install/1493710", result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertFalse((self.win / "driver_playstation_vr2_orig.dll").exists())

    def test_invalid_settings_refuses_before_patching_sony_file(self):
        self.fixture()
        self.settings.write_text("{broken")
        result = self.run_command("configure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid SteamVR settings", result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertFalse((self.win / "driver_playstation_vr2_orig.dll").exists())

    def test_missing_steam_app_reports_install_link_without_mutation(self):
        result = self.run_command("configure")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("steam://install/2580190", result.stderr)
        self.assertFalse(self.root.exists())

    def test_active_vrserver_refuses_before_patching(self):
        self.fixture()
        process = subprocess.Popen([sys.executable, "-c", "import ctypes,time; ctypes.CDLL(None).prctl(15, b'vrserver', 0, 0, 0); print('ready',flush=True); time.sleep(20)"], stdout=subprocess.PIPE, text=True)
        self.addCleanup(lambda: (process.terminate(), process.wait(), process.stdout.close()))
        self.assertEqual(process.stdout.readline().strip(), "ready")
        result = self.run_command("configure", check_active=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("stop vrserver and vrcompositor", result.stderr)
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertFalse((self.win / "driver_playstation_vr2_orig.dll").exists())

    def test_dry_run_does_not_download_link_or_patch(self):
        self.fixture()
        result = self.run_command("install", "--dry-run")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("2637bb32c3e9d4ce2f8d8af4f1eaa7f2affe4c4f544868988ba4fd7da9e0f7ec", result.stdout)
        self.assertFalse((self.root / "downloads").exists())
        self.assertFalse((self.home / ".local/bin/psvr2").exists())
        self.assertEqual((self.win / "driver_playstation_vr2.dll").read_bytes(), b"Sony Steam DLL v1")

    def test_explicit_nondefault_steam_paths_are_used(self):
        self.fixture()
        custom = self.home / "Steam Library Elsewhere"
        custom_driver = custom / "PlayStation VR2 App/SteamVR_Plug-In"
        custom_driver.parent.mkdir(parents=True)
        self.driver.rename(custom_driver)
        custom_registry = custom / "SteamVR/bin/vrpathreg.sh"
        self.registry.parent.parent.rename(custom_registry.parent.parent)
        custom_settings = custom / "config/steamvr.vrsettings"
        custom_settings.parent.mkdir(parents=True)
        self.settings.rename(custom_settings)
        result = self.run_command("configure", "--driver-dir", str(custom_driver), "--vrpathreg", str(custom_registry), "--settings", str(custom_settings))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((custom_driver / "bin/win64/driver_playstation_vr2_orig.dll").read_bytes(), b"Sony Steam DLL v1")
        self.assertEqual(json.loads(custom_settings.read_text())["steamvr"]["enableLinuxVulkanAsync"], True)
        self.assertEqual((self.home / "vrpathreg.log").read_text(), f"adddriver\n{custom_driver}\n")

    def test_unverified_cached_archive_refuses_before_extracting_or_linking(self):
        archive = self.root / "downloads/Ignition-Linux-Windows.zip"
        archive.parent.mkdir(parents=True)
        archive.write_bytes(b"not an authenticated release")
        result = self.run_command("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unverified cached archive", result.stderr)
        self.assertFalse((self.root / "releases").exists())
        self.assertFalse((self.home / ".local/bin/psvr2").exists())

    def test_openxr_registers_and_reruns_without_extra_backups(self):
        self.fixture()
        target = self.home / ".config/openxr/1/active_runtime.json"
        result = self.run_command("openxr")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(target.resolve(), self.manifest)
        self.assertEqual(self.run_command("openxr").returncode, 0)
        self.assertFalse(Path(str(target) + ".bak").exists())

    def test_openxr_preserves_previous_and_architecture_specific_runtime(self):
        self.fixture()
        target = self.home / ".config/openxr/1/active_runtime.json"
        target.parent.mkdir(parents=True)
        target.write_text("previous runtime")
        arch = target.with_name("active_runtime.x86_64.json")
        arch.symlink_to("/previous/runtime.json")
        result = self.run_command("openxr")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(target.resolve(), self.manifest)
        self.assertEqual(arch.resolve(), self.manifest)
        self.assertEqual(Path(str(target) + ".bak").read_text(), "previous runtime")
        self.assertEqual(os.readlink(str(arch) + ".bak"), "/previous/runtime.json")

    def test_openxr_missing_library_leaves_selection_unchanged(self):
        self.fixture()
        (self.registry.parent / "linux64/vrclient.so").unlink()
        result = self.run_command("openxr")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / ".config/openxr").exists())

    def test_openxr_respects_xdg_config_home(self):
        self.fixture()
        config = self.home / "Other Config"
        self.env["XDG_CONFIG_HOME"] = str(config)
        self.assertEqual(self.run_command("openxr").returncode, 0)
        self.assertEqual((config / "openxr/1/active_runtime.json").resolve(), self.manifest)
        self.assertFalse((self.home / ".config/openxr").exists())

    def test_existing_ignition_file_is_backed_up(self):
        self.fixture()
        self.linux.mkdir()
        (self.linux / "proton").write_bytes(b"unrelated user proton")
        result = self.run_command("configure")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.linux / "proton.bak").read_bytes(), b"unrelated user proton")
        self.assertEqual((self.linux / "proton").read_bytes(), b"Ignition proton")


if __name__ == "__main__":
    unittest.main()
