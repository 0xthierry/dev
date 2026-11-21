#!/usr/bin/env python3
"""Use upstream's Codex-plugin transport without requiring a GUI token export.

Run after upstream setup: preserve its destructive-tool approvals and unrelated
client configuration. This is the only client adjustment; hooks remain upstream.
"""
import importlib.util
import os
from pathlib import Path
import tomlkit

# Reuse the shared renderer's checked atomic writes/private backups, not its
# catalog. ai-memory registration remains owned by the upstream installer.
spec = importlib.util.spec_from_file_location(
    "mcp_config", Path(__file__).resolve().parents[1] / "mcp/configure-clients.py")
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)
path = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "config.toml"
original = writer.read_bytes(path)
if original is None:
    raise SystemExit("error: run ai-memory setup for Codex before configuring its bridge")
config = tomlkit.parse(original.decode())
entry = config.get("mcp_servers", {}).get("ai-memory")
if entry is None:
    # An enabled upstream plugin owns its own MCP; setup deliberately skips this
    # standalone entry. Do not create a duplicate outside that plugin.
    print("ai-memory: no standalone Codex entry; leaving plugin-owned MCP unchanged")
else:
    for field in ("url", "http_headers", "env_http_headers", "bearer_token_env_var", "oauth", "env"):
        entry.pop(field, None)
    entry["command"] = str(Path.home() / ".local/bin/ai-memory")
    entry["args"] = ["mcp-bridge", "--no-session-id", "--server-url", "http://127.0.0.1:49374/mcp"]
    content = tomlkit.dumps(config).encode()
    writer.save(path, original, content)
