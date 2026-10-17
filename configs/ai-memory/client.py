#!/usr/bin/env python3
"""Repo-owned remote client policy; credentials never enter argv or Git."""
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import tempfile
from urllib.parse import urlsplit


def paths():
    home = Path.home()
    return (home / ".config/ai-memory/client.json", home / ".config/ai-memory/api-key",
            home / ".local/share/ai-memory-client")


def server_url(value):
    if not isinstance(value, str):
        raise ValueError("ai-memory server_url must be an HTTPS Tailscale URL")
    url = urlsplit(value)
    if (url.scheme != "https" or not url.hostname or not url.hostname.endswith(".ts.net")
            or url.username or url.password or url.port not in (None, 443)
            or url.path not in ("", "/") or url.query or url.fragment):
        raise ValueError("ai-memory server_url must be an HTTPS Tailscale origin")
    expected = json.loads(Path(__file__).resolve().with_name("deployment.json").read_text())["server_url"]
    if value.rstrip("/") != expected:
        raise ValueError("ai-memory server_url must match the configured deployment origin")
    return expected


def read_key(path=None):
    path = path or paths()[1]
    # The credential boundary must not follow arbitrary links or accept a key
    # readable by another user. Never include its contents in exception messages.
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("ai-memory API key must be a user-owned 0600 regular file")
    key = path.read_text().strip()
    if not re.fullmatch(r"aim_[A-Za-z0-9_-]{16,}", key):
        raise ValueError("ai-memory API key must be a native user key, not a root bearer")
    return key


def load_client():
    marker, key_path, data = paths()
    value = json.loads(marker.read_text())
    if not isinstance(value, dict) or set(value) != {"server_url"}:
        raise ValueError("invalid ai-memory remote client configuration")
    return server_url(value["server_url"]), read_key(key_path), data


def save(path, content, mode=0o600):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"refusing non-regular ai-memory configuration: {path}")
    if path.exists() and path.read_text() == content:
        path.chmod(mode)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, staged = tempfile.mkstemp(prefix=".ai-memory-client-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(content)
            os.fchmod(stream.fileno(), mode)
        os.replace(staged, path)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)


def configure():
    marker, key_path, data = paths()
    read_key(key_path)  # Preflight before stopping a local server or changing config.
    deployment = json.loads(Path(__file__).with_name("deployment.json").read_text())
    url = server_url(deployment["server_url"])
    config = (f"server_url = {json.dumps(url)}\nembedding_provider = \"none\"\n"
              f"data_dir = {json.dumps(str(data))}\n\n[auth]\n"
              f"bearer_token_file = {json.dumps(str(key_path))}\n")
    save(data / "config.toml", config)
    # Publish marker last: its presence switches Pi from the local capture path.
    save(marker, json.dumps({"server_url": url}, indent=2) + "\n")
    print("ai-memory remote client configured (credentials not displayed)")


def route_hooks():
    """Route upstream-generated native hooks through the canonical key boundary."""
    home = Path.home()
    _, _, data = paths()
    binary = str(data / "bin/ai-memory")
    launcher = str(home / ".local/bin/ai-memory")
    targets = [Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude")) / "settings.json",
               Path(os.environ.get("CODEX_HOME", home / ".codex")) / "hooks.json"]
    for target in targets:
        if not target.exists():
            continue
        if target.is_symlink():
            raise ValueError("refusing symlink hook configuration")
        config = json.loads(target.read_text())
        for groups in config.get("hooks", {}).values():
            for group in groups:
                for hook in group.get("hooks", []):
                    command = hook.get("command")
                    if not isinstance(command, str):
                        continue
                    argv = shlex.split(command)
                    if (len(argv) >= 4 and argv[1] == "--data-dir" and argv[3] == "hook"
                            and Path(argv[0]).resolve() == Path(binary).resolve()
                            and Path(argv[2]).resolve() == data.resolve()):
                        hook["command"] = shlex.join([launcher, *argv[3:]])
        save(target, json.dumps(config, indent=2) + "\n")


def main():
    if sys.argv[1:2] == ["route-hooks"]:
        route_hooks()
        return
    if sys.argv[1:2] == ["configure"]:
        configure()
        return
    url, key, data = load_client()
    if sys.argv[1:2] == ["auth-header"]:
        print("Bearer " + key)
        return
    # Native hook subprocesses resolve the same data/config even on macOS. The
    # explicit config prevents accidental localhost routing and old embedding env.
    env = dict(os.environ)
    for name in tuple(env):
        if name.startswith("AI_MEMORY_") and name not in ("AI_MEMORY_RUN_ID", "AI_MEMORY_SESSION_ID"):
            del env[name]
    env.update(AI_MEMORY_SERVER_URL=url, AI_MEMORY_DATA_DIR=str(data),
               AI_MEMORY_AUTH_TOKEN=key, AI_MEMORY_EMBEDDING_PROVIDER="none")
    binary = data / "bin/ai-memory"
    os.execve(binary, [str(binary), "--data-dir", str(data), "--config", str(data / "config.toml"),
                       *sys.argv[1:]], env)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        # JSON errors contain source snippets; only our explicit policy messages
        # and filesystem errors are safe here, never arbitrary secret material.
        if isinstance(error, json.JSONDecodeError):
            raise SystemExit("error: invalid ai-memory client JSON") from None
        raise SystemExit(f"error: {error}") from None
