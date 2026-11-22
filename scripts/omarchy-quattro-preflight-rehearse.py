#!/usr/bin/env python3
"""Run only three checksum-reviewed bridge functions against a fresh fake HOME.

No caller-provided HOME is accepted. No upgrade, services, hooks or package
commands are executed. Source bridge/upstream are read-only inputs.
"""
import argparse
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile

BRIDGE_SHA256 = "57ec1e8ae249e4e96ec33ddcf5d66cc2216863b62dfc7e9a8d81c53b00eebbd4"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bridge", type=Path, required=True)
    parser.add_argument("--upstream", type=Path, required=True)
    args = parser.parse_args()
    if not args.bridge.is_absolute() or not args.upstream.is_absolute():
        parser.error("bridge/upstream must be absolute")
    source = args.bridge.read_bytes()
    if hashlib.sha256(source).hexdigest() != BRIDGE_SHA256:
        parser.error("unreviewed bridge checksum; refusing to execute extracted code")
    bridge = source.decode()
    if not (args.upstream / "config/hypr/hyprland.lua").is_file():
        parser.error("upstream Hypr Lua default missing")
    doc = (Path(__file__).resolve().parents[1] / "docs/omarchy-quattro-links.md").read_text()
    materialize = re.search(r"<!-- materialize-rehearsal:start -->\n```bash\n(.*?)\n```", doc, re.S).group(1)
    backup = re.search(r"^backup_config_file\(\) \{.*?^\}", bridge, re.M | re.S).group(0)
    copy = re.search(r"^copy_config_default\(\) \{.*?^\}", bridge, re.M | re.S).group(0)
    replace = re.search(r"^replace_legacy_current_path\(\) \{.*?^\}\n(?=for file)", bridge, re.M | re.S).group(0)
    action = ('set -euo pipefail\nroot="$UPSTREAM"\nBACKUP_SUFFIX=rehearsal\n'
              + backup + "\n" + copy + "\n" + replace
              + '\ncopy_config_default hypr/hyprland.lua\n'
              + 'replace_legacy_current_path "$HOME/.config/hypr/hyprland.conf"\n')
    with tempfile.TemporaryDirectory(prefix="quattro-bridge-rehearsal-") as tmp:
        base = Path(tmp)
        home, repo = base / "home", base / "repo"
        (home / ".config").mkdir(parents=True)
        repo.mkdir()
        link = home / ".config/hypr"
        link.symlink_to(repo)
        original = "source = ~/.config/omarchy/current/theme/hyprland.conf\n"
        rewritten = "source = ~/.local/state/omarchy/current/theme/hyprland.conf\n"
        (repo / "hyprland.conf").write_text(original)
        # Do not inherit BASH_ENV, hooks, XDG paths or tool wrappers from the host.
        env = {"PATH": "/usr/bin:/bin", "LC_ALL": "C", "HOME": str(home),
               "LINK": str(link), "EXPECTED_TARGET": str(repo), "UPSTREAM": str(args.upstream)}
        subprocess.run(["/usr/bin/bash", "-c", action], env=env, check=True, timeout=30)
        if not (repo / "hyprland.lua").is_file() or (repo / "hyprland.conf").read_text() != rewritten:
            raise RuntimeError("failed to reproduce bridge write-through")
        print("BEFORE: exact reviewed bridge functions wrote through fake-HOME link into fake repo")
        (repo / "hyprland.lua").unlink()
        (repo / "hyprland.conf").write_text(original)
        subprocess.run(["/usr/bin/bash", "-c", materialize], env=env, check=True, timeout=30, capture_output=True)
        subprocess.run(["/usr/bin/bash", "-c", action], env=env, check=True, timeout=30)
        if (repo / "hyprland.lua").exists() or (repo / "hyprland.conf").read_text() != original:
            raise RuntimeError("materialization did not protect fake repo")
        if not (link / "hyprland.lua").is_file() or (link / "hyprland.conf").read_text() != rewritten:
            raise RuntimeError("bridge did not update materialized fake HOME")
        print("AFTER: bridge updated materialized fake HOME; fake repo remained unchanged")
    print("PASS: fake fixture removed; no live HOME writes or upgrade performed")


if __name__ == "__main__":
    main()
