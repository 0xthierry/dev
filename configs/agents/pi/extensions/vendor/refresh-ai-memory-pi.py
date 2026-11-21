#!/usr/bin/env python3
"""Check (default) or refresh the exact stock ai-memory 3.5.1 Pi extension."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--binary", default=str(Path.home() / ".local/lib/ai-memory/ai-memory"))
parser.add_argument("--write", action="store_true")
args = parser.parse_args()
binary = str(Path(args.binary).expanduser().resolve())
version = subprocess.check_output([binary, "--version"], text=True).strip()
if version != "ai-memory 3.5.1":
    raise SystemExit(f"Expected ai-memory 3.5.1, got {version}")
extensions = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="ai-memory-pi-vendor-") as directory:
    root = Path(directory)
    config = root / "config.toml"
    config.write_text("")
    # Isolate user config and credentials; never mutate a deployed extension.
    env = {key: value for key, value in os.environ.items() if not key.startswith("AI_MEMORY_")}
    env.update(HOME=str(root), XDG_CONFIG_HOME=str(root / "config"), XDG_DATA_HOME=str(root / "data"))
    target = root / "ai-memory-pi.ts"
    command = [binary, "--config", str(config), "install-hooks", "--agent", "pi",
               "--server-url", "http://127.0.0.1:49374", "--data-dir", str(root / "data"),
               "--config-file", str(target), "--apply"]
    subprocess.run(command, env=env, cwd=root, check=True, capture_output=True)
    result = target.read_bytes()
    if b"const TOKEN: string | null = null;" not in result or str(root).encode() in result:
        raise SystemExit("Stock extension unexpectedly embeds credentials or generation paths")
    # Prove upstream re-apply is byte-identical and creates no backup/write.
    before = target.stat().st_mtime_ns
    subprocess.run(command, env=env, cwd=root, check=True, capture_output=True)
    if target.read_bytes() != result or target.stat().st_mtime_ns != before:
        raise SystemExit("Upstream re-apply unexpectedly changed the extension")
    installed = extensions / "ai-memory-pi.ts"
    if args.write:
        installed.write_bytes(result)
        print(f"Refreshed {installed}")
    elif installed.read_bytes() != result:
        raise SystemExit("Vendored extension differs from stock --apply; run with --write")
    else:
        print("Stock ai-memory 3.5.1 --apply exactly matches vendored bytes; re-apply is a no-op")
