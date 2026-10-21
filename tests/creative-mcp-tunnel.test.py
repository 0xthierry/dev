#!/usr/bin/env python3
"""Isolated integration tests: real shell/FS; fake outer download/tunnel process."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install/creative-mcp-tunnel.sh"
LAUNCHER = ROOT / "configs/creative-mcp/chatgpt-creative-mcp"
FLAGS = "--config --control-plane.api-key --control-plane.poll-channel --mcp.command --health.listen-addr --health.url-file --log.http-raw-unsafe"


class CreativeTunnelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="creative tunnel ")
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.home = self.root / 'home with space and apostrophe\' and "quote"'
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.home.mkdir()
        self.env = dict(os.environ, HOME=str(self.home), PATH=f"{self.bin}:{os.environ['PATH']}")
        for name in list(self.env):
            if name.startswith(("CONTROL_PLANE_", "TUNNEL_CLIENT_", "MCP_", "CLOUDFLARED_", "HEALTH_", "LOG_", "HARPOON_")):
                del self.env[name]
        self.executable(self.bin / "uname", '#!/bin/sh\nif [ "$1" = -m ]; then echo x86_64; else echo "${FIXTURE_OS:-Linux}"; fi\n')
        self.runtime = self.home / ".local/share/creative-mcp/tunnel-client/runtime"
        self.runtime.parent.mkdir(parents=True)
        self.executable(self.runtime, f'''#!{sys.executable}
import json, os, sys
if sys.argv[1:] == ["run", "--help"]:
    print({FLAGS!r}.replace(" ", " value\\n") + " value")
else:
    names = ["MCP_SERVER_URL", "TUNNEL_CLIENT_PROFILE", "HARPOON_TARGETS", "CLOUDFLARED_MANAGED", "HEALTH_LISTEN_ADDR", "LOG_FILE", "CONTROL_PLANE_BASE_URL", "ALLOW_REMOTE_UI", "OPEN_WEB_UI"]
    print(json.dumps({{"argv": sys.argv[1:], "ambient": {{n: os.environ[n] for n in names if n in os.environ}}, "credentials_present": [bool(os.environ.get("CONTROL_PLANE_API_KEY")), bool(os.environ.get("CONTROL_PLANE_TUNNEL_ID"))]}}))
    sys.exit(int(os.environ.get("FIXTURE_EXIT", "0")))
''')
        for name in ("blender-mcp", "roblox-studio-mcp", "mcp-service", "playwriter-mcp", "chrome-devtools-mcp"):
            self.executable(self.home / ".local/bin" / name, "#!/bin/sh\nexit 99\n")
        self.env.update(CONTROL_PLANE_API_KEY="fixture-runtime-key", CONTROL_PLANE_TUNNEL_ID="tunnel_0123456789abcdef0123456789abcdef")

    def executable(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o755)

    def launch(self, *args, **env):
        return subprocess.run([str(LAUNCHER), *args], env=self.env | env, text=True, capture_output=True)

    def install(self, command, *args, **env):
        return subprocess.run(["bash", "-c", 'source "$1"; REPO_ROOT="$2"; shift 2; ' + command,
                               "fixture", str(INSTALLER), str(ROOT), *args],
                              env=self.env | env, text=True, capture_output=True)

    def expected_args(self, target):
        path = str(self.home / ".local/bin" / target)
        quoted = '"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"'
        return ["run", "--control-plane.api-key", "env:CONTROL_PLANE_API_KEY",
                "--control-plane.poll-channel", "main", "--mcp.command", quoted,
                "--health.listen-addr", "127.0.0.1:0", "--health.url-file", "", "--log.http-raw-unsafe=false"]

    def test_blender_selects_only_fixed_stdio_command_with_loopback_health(self):
        result = self.launch("blender")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"argv": self.expected_args("blender-mcp"), "ambient": {}, "credentials_present": [True, True]})
        self.assertNotIn("fixture-runtime-key", result.stdout + result.stderr)

    def test_roblox_selects_only_fixed_stdio_command(self):
        result = self.launch("roblox")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("roblox-studio-mcp"))

    def test_ai_memory_uses_only_the_fixed_catalog_service(self):
        result = self.launch("ai-memory")
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = self.expected_args("mcp-service")
        expected[expected.index("--mcp.command") + 1] += " ai-memory"
        self.assertEqual(json.loads(result.stdout)["argv"], expected)
        self.assertNotIn("fixture-runtime-key", result.stdout + result.stderr)

    def test_playwriter_selects_existing_browser_stdio_server(self):
        result = self.launch("playwriter")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("playwriter-mcp"))
        self.assertNotIn("fixture-runtime-key", result.stdout + result.stderr)

    def test_chrome_devtools_selects_fixed_stdio_server(self):
        result = self.launch("chrome-devtools")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("chrome-devtools-mcp"))
        self.assertNotIn("fixture-runtime-key", result.stdout + result.stderr)

    def test_ambient_profiles_public_listeners_and_logging_cannot_expand_scope(self):
        result = self.launch("blender", MCP_SERVER_URL="http://unwanted", TUNNEL_CLIENT_PROFILE="foreign", TUNNEL_CLIENT_CONFIG="foreign.yaml",
                             HARPOON_TARGETS="foreign", CLOUDFLARED_MANAGED="true", HEALTH_LISTEN_ADDR="0.0.0.0:8080",
                             LOG_FILE="unwanted.log", CONTROL_PLANE_BASE_URL="http://unwanted", ALLOW_REMOTE_UI="true", OPEN_WEB_UI="true")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["ambient"], {})
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("blender-mcp"))
        self.assertFalse((self.home / "unwanted.log").exists())

    def test_health_url_file_is_opt_in_and_not_a_secret(self):
        result = self.launch("blender", CHATGPT_CREATIVE_MCP_HEALTH_URL_FILE=str(self.root / "health.url"))
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = self.expected_args("blender-mcp")
        expected[-2] = str(self.root / "health.url")
        self.assertEqual(json.loads(result.stdout)["argv"], expected)

    def test_missing_api_key_reports_runtime_key_setup_without_fallback(self):
        result = self.launch("blender", CONTROL_PLANE_API_KEY="", OPENAI_API_KEY="fixture-wrong-key")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing CONTROL_PLANE_API_KEY", result.stderr)
        self.assertIn("Tunnels Read + Use", result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("fixture-wrong-key", result.stderr)

    def test_missing_tunnel_id_reports_management_setup(self):
        result = self.launch("blender", CONTROL_PLANE_TUNNEL_ID="")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing CONTROL_PLANE_TUNNEL_ID", result.stderr)
        self.assertIn("https://platform.openai.com/settings/organization/tunnels", result.stderr)
        self.assertNotIn("fixture-runtime-key", result.stderr)

    def test_arbitrary_command_is_rejected(self):
        result = self.launch("/bin/sh")
        self.assertEqual(result.returncode, 2)
        self.assertIn("arbitrary commands and tunnel flags are not accepted", result.stderr)

    def test_extra_flags_are_rejected(self):
        result = self.launch("blender", "--health.listen-addr", "0.0.0.0:8080")
        self.assertEqual(result.returncode, 2)
        self.assertIn("Usage:", result.stderr)

    def test_missing_local_launcher_fails_before_tunnel(self):
        (self.home / ".local/bin/blender-mcp").unlink()
        result = self.launch("blender")
        self.assertEqual(result.returncode, 1)
        self.assertIn("local stdio MCP launcher is missing", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_incompatible_upstream_client_fails_without_start(self):
        self.executable(self.runtime, "#!/bin/sh\necho old-client\n")
        result = self.launch("blender")
        self.assertEqual(result.returncode, 1)
        self.assertIn("does not support required flag --control-plane.api-key", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_missing_runtime_has_actionable_error_without_start(self):
        self.runtime.unlink()
        result = self.launch("blender")
        self.assertEqual(result.returncode, 1)
        self.assertIn("tunnel-client is missing or not executable", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_foreground_client_exit_status_is_preserved(self):
        result = self.launch("blender", FIXTURE_EXIT="23")
        self.assertEqual(result.returncode, 23)
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("blender-mcp"))

    def test_macos_resolves_official_brew_formula(self):
        formula = self.root / "brew formula"
        self.executable(formula / "bin/tunnel-client", self.runtime.read_text())
        self.executable(self.bin / "brew", '#!/bin/sh\nprintf "%s\\n" "$FIXTURE_FORMULA"\n')
        result = self.launch("roblox", FIXTURE_OS="Darwin", FIXTURE_FORMULA=str(formula))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["argv"], self.expected_args("roblox-studio-mcp"))

    def test_macos_missing_brew_formula_fails_before_launcher_publication(self):
        self.executable(self.bin / "brew", "#!/bin/sh\nexit 1\n")
        result = self.install('DRY_RUN=0 apply_creative_mcp_tunnel macbook')
        self.assertEqual(result.returncode, 1)
        self.assertIn("install the declared Homebrew formula", result.stderr)
        self.assertFalse((self.home / ".local/bin/chatgpt-creative-mcp").exists())

    def test_macos_dry_run_does_not_invoke_brew_or_write_home(self):
        clean_home = self.root / "mac dry run home"
        clean_home.mkdir()
        self.executable(self.bin / "brew", "#!/bin/sh\nexit 99\n")
        result = self.install('DRY_RUN=1 apply_creative_mcp_tunnel macbook', HOME=str(clean_home))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Homebrew formula openai/tools/tunnel-client", result.stdout)
        self.assertEqual(list(clean_home.iterdir()), [])

    def test_dry_run_has_no_home_writes_or_downloads(self):
        clean_home = self.root / "dry run home"
        clean_home.mkdir()
        result = self.install('DRY_RUN=1 apply_creative_mcp_tunnel omarchy', HOME=str(clean_home))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("verify SHA256 f8f48017", result.stdout)
        self.assertIn("No tunnel, public listener", result.stdout)
        self.assertEqual(list(clean_home.iterdir()), [])

    def test_dev_host_is_rejected_without_writes(self):
        result = self.install('DRY_RUN=1 apply_creative_mcp_tunnel dev')
        self.assertEqual(result.returncode, 1)
        self.assertIn("supports only macbook and omarchy", result.stderr)

    def release_fixture(self):
        archive = self.root / "fixture.zip"
        with zipfile.ZipFile(archive, "w") as release:
            release.writestr("tunnel-client-runtime", "#!/bin/sh\necho fixture runtime\n")
            release.writestr("LICENSE", "fixture license")
            release.writestr("NOTICE", "fixture notice")
            release.writestr("tunnel-client-runtime-v0.0.16-linux-amd64-licenses.txt", "fixture licenses")
            release.writestr("tunnel-client-runtime-v0.0.16-linux-amd64.spdx.json", "{}")
        self.executable(self.bin / "curl", '''#!/bin/bash
set -eu
printf 'download\\n' >> "$FIXTURE_DOWNLOAD_LOG"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then cp "$FIXTURE_ARCHIVE" "$2"; exit; fi
  shift
done
exit 99
''')
        self.env.update(FIXTURE_ARCHIVE=str(archive), FIXTURE_DOWNLOAD_LOG=str(self.root / "downloads"))
        return hashlib.sha256(archive.read_bytes()).hexdigest()

    def test_linux_install_verifies_payload_and_repeat_avoids_download(self):
        digest = self.release_fixture()
        self.runtime.unlink()
        result = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(result.returncode, 0, result.stderr)
        target = self.runtime.parent / "v0.0.16-linux-amd64/tunnel-client-runtime"
        self.assertEqual(self.runtime.resolve(), target)
        self.assertEqual(subprocess.check_output([str(self.runtime)], text=True), "fixture runtime\n")
        repeated = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertEqual((self.root / "downloads").read_text(), "download\n")
        self.assertEqual(list(self.runtime.parent.glob(".install.*")), [])

    def test_checksum_failure_does_not_publish_runtime(self):
        self.release_fixture()
        self.runtime.unlink()
        result = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', "0" * 64)
        self.assertEqual(result.returncode, 1)
        self.assertIn("archive SHA256 mismatch", result.stderr)
        self.assertFalse(self.runtime.exists())
        self.assertFalse((self.runtime.parent / "v0.0.16-linux-amd64").exists())
        self.assertEqual(list(self.runtime.parent.glob(".install.*")), [])

    def test_unexpected_archive_members_fail_without_publication(self):
        self.release_fixture()
        archive = pathlib.Path(self.env["FIXTURE_ARCHIVE"])
        with zipfile.ZipFile(archive, "a") as release:
            release.writestr("../unexpected", "foreign bytes")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        self.runtime.unlink()
        result = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unexpected tunnel-client runtime ZIP members", result.stderr)
        self.assertFalse(self.runtime.exists())
        self.assertFalse((self.runtime.parent / "v0.0.16-linux-amd64").exists())

    def test_foreign_runtime_symlink_is_preserved_without_downloading(self):
        digest = self.release_fixture()
        self.runtime.unlink()
        foreign = self.root / "foreign runtime"
        foreign.write_text("foreign bytes")
        self.runtime.symlink_to(foreign)
        result = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated ChatGPT tunnel symlink", result.stderr)
        self.assertEqual(self.runtime.readlink(), foreign)
        self.assertEqual(foreign.read_text(), "foreign bytes")
        self.assertFalse((self.root / "downloads").exists())

    def test_changed_existing_payload_fails_closed(self):
        digest = self.release_fixture()
        self.runtime.unlink()
        first = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.runtime.write_text("user modification")
        result = self.install('DRY_RUN=0 install_creative_mcp_tunnel_linux amd64 "$1"', digest)
        self.assertEqual(result.returncode, 1)
        self.assertIn("payload differs from verified archive", result.stderr)
        self.assertEqual(self.runtime.read_text(), "user modification")
        self.assertEqual((self.root / "downloads").read_text(), "download\n")

    def test_launcher_install_backs_up_user_file_and_is_idempotent(self):
        command = self.home / ".local/bin/chatgpt-creative-mcp"
        command.write_text("user command")
        self.executable(self.bin / "brew", "#!/bin/sh\nexit 0\n")
        result = self.install('DRY_RUN=0 apply_creative_mcp_tunnel macbook')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(command.resolve(), LAUNCHER)
        browser_command = self.home / ".local/bin/chatgpt-browser-mcp"
        self.assertEqual(browser_command.resolve(), LAUNCHER)
        browser_help = subprocess.run([str(browser_command), "--help"], env=self.env, text=True, capture_output=True)
        self.assertEqual(browser_help.returncode, 0, browser_help.stderr)
        self.assertIn("Usage: chatgpt-browser-mcp", browser_help.stdout)
        self.assertIn("playwriter|chrome-devtools", browser_help.stdout)
        self.assertEqual(command.with_suffix(".bak").read_text(), "user command")
        repeated = self.install('DRY_RUN=0 apply_creative_mcp_tunnel macbook')
        self.assertEqual(repeated.returncode, 0, repeated.stderr)
        self.assertFalse(command.with_suffix(".bak.1").exists())

    def test_foreign_browser_alias_is_preserved_before_installing(self):
        command = self.home / ".local/bin/chatgpt-browser-mcp"
        command.symlink_to(self.runtime)
        result = self.install('DRY_RUN=0 apply_creative_mcp_tunnel macbook')
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated ChatGPT tunnel symlink", result.stderr)
        self.assertEqual(command.readlink(), self.runtime)
        self.assertFalse((self.home / ".local/bin/chatgpt-creative-mcp").exists())

    def test_foreign_launcher_symlink_is_preserved_and_reported(self):
        command = self.home / ".local/bin/chatgpt-creative-mcp"
        command.symlink_to(self.runtime)
        result = self.install('DRY_RUN=0 apply_creative_mcp_tunnel macbook')
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing unrelated ChatGPT tunnel symlink", result.stderr)
        self.assertEqual(command.readlink(), self.runtime)


if __name__ == "__main__":
    unittest.main(verbosity=2)
