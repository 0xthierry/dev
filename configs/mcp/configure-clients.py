#!/usr/bin/env python3
"""Render the shared MCP catalog without connecting to servers or authenticating.

Requires tomlkit (installed by install/mcp.sh). Codex's `mcp add --url`
performs OAuth discovery/login, so its native writer is unsafe during setup.
"""
import argparse
import copy
import json
import importlib.util
import os
import shlex
from pathlib import Path
import re
import sys
import tempfile
import tomllib


HOSTS = ("dev", "macbook", "omarchy")
CATALOG = Path(__file__).with_name("catalog.json")


def object_value(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"expected an object for {label}")
    return value


def check_path(path):
    """Never follow an output symlink, including a dangling/parent link."""
    for candidate in (path, *path.parents):
        if candidate.is_symlink():
            raise ValueError(f"refusing symlink config path: {candidate}")
    if path.exists() and not path.is_file():
        raise ValueError(f"expected a regular config file: {path}")
    for parent in path.parents:
        if parent.exists() and not parent.is_dir():
            raise ValueError(f"expected a config directory: {parent}")


def read_bytes(path):
    check_path(path)
    return path.read_bytes() if path.exists() else None


def parse_json(raw, path, servers=False):
    value = object_value(json.loads(raw) if raw is not None else {}, path)
    if servers:
        entries = object_value(value.get("mcpServers", {}), f"mcpServers in {path}")
        for name, entry in entries.items():
            object_value(entry, f"server {name} in {path}")
    return value


def load_catalog():
    catalog = parse_json(CATALOG.read_bytes(), CATALOG)
    for name, service in catalog.items():
        object_value(service, f"catalog service {name}")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            raise ValueError(f"invalid catalog server name: {name}")
        if ("url" in service) == ("launcher" in service):
            raise ValueError(f"catalog {name} needs exactly one url or launcher")
        if "url" in service and (not isinstance(service["url"], str)
                                  or not service["url"].startswith(("http://", "https://"))):
            raise ValueError(f"invalid catalog URL for {name}")
        if "launcher" in service and (not isinstance(service["launcher"], str)
                                       or not re.fullmatch(r"[A-Za-z0-9_-]+", service["launcher"])):
            raise ValueError(f"invalid catalog launcher for {name}")
        if not isinstance(service.get("description"), str):
            raise ValueError(f"missing catalog description for {name}")
        if not isinstance(service.get("desktop_opt_in", False), bool):
            raise ValueError(f"invalid catalog desktop_opt_in for {name}")
        hosts = service.get("hosts", list(HOSTS))
        if not isinstance(hosts, list) or not hosts or any(host not in HOSTS for host in hosts):
            raise ValueError(f"invalid catalog hosts for {name}")
    return catalog


def desktop_remote_services(path, catalog):
    """Read persistent, per-service Desktop opt-ins; never rewrite preferences."""
    # Like plugin settings, this is a read-only input and may be repo-symlinked.
    preferences = parse_json(path.read_bytes() if path.exists() or path.is_symlink() else None, path)
    if set(preferences) - {"claude_desktop_remote_services"}:
        raise ValueError(f"unknown MCP preference in {path}")
    names = preferences.get("claude_desktop_remote_services", [])
    allowed = {name for name, service in catalog.items() if service.get("desktop_opt_in", False)}
    if not isinstance(names, list) or any(not isinstance(name, str) or name not in allowed
                                          for name in names):
        raise ValueError(f"claude_desktop_remote_services in {path} must be a list of "
                         f"opt-in service names: {', '.join(sorted(allowed))}")
    return set(names)


def managed_desktop_entry(entry, home, name):
    """Identify repo ownership by the bridge executable and exact service args."""
    return (entry.get("command") == str(home / ".local/bin/mcp-service")
            and entry.get("args") == [name])


def figma_plugin_active(claude_dir, url):
    """Use enabled, installed plugin metadata only; never inspect credentials."""
    settings_path = claude_dir / "settings.json"
    # Settings can be repo-managed symlinks: they are read-only inputs, not outputs.
    settings = parse_json(settings_path.read_bytes() if settings_path.exists() else None,
                          settings_path)
    enabled = object_value(settings.get("enabledPlugins", {}), f"enabledPlugins in {settings_path}")
    registry_path = claude_dir / "plugins/installed_plugins.json"
    registry = None
    if registry_path.exists():
        registry = parse_json(registry_path.read_bytes(), registry_path)
        registry = object_value(registry.get("plugins", {}), f"plugins in {registry_path}")
    for plugin, active in enabled.items():
        if active is not True or not plugin.startswith("figma@"):
            continue
        marketplace = plugin.partition("@")[2]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", marketplace) or marketplace in (".", ".."):
            continue
        cache = claude_dir / "plugins/cache" / marketplace / "figma"
        if registry is not None:
            records = registry.get(plugin, [])
            if not isinstance(records, list):
                raise ValueError(f"expected plugin install records for {plugin}")
            candidates = []
            for record in records:
                object_value(record, f"plugin install record for {plugin}")
                if record.get("scope") == "user" and isinstance(record.get("installPath"), str):
                    installed = Path(record["installPath"])
                    if installed.resolve().is_relative_to(cache.resolve()):
                        candidates.append(installed / ".mcp.json")
        else:
            candidates = sorted(cache.glob("*/.mcp.json"))
        for path in candidates:
            if not path.is_file():
                continue
            metadata = parse_json(path.read_bytes(), path, servers=True)
            for entry in metadata.get("mcpServers", {}).values():
                if entry.get("url") == url and entry.get("type", "http") in ("http", "streamable-http"):
                    return True
    return False


def render_entry(service, home, client, name):
    if "url" in service:
        if client == "desktop":
            return {"command": str(home / ".local/bin/mcp-service"), "args": [name]}
        entry = {"url": service["url"]}
        if client == "claude":
            entry["type"] = "http"
    else:
        entry = {"command": str(home / ".local/bin" / service["launcher"]), "args": []}
    if client == "pi":
        entry.update(description=service["description"], exposure="deferred")
    return entry


def merge_entry(existing, desired):
    """Retain user auth/options while replacing only the managed transport."""
    result = dict(existing)
    if "url" in desired:
        for field in ("command", "args", "env", "cwd", "type"):
            result.pop(field, None)
    else:
        for field in ("url", "headers", "http_headers", "env_http_headers", "oauth", "type"):
            result.pop(field, None)
    result.update(desired)
    return result


def backup(path, original):
    index = 0
    while True:
        target = Path(f"{path}.bak" + (f".{index}" if index else ""))
        try:
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            break
        except FileExistsError:
            index += 1
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(original)


def save(path, original, content):
    if original == content:
        if path.exists():
            path.chmod(0o600)
        print(f"unchanged: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staged = tempfile.mkstemp(prefix=".mcp-config-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        if original is not None:
            backup(path, original)
        os.replace(staged, path)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)
    print(f"configured: {path}")


def configure(host):
    try:
        import tomlkit
    except ImportError as error:
        raise ValueError("tomlkit is required; run the repo MCP installer or its managed Python runtime") from error
    home = Path.home()
    claude_dir = Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
    code_path = (claude_dir / ".claude.json" if "CLAUDE_CONFIG_DIR" in os.environ
                 else home / ".claude.json")
    pi_path = Path(os.environ.get("PI_CODING_AGENT_DIR", home / ".pi/agent")) / "mcp.json"
    codex_path = Path(os.environ.get("CODEX_HOME", home / ".codex")) / "config.toml"
    paths = {"claude": code_path, "pi": pi_path, "codex": codex_path}
    if host != "dev":
        desktop = (home / "Library/Application Support/Claude" if host == "macbook"
                   else Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "Claude")
        paths["desktop"] = desktop / "claude_desktop_config.json"
    if len({path.absolute() for path in paths.values()}) != len(paths):
        raise ValueError("client configuration paths must be distinct")
    catalog = load_catalog()
    remote_memory = None
    if host in ("macbook", "omarchy"):
        module_path = Path(__file__).resolve().parents[1] / "ai-memory/client.py"
        spec = importlib.util.spec_from_file_location("ai_memory_client", module_path)
        memory = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(memory)
        url, token, _ = memory.load_client()
        remote_memory = (token, module_path)
        catalog["ai-memory"] = {**catalog["ai-memory"], "url": url + "/mcp",
                                "description": "Shared private cloud project memory."}
    selected = {name: service for name, service in catalog.items()
                if host in service.get("hosts", HOSTS)}
    preferences_path = (Path(os.environ.get("XDG_CONFIG_HOME", home / ".config"))
                        / "mcp-services/preferences.json")
    desktop_enabled = (desktop_remote_services(preferences_path, catalog)
                       if "desktop" in paths else set())
    # Preflight every output before planning or writing any client configuration.
    originals = {client: read_bytes(path) for client, path in paths.items()}
    configs = {}
    for client, path in paths.items():
        raw = originals[client]
        if client == "codex":
            value = tomllib.loads(raw.decode() if raw is not None else "")
            servers = object_value(value.get("mcp_servers", {}), f"mcp_servers in {path}")
            for name, entry in servers.items():
                object_value(entry, f"server {name} in {path}")
            configs[client] = tomlkit.parse(raw.decode() if raw is not None else "")
        else:
            configs[client] = parse_json(raw, path, servers=True)
    # Pi maps '-' to '_' in native server identifiers. Do not publish a
    # catalog entry that collides with an existing differently named server.
    pi_names = {}
    for name in dict.fromkeys([*configs["pi"].get("mcpServers", {}), *selected]):
        normalized = name.replace("-", "_")
        if normalized in pi_names:
            raise ValueError(f"Pi server names {pi_names[normalized]!r} and {name!r} collide; "
                             f"resolve the existing entry in {pi_path} before setup")
        pi_names[normalized] = name
    plugin_active = "figma" in selected and figma_plugin_active(claude_dir, selected["figma"]["url"])
    plans = []
    for client, path in paths.items():
        config = configs[client]
        before = copy.deepcopy(config)
        key = "mcp_servers" if client == "codex" else "mcpServers"
        if key not in config:
            config[key] = tomlkit.table() if client == "codex" else {}
        servers = config[key]
        for name, service in selected.items():
            if client == "desktop" and service.get("desktop_opt_in", False):
                existing = servers.get(name)
                managed = existing is not None and managed_desktop_entry(existing, home, name)
                if existing is not None and not managed:
                    print(f"warning: preserving custom Claude Desktop {name} entry", file=sys.stderr)
                    continue
                if name not in desktop_enabled:
                    if managed:
                        del servers[name]
                    continue
            desired = render_entry(service, home, client, name)
            if name == "ai-memory" and remote_memory and client == "desktop":
                desired = {"command": str(home / ".local/bin/ai-memory"),
                           "args": ["mcp-bridge", "--no-session-id"]}
            if name == "ai-memory" and remote_memory and client != "desktop":
                token, module_path = remote_memory
                if client == "pi":
                    desired["headers"] = {"Authorization": "!" + shlex.join(
                        [sys.executable, str(module_path), "auth-header"])}
                else:
                    desired["http_headers" if client == "codex" else "headers"] = {
                        "Authorization": "Bearer " + token}
                # Authentication is repo-managed for this service, not preserved
                # from the old local server or a previous root credential.
                existing = servers.get(name, {})
                for auth in ("headers", "http_headers", "env_http_headers", "bearer_token_env_var", "oauth"):
                    if auth in existing:
                        del existing[auth]
            if client == "claude" and name == "figma" and plugin_active:
                if name in servers:
                    if servers[name] == desired:
                        del servers[name]
                    else:
                        print("warning: active Figma plugin; preserving custom standalone figma entry", file=sys.stderr)
                continue
            existing = servers.get(name, {})
            merged = merge_entry(existing, desired)
            if existing != merged:
                if client == "codex" and name in servers:
                    # Mutate a real TOML table to preserve its comments and unrelated fields.
                    for field in list(servers[name]):
                        if field not in merged:
                            del servers[name][field]
                    for field, value in merged.items():
                        servers[name][field] = value
                else:
                    servers[name] = merged
        original = originals[client]
        if config == before and original is not None:
            content = original
        elif client == "codex":
            content = tomlkit.dumps(config).encode()
            tomllib.loads(content.decode())
        else:
            content = (json.dumps(config, indent=2, ensure_ascii=False) + "\n").encode()
        plans.append((path, original, content))
    # Catch edits during planning before any file changes. Atomic replacement is
    # per-file, not a cross-client transaction; an interrupted run converges on retry.
    for path, original, _ in plans:
        if read_bytes(path) != original:
            raise ValueError(f"config changed during planning; rerun: {path}")
    for path, original, content in plans:
        save(path, original, content)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host", choices=HOSTS)
    try:
        configure(parser.parse_args().host)
    except (OSError, ValueError) as error:
        parser.exit(1, f"error: {error}\n")
