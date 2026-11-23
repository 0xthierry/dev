#!/usr/bin/env python3
"""Install upstream agy wiring without replacing the user's MCP entry or policy."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile

spec = importlib.util.spec_from_file_location(
    "mcp_config", Path(__file__).resolve().parents[1] / "mcp/configure-clients.py")
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)


def configure(preflight):
    home = Path.home()
    binary = home / ".local/bin/ai-memory"
    path = home / ".gemini/config/mcp_config.json"
    hooks = path.with_name("hooks.json")
    original = writer.read_bytes(path)
    # agy creates an exactly zero-byte placeholder on first launch.
    config = writer.parse_json(original or None, path, servers=True)
    original_hooks = writer.read_bytes(hooks)
    writer.parse_json(original_hooks, hooks)
    if preflight:
        return

    servers = config.setdefault("mcpServers", {})
    # Upstream picks HTTP vs file-auth stdio. Never give its replacement writer
    # the live file; it drops disabled/tool restrictions even at the same URL.
    with tempfile.TemporaryDirectory(prefix="ai-memory-agy-") as directory:
        staged = Path(directory) / "mcp.json"
        subprocess.run([binary, "install-mcp", "--client", "antigravity-cli", "--apply",
                        "--config-file", staged], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        desired = writer.parse_json(staged.read_bytes(), staged, servers=True)["mcpServers"]["ai-memory"]
    if "ai-memory" in servers:
        existing = servers["ai-memory"]
        if "httpUrl" in existing and not ("serverUrl" in existing or "url" in existing):
            raise ValueError(f"unsupported httpUrl-only ai-memory entry in {path}; review and migrate "
                             "it to serverUrl before retrying; no Antigravity files changed")
        # Validate destination only. Even at the same endpoint, existing auth,
        # disabled/tool policy, and byte formatting remain the operator's own.
        try:
            writer.merge_matching_entry("antigravity", "ai-memory", servers["ai-memory"], desired)
        except ValueError as error:
            raise ValueError(f"different or unclear ai-memory transport in {path}; rename or reconcile "
                             "that entry before retrying; no Antigravity files changed") from error
        content = original
    else:
        servers["ai-memory"] = desired
        content = (json.dumps(config, indent=2, ensure_ascii=False) + "\n").encode()
    if writer.read_bytes(path) != original or writer.read_bytes(hooks) != original_hooks:
        raise ValueError("Antigravity config changed during planning; rerun setup")
    writer.save(path, original, content)
    subprocess.run([binary, "install-hooks", "--agent", "antigravity-cli", "--apply"], check=True)
    subprocess.run([binary, "install-skills", "--scope", "global", "--agent", "antigravity"], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preflight", action="store_true", help="validate existing config without writing")
    try:
        configure(parser.parse_args().preflight)
    except (OSError, KeyError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"error: {error}\n")
