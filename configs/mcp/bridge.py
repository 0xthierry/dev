#!/usr/bin/env python3
"""Launch a pinned HTTP MCP bridge for one named repo-managed service."""
import argparse
import json
import os
from pathlib import Path


def main():
    source = Path(__file__).resolve().parent
    catalog = json.loads((source / "catalog.json").read_text())
    names = [name for name, entry in catalog.items() if "url" in entry]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", choices=names)
    args = parser.parse_args()
    if args.service == "ai-memory":
        # The dedicated client supplies the HTTPS endpoint and file-backed user
        # key. No token arguments, mcp-remote OAuth, or localhost fallback.
        launcher = Path.home() / ".local/bin/ai-memory"
        if not launcher.is_file() or not os.access(launcher, os.X_OK):
            raise ValueError("ai-memory remote client is missing; rerun host setup")
        os.execv(launcher, [str(launcher), "mcp-bridge", "--no-session-id"])
    runtime = Path.home() / ".local/share/mcp-services"
    config = json.loads((runtime / "runtime.json").read_text())
    node = config["node"]
    proxy = source / "node_modules/mcp-remote/dist/proxy.js"
    if not Path(node).is_absolute() or not os.access(node, os.X_OK) or not proxy.is_file():
        raise ValueError("MCP bridge runtime is incomplete; rerun install/mcp.sh")
    entry = catalog[args.service]
    command = [node, str(proxy), entry["url"], "--transport", "http-only", "--host", "127.0.0.1"]
    if not entry["url"].startswith("https://"):
        raise ValueError("remote MCP services require HTTPS")
    os.execv(node, command)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        raise SystemExit(f"error: {error}") from error
