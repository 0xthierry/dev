#!/usr/bin/env python3
"""Check installed Claude/Codex/Desktop MCP; optional synthetic hook exercise.

Default: read-only checks of real installed stdio registrations + doctor trust.
--capture invokes installed Claude/Codex hook commands directly in a UUID-named
project, retrieves the observations via actual MCP, then purges that project.
It does NOT prove Codex has approved the hooks or that either GUI has reloaded.
No paid models. Pi's stock tool bridge has separate real-Pi RPC coverage.
"""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import selectors
import shlex
import subprocess
import sys
import tempfile
import time
import tomllib
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--capture", action="store_true")
args = parser.parse_args()
home = Path.home()
launcher = str(home / ".local/bin/ai-memory")
claude_home = Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude"))
claude_path = claude_home / ".claude.json" if "CLAUDE_CONFIG_DIR" in os.environ else home / ".claude.json"
codex_home = Path(os.environ.get("CODEX_HOME", home / ".codex"))
desktop_home = (home / "Library/Application Support/Claude" if sys.platform == "darwin"
                else Path(os.environ.get("XDG_CONFIG_HOME", home / ".config")) / "Claude")
entries = {
    "Claude Code": json.loads(claude_path.read_text())["mcpServers"]["ai-memory"],
    "Codex CLI/app": tomllib.loads((codex_home / "config.toml").read_text())["mcp_servers"]["ai-memory"],
    "Claude Desktop": json.loads((desktop_home / "claude_desktop_config.json").read_text())["mcpServers"]["ai-memory"],
}
pi_path = Path(os.environ.get("PI_CODING_AGENT_DIR", home / ".pi/agent")) / "mcp.json"
if pi_path.exists() and "ai-memory" in json.loads(pi_path.read_text()).get("mcpServers", {}):
    raise SystemExit("error: duplicate native Pi ai-memory entry; the stock extension owns memory tools")


@contextmanager
def bridge(client, entry):
    argv = entry.get("args", [])
    if entry.get("command") != launcher or "mcp-bridge" not in argv:
        raise RuntimeError(f"{client} does not use upstream ai-memory mcp-bridge")
    if ("--no-session-id" in argv) != (client != "Claude Code"):
        raise RuntimeError(f"{client} has the wrong session mode")
    env = dict(os.environ, CLAUDE_CODE_SESSION_ID=str(uuid.uuid4()))
    process = subprocess.Popen([entry["command"], *argv], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                               env=env, text=True, bufsize=1)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    request_id = 0

    def request(method, params, notify=False):
        nonlocal request_id
        request_id += 1
        packet = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            packet["id"] = request_id
        process.stdin.write(json.dumps(packet) + "\n")
        process.stdin.flush()
        if notify:
            return
        while selector.select(30):
            line = process.stdout.readline()
            if not line:
                raise RuntimeError(f"{client} bridge closed stdout")
            response = json.loads(line)
            if response.get("id") == request_id:
                if "error" in response:
                    raise RuntimeError(str(response["error"]))
                result = response["result"]
                if result.get("isError"):
                    raise RuntimeError(str(result))
                return result
        raise TimeoutError(f"{client} MCP response timed out")

    def call(name, arguments):
        result = request("tools/call", {"name": name, "arguments": arguments})
        return json.loads(next(part["text"] for part in result["content"] if part["type"] == "text"))

    try:
        request("initialize", {"protocolVersion": "2024-11-05", "capabilities": {},
                               "clientInfo": {"name": "repo-upstream-check", "version": "1"}})
        request("notifications/initialized", {}, notify=True)
        yield call
    finally:
        selector.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def hook_command(path, event):
    config = json.loads(path.read_text())
    commands = [hook["command"] for group in config["hooks"][event]
                for hook in group.get("hooks", []) if hook.get("type") == "command"
                and "ai-memory" in hook.get("command", "")]
    if len(commands) != 1:
        raise RuntimeError(f"expected one installed {event} memory hook in {path}")
    argv = shlex.split(commands[0])
    if Path(os.path.expandvars(argv[0])).resolve() != Path(launcher).resolve() or "hook" not in argv:
        raise RuntimeError("capture hook does not use the upstream binary")
    # Upstream hooks deliberately use quoted $HOME. Let the shell execute the
    # exact installed command, as the harness does, not a rewritten approximation.
    return ["/bin/sh", "-c", commands[0]]


for client, entry in entries.items():
    with bridge(client, entry) as call:
        if "counts" not in call("memory_status", {"global": True}):
            raise RuntimeError(f"{client} memory_status lacks counts")
        print(f"PASS: installed {client} registration → authenticated local memory_status")

if args.capture:
    project = "setup-check-" + uuid.uuid4().hex
    created = False
    with tempfile.TemporaryDirectory(prefix="ai-memory-check-") as directory, bridge("Codex CLI/app", entries["Codex CLI/app"]) as call:
        cwd = Path(directory)
        (cwd / ".ai-memory.toml").write_text(f'workspace = "default"\nproject = "{project}"\n')
        try:
            for agent, path in (("claude-code", claude_home / "settings.json"),
                                ("codex", codex_home / "hooks.json")):
                session = str(uuid.uuid4())
                text = "Synthetic local capture verification " + session
                for event, payload in (("SessionStart", {}), ("UserPromptSubmit", {"prompt": text}), ("Stop", {})):
                    command = hook_command(path, event)
                    created = True
                    result = subprocess.run(command, input=json.dumps({"session_id": session, "cwd": str(cwd),
                                            "hook_event_name": event, **payload}), cwd=cwd,
                                            capture_output=True, text=True, timeout=30)
                    if result.returncode:
                        raise RuntimeError(f"{agent} {event} failed: {result.stderr}")
                deadline = time.monotonic() + 20
                while True:
                    observations = call("memory_read_session_observations", {
                        "workspace": "default", "project": project, "session_id": session,
                        "kinds": ["user-prompt", "stop"], "limit": 20})
                    drained = any(row.get("kind") == "stop" for row in observations.get("observations", []))
                    if text in json.dumps(observations) and drained:
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"{agent} prompt was not retrieved")
                    time.sleep(0.25)
                print(f"PASS: installed {agent} hook commands → capture → MCP retrieval (not harness trust)")
        finally:
            if created:
                result = subprocess.run([launcher, "purge-project", "--workspace", "default", "--project", project,
                                         "--confirm"], cwd=cwd, capture_output=True, text=True, timeout=30)
                if result.returncode:
                    raise RuntimeError(f"cleanup failed for default/{project}: {result.stderr}")
                print("PASS: removed only disposable project " + project)

result = subprocess.run([launcher, "doctor", "--json"], cwd=home, text=True, capture_output=True, timeout=40)
if result.returncode:
    raise RuntimeError("upstream doctor failed: " + result.stderr)
trust = json.loads(result.stdout).get("codex_hooks")
if trust is None:
    print("UNVERIFIED: Codex hook trust could not be determined")
elif trust.get("skipped"):
    print(f"ACTION REQUIRED: Codex skips {len(trust['skipped'])} hooks; review and trust them in /hooks or app hook settings")
else:
    print("PASS: upstream doctor reports Codex hooks trusted")
