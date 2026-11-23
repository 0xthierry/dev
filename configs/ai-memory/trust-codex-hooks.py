#!/usr/bin/env python3
"""Review only the eight pinned ai-memory hooks using Codex's persistent API.

Default: read-only plan. --apply writes only trusted_hash fields via recursive
config/batchWrite upsert, as Codex 0.169.0's TUI does. Never executes hooks.
"""
import argparse
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time

EVENTS = {
    "preToolUse": "pre-tool-use", "postToolUse": "post-tool-use",
    "preCompact": "pre-compact", "sessionStart": "session-start",
    "sessionEnd": "session-end", "userPromptSubmit": "user-prompt-submit",
    "stop": "stop", "interrupt": "stop",
}


class ReviewError(Exception):
    pass


def path_arg(path, home):
    """Match upstream posix_path_arg, including its portable HOME spelling."""
    try:
        relative = str(path.relative_to(home))
        if not any(c in relative for c in '\"$`\\') and not any(ord(c) < 32 or ord(c) == 127 for c in relative):
            return '"$HOME"' if relative == '.' else f'"$HOME/{relative}"'
    except ValueError:
        pass
    value = str(path)
    return value if re.fullmatch(r"[a-zA-Z0-9_./:@%+=,\-]+", value) else "'" + value.replace("'", "'\\''") + "'"


def expected_commands():
    home = Path.home()
    if sys.platform == "darwin":
        data = home / "Library/Application Support/ai-memory"
    elif sys.platform.startswith("linux"):
        xdg = os.environ.get("XDG_DATA_HOME", "")
        data = (Path(xdg) if xdg and Path(xdg).is_absolute() else home / ".local/share") / "ai-memory"
    else:
        raise ReviewError("unsupported platform")
    prefix = f'{path_arg(home / ".local/bin/ai-memory", home)} --data-dir {path_arg(data, home)} hook --event '
    return {event: prefix + name + ' --agent codex --server-url http://127.0.0.1:49374' for event, name in EVENTS.items()}


class Codex:
    """Small bounded NDJSON client; stderr is deliberately not exposed."""
    def __init__(self, executable, timeout):
        self.timeout = timeout
        self.sequence = 0
        self.buffer = b""
        self.process = subprocess.Popen(
            [executable, "app-server", "--listen", "stdio://"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        )
        assert self.process.stdin is not None and self.process.stdout is not None
        self.stdin = self.process.stdin
        self.stdout = self.process.stdout
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.stdout, selectors.EVENT_READ)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.selector.close()
        self.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        self.stdout.close()

    def send(self, message):
        self.stdin.write(json.dumps(message).encode() + b"\n")
        self.stdin.flush()

    def request(self, method, params):
        self.sequence += 1
        self.send({"id": self.sequence, "method": method, "params": params})
        deadline = time.monotonic() + self.timeout
        while True:
            if b"\n" not in self.buffer:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not self.selector.select(remaining):
                    raise ReviewError(f"{method}: timed out")
                chunk = os.read(self.stdout.fileno(), 65536)
                if not chunk:
                    raise ReviewError(f"{method}: app-server exited")
                self.buffer += chunk
                if len(self.buffer) > 4 * 1024 * 1024:
                    raise ReviewError("app-server response exceeded limit")
                continue
            line, self.buffer = self.buffer.split(b"\n", 1)
            message = json.loads(line)
            if message.get("id") != self.sequence:
                if time.monotonic() >= deadline:
                    raise ReviewError(f"{method}: timed out")
                continue
            if "error" in message or "result" not in message:
                raise ReviewError(f"{method}: request rejected")
            return message["result"]

    def initialize(self):
        self.request("initialize", {"clientInfo": {"name": "repo-ai-memory-hook-review", "version": "1.0"}})
        self.send({"method": "initialized"})


def inventory(client, cwd, source):
    result = client.request("hooks/list", {"cwds": [str(cwd)]})
    if not isinstance(result, dict) or not isinstance(result.get("data"), list) or len(result["data"]) != 1:
        raise ReviewError("invalid hooks inventory")
    entry = result["data"][0]
    if entry.get("cwd") != str(cwd) or entry.get("warnings") != [] or entry.get("errors") != []:
        raise ReviewError("hooks inventory has errors, warnings, or wrong scope")
    if not isinstance(entry.get("hooks"), list):
        raise ReviewError("invalid hooks list")
    commands = expected_commands()
    found = {}
    for hook in entry["hooks"]:
        if not isinstance(hook, dict):
            raise ReviewError("invalid hook metadata")
        # Inspect all ai-memory-looking entries, including misplaced or foreign
        # declarations. Never silently approve the good subset of a bad install.
        if not re.search(r"ai[-_]memory", " ".join(str(hook.get(k, "")) for k in ("command", "server", "tool")), re.IGNORECASE):
            continue
        event = hook.get("eventName")
        if event not in commands or event in found:
            raise ReviewError("unexpected or duplicate ai-memory event")
        expected = {
            "command": commands[event], "handlerType": "command",
            # Upstream emits matcher:"" for every group. Codex retains it on
            # matchable events and normalizes it to null on these three.
            "matcher": None if event in {"userPromptSubmit", "stop", "interrupt"} else "",
            "source": "user", "pluginId": None,
            "environmentId": None, "isManaged": False, "async": False,
            "timeoutSec": 1 if event in {"sessionEnd", "interrupt"} else 600,
            "statusMessage": None, "additionalContextLimit": None,
        }
        source_path = hook.get("sourcePath")
        if (not isinstance(source_path, str) or not Path(source_path).is_absolute()
                or Path(source_path).resolve() != source.resolve()):
            raise ReviewError(f"{event}: hook is not from the selected user hooks file")
        if any(key not in hook or type(hook[key]) is not type(value) or hook[key] != value
               for key, value in expected.items()):
            raise ReviewError(f"{event}: declaration differs from reviewed hook")
        if type(hook.get("enabled")) is not bool or hook.get("trustStatus") not in {"trusted", "untrusted", "modified"}:
            raise ReviewError(f"{event}: invalid trust metadata")
        key = hook.get("key")
        if not isinstance(key, str) or not key or len(key) > 4096 or any(ord(c) < 32 for c in key):
            raise ReviewError(f"{event}: invalid hook key")
        if not isinstance(hook.get("currentHash"), str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", hook["currentHash"]):
            raise ReviewError(f"{event}: invalid current hash")
        if any(other["key"] == key for other in found.values()):
            raise ReviewError("duplicate hook key")
        found[event] = hook
    if set(found) != set(commands):
        raise ReviewError("missing reviewed ai-memory hooks (expected eight events)")
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="persist narrowly reviewed hook trust")
    parser.add_argument("--cwd", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--codex", default="codex", help="Codex executable")
    parser.add_argument("--timeout", type=float, default=30)
    args = parser.parse_args()
    if not 0 < args.timeout <= 300:
        parser.error("--timeout must be in (0, 300]")
    try:
        cwd = args.cwd.resolve(strict=True)
        if not cwd.is_dir():
            raise ReviewError("--cwd must be a directory")
        source = (Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex").resolve() / "hooks.json")
        with Codex(args.codex, args.timeout) as client:
            client.initialize()
            before = inventory(client, cwd, source)
            updates = {h["key"]: {"trusted_hash": h["currentHash"]} for h in before.values()
                       if h["enabled"] and h["trustStatus"] != "trusted"}
            disabled = sum(not h["enabled"] for h in before.values())
            if args.apply and updates:
                client.request("config/batchWrite", {
                    "edits": [{"keyPath": "hooks.state", "value": updates, "mergeStrategy": "upsert"}],
                    "reloadUserConfig": True,
                })
                after = inventory(client, cwd, source)
                for event, old in before.items():
                    new = after[event]
                    if any(new[k] != old[k] for k in ("key", "currentHash", "enabled")) or (old["enabled"] and new["trustStatus"] != "trusted") or (not old["enabled"] and new["trustStatus"] != old["trustStatus"]):
                        raise ReviewError("post-write verification failed; rerun after inspecting hook changes")
            action = "applied" if args.apply else "planned"
            print(f"ai-memory Codex hooks: reviewed=8 disabled-preserved={disabled} {action}={len(updates)}")
        return 0
    except (ReviewError, OSError, ValueError, KeyError, TypeError) as error:
        # Never print commands, config values, or server error payloads.
        detail = str(error) if isinstance(error, ReviewError) else type(error).__name__
        print(f"ai-memory Codex hook review refused: {detail}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
