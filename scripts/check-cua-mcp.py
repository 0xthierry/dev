#!/usr/bin/env python3
"""Check the installed Cua stdio proxy and read-only guide against its live daemon.

This is MCP discovery/communication evidence, not GUI acceptance. It does not
launch an app, capture a screen, send input, grant permissions or attach a browser.
The managed daemon must already be running. Only the proxy process is cleaned up.
"""
import argparse
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def check(launcher):
    expected = re.search(r'^CUA_DRIVER_VERSION="?([0-9][0-9A-Za-z.+-]*)"?$',
                         (ROOT / 'install/cua-driver.sh').read_text(), re.MULTILINE)
    if expected is None:
        raise RuntimeError('Cua runtime pin is missing')
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen([str(launcher)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=errors,
                                   start_new_session=True)
        stdin, stdout = process.stdin, process.stdout
        assert stdin is not None and stdout is not None
        pending = bytearray()
        request_id = 0

        def send(message):
            stdin.write(json.dumps({'jsonrpc': '2.0', **message}).encode() + b'\n')
            stdin.flush()

        def request(method, params):
            nonlocal request_id
            request_id += 1
            send({'id': request_id, 'method': method, 'params': params})
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                if b'\n' not in pending:
                    ready, _, _ = select.select([stdout], [], [], max(0, deadline - time.monotonic()))
                    if not ready:
                        break
                    chunk = os.read(stdout.fileno(), 65536)
                    if not chunk:
                        raise RuntimeError('Cua proxy exited before its response; check the managed daemon')
                    pending.extend(chunk)
                    if len(pending) > 16 * 1024 * 1024:
                        raise RuntimeError('Cua response exceeds the verification limit')
                    continue
                line, _, remainder = pending.partition(b'\n')
                pending[:] = remainder
                message = json.loads(line)
                if message.get('id') != request_id:
                    continue
                if 'error' in message:
                    raise RuntimeError(f'Cua rejected {method}: code {message["error"].get("code")}')
                return message['result']
            raise TimeoutError(f'Timed out waiting for Cua {method}')

        try:
            initialized = request('initialize', {
                'protocolVersion': '2025-03-26', 'capabilities': {},
                'clientInfo': {'name': 'dev-setup-cua-check', 'version': '1.0.0'}})
            actual = initialized['serverInfo']['version']
            if actual != expected.group(1):
                raise RuntimeError(f'Expected Cua {expected.group(1)}, got {actual}')
            send({'method': 'notifications/initialized'})
            tools = request('tools/list', {})['tools']
            names = {tool['name'] for tool in tools}
            required = {'get_guide', 'list_windows', 'get_window_state', 'click',
                        'type_text', 'get_browser_state', 'browser_click'}
            if not required <= names:
                raise RuntimeError('Cua did not advertise the expected native and browser tools')
            guide = request('tools/call', {'name': 'get_guide', 'arguments': {'topic': 'overview'}})
            if guide.get('isError') or not any(part.get('type') == 'text' and part.get('text')
                                             for part in guide.get('content', [])):
                raise RuntimeError('Cua read-only guide request did not return content')
            return {'status': 'passed', 'server_version': actual, 'tools': len(tools),
                    'guide_call': 'passed', 'gui_acceptance': 'not_exercised',
                    'launcher': str(launcher)}
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


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--launcher', type=Path, default=Path.home() / '.local/bin/cua-driver-mcp')
    args = parser.parse_args()
    print(json.dumps(check(args.launcher), indent=2))
