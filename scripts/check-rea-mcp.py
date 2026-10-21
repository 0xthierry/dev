#!/usr/bin/env python3
"""Exercise installed REA over stdio MCP against an isolated, temporary JS fixture.

No target apps, credentials, browsers, native engines, or client configs are changed.
The report goes to stdout. REA's process and the fixture are removed on exit.
"""
import argparse
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def check(launcher):
    expected_version = json.loads((ROOT / "configs/rea/package.json").read_text())["dependencies"]["rea-agents"]
    with tempfile.TemporaryDirectory(prefix="rea-mcp-check-") as directory, tempfile.TemporaryFile() as errors:
        fixture = Path(directory)
        (fixture / "package.json").write_text(json.dumps({"name": "rea-check-fixture", "version": "1.0.0", "main": "index.js"}))
        (fixture / "index.js").write_text("module.exports = function greet(name) { return 'Hello, ' + name; };\n")
        process = subprocess.Popen([str(launcher)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=errors, start_new_session=True)
        stdin, stdout = process.stdin, process.stdout
        assert stdin is not None and stdout is not None
        pending = bytearray()
        request_id = 0

        def send(message):
            stdin.write(json.dumps({"jsonrpc": "2.0", **message}).encode() + b"\n")
            stdin.flush()

        def request(method, params):
            nonlocal request_id
            request_id += 1
            send({"id": request_id, "method": method, "params": params})
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                if b"\n" not in pending:
                    ready, _, _ = select.select([stdout], [], [], max(0, deadline - time.monotonic()))
                    if not ready:
                        break
                    data = os.read(stdout.fileno(), 65536)
                    if not data:
                        errors.seek(0)
                        raise RuntimeError("REA exited before its response: " + errors.read(8192).decode(errors="replace"))
                    pending.extend(data)
                    if len(pending) > 16 * 1024 * 1024:
                        raise RuntimeError("REA response exceeded 16 MiB")
                    continue
                line, _, remainder = pending.partition(b"\n")
                pending[:] = remainder
                message = json.loads(line)
                if message.get("id") != request_id:
                    continue
                if "error" in message:
                    raise RuntimeError(f"{method}: {message['error']}")
                return message["result"]
            raise TimeoutError(f"Timed out waiting for REA {method}")

        try:
            initialized = request("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                                  "clientInfo": {"name": "dev-setup-rea-check", "version": "1.0.0"}})
            actual_version = initialized["serverInfo"]["version"]
            if actual_version != expected_version:
                raise RuntimeError(f"Expected REA {expected_version}, got {actual_version}")
            send({"method": "notifications/initialized"})
            tools = request("tools/list", {})["tools"]
            names = {tool["name"] for tool in tools}
            if not {"binary_session", "analyze_javascript_application"}.issubset(names):
                raise RuntimeError("REA did not advertise the expected analysis tools")
            session = request("tools/call", {"name": "binary_session", "arguments": {}})
            if session.get("isError"):
                raise RuntimeError(f"REA session check failed: {session}")
            analysis = request("tools/call", {"name": "analyze_javascript_application", "arguments": {"input_path": str(fixture)}})
            if analysis.get("isError"):
                raise RuntimeError(f"REA JavaScript analysis failed: {analysis}")
            # Tool payloads may carry application-level failure inside a successful MCP envelope.
            payload = analysis.get("structuredContent")
            if payload is None:
                payload = json.loads(next(part["text"] for part in analysis["content"] if part["type"] == "text"))
            if payload.get("ok") is False or payload.get("error"):
                raise RuntimeError(f"REA JavaScript analysis failed: {payload}")
            if payload.get("operation") != "analyze_javascript_application" or payload["subject"]["local_path"] != str(fixture):
                raise RuntimeError("REA returned evidence for an unexpected operation or target")
            graph = payload["normalized_result"]["graph"]
            modules = [observation["properties"] for node in graph["nodes"]
                       for observation in node["observations"]
                       if observation["properties"].get("semantic_role") == "source-module"]
            observed = [{key: module[key] for key in ("path", "module_format", "export_names")} for module in modules]
            if observed != [{"path": "index.js", "module_format": "commonjs", "export_names": ["default"]}]:
                raise RuntimeError(f"REA did not recover the fixture's CommonJS export: {observed}")
            return {"status": "passed", "server_version": actual_version, "tools": len(tools),
                    "session_check": "passed", "javascript_analysis": "index.js CommonJS default export recovered"}
        finally:
            stdin.close()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            stdout.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launcher", type=Path, default=Path.home() / ".local/bin/rea-mcp")
    args = parser.parse_args()
    print(json.dumps(check(args.launcher), indent=2))
