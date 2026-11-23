#!/usr/bin/env python3
"""Omarchy-only operator check: launch a disposable Wayland GTK entry, observe
its exact window, attempt one background AT-SPI write, and check its own state.
Requires a running managed Cua service. No screenshots or foreground fallback.
"""
import argparse
import asyncio
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
from contextlib import asynccontextmanager

FIXTURE = Path(__file__).resolve().parent / 'fixtures/cua-native.py'
LAUNCHER = Path.home() / '.local/bin/cua-driver-mcp'


class Blocked(Exception):
    """Known, report-safe reason not to claim completion."""


class Refused(Blocked):
    pass


def require(condition, reason):
    if not condition:
        raise Blocked(reason)


def foreground():
    raw = subprocess.check_output(['hyprctl', '-j', 'activewindow'], timeout=4, stderr=subprocess.DEVNULL)
    window = json.loads(raw)
    require(isinstance(window, dict), 'invalid compositor foreground response')
    identity = (window.get('pid'), window.get('address', ''))
    require(type(identity[0]) is int and identity[0] > 0 and isinstance(identity[1], str)
            and re.fullmatch('0x[0-9a-fA-F]+', identity[1]),
            'cannot identify the current foreground window')
    return identity  # Never retain titles, app names or unrelated window lists.


@asynccontextmanager
async def proxy():
    proc = await asyncio.create_subprocess_exec(str(LAUNCHER), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=subprocess.DEVNULL, limit=8 * 1024 * 1024)
    sequence = 0

    async def send(message):
        proc.stdin.write(json.dumps({'jsonrpc': '2.0', **message}).encode() + b'\n')
        await proc.stdin.drain()

    async def request(method, params):
        nonlocal sequence
        sequence += 1
        await send({'id': sequence, 'method': method, 'params': params})
        async with asyncio.timeout(20):
            while line := await proc.stdout.readline():
                msg = json.loads(line)
                if msg.get('id') == sequence:
                    require('result' in msg, 'proxy rejected ' + method)
                    return msg['result']
        raise Blocked('managed proxy disconnected')

    try:
        init = await request('initialize', {'protocolVersion': '2025-03-26', 'capabilities': {},
                             'clientInfo': {'name': 'native-fixture-check', 'version': '1'}})
        require(init['serverInfo']['version'] == '0.59.4', 'unqualified daemon version')
        await send({'method': 'notifications/initialized'})
        tools = {t['name']: t['inputSchema']['properties'] for t in (await request('tools/list', {}))['tools']}

        async def call(name, /, **args):
            require(name in tools and args.keys() <= tools[name].keys(), 'incompatible schema for ' + name)
            result = await request('tools/call', {'name': name, 'arguments': args})
            data = result.get('structuredContent') or {}
            if data.get('status') == 'refused' or data.get('effect') == 'refused' or result.get('isError'):
                code = (data.get('refusal') or {}).get('code') or data.get('code')
                safe = code if isinstance(code, str) and re.fullmatch('[a-z_]{1,80}', code) else 'unspecified'
                if data.get('status') == 'refused' or data.get('effect') == 'refused' or safe in (
                        'set_value_unavailable', 'background_unavailable', 'permission_denied'):
                    raise Refused(name + ': ' + safe)
                raise Blocked(name + ' returned an error: ' + safe)
            return data

        yield call
    finally:
        proc.stdin.close()
        try:
            await asyncio.wait_for(proc.wait(), 3)
        except TimeoutError:
            proc.kill()  # Only this check's stdio proxy, not the managed daemon.
            await proc.wait()


async def exercise(call, root, initial, report):
    session = {'session': root.name}
    report['stage'] = 'launch'
    launched = await call('launch_app', name='/usr/bin/python3', additional_arguments=[str(FIXTURE), str(root)], **session)
    pid = launched.get('pid')
    require(type(pid) is int and pid > 0 and pid == launched.get('launcher_pid'), 'unproven launch PID')
    for _ in range(40):
        if (root / 'pid').is_file() and (root / 'pid').read_text() == str(pid):
            break
        await asyncio.sleep(.1)
    else:
        raise Blocked('fixture did not publish matching PID')
    report['fixture_pid'] = pid
    report['stage'] = 'discover'
    for _ in range(20):
        windows = (await call('list_windows', pid=pid, **session))['windows']
        if windows:
            break
        await asyncio.sleep(.15)
    require(len(windows) == 1 and windows[0].get('pid') == pid and
            windows[0].get('title') == 'Cua native check ' + root.name, 'unproven fixture window')
    wid = windows[0]['window_id']
    require(type(wid) is int and wid > 0, 'invalid fixture window ID')
    report['window_id'] = wid
    target = dict(session, pid=pid, window_id=wid)
    name = 'Fixture value ' + root.name

    async def observe():
        state = await call('get_window_state', **target, tree_format='elements', include_screenshot=False,
                           timeout_ms=4000)
        require((state.get('pid'), state.get('window_id')) == (pid, wid), 'unproven snapshot window')
        rows = [e for e in state.get('elements', []) if e.get('label') == name]
        require(len(rows) == 1, 'fixture entry absent or ambiguous in AT-SPI tree')
        token = rows[0].get('element_token', '')
        require(re.fullmatch(r's[0-9a-f]{8}:[0-9]+', token) and token.split(':')[0] == state.get('snapshot_id'),
                'fixture entry lacks a current snapshot token')
        return token

    report['stage'] = 'observe'
    token = await observe()
    report['native_observation'] = 'passed'
    before = foreground()
    report['foreground_before_action'] = dict(pid=before[0], address=before[1])
    require(before == initial and initial[0] != pid, 'foreground changed before action')
    require((root / 'value').read_text() == '', 'fixture entry was not initially empty')
    value = 'Verified ' + root.name
    report.update(stage='action', action_attempted=True)
    try:
        action = await call('set_value', **target, element_token=token, value=value, delivery_mode='background')
    finally:
        try:
            report['fixture_value_matches'] = (root / 'value').read_text() == value
            report['foreground_unchanged_after_action'] = foreground() == initial
        except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
            report['post_action_readback_error'] = str(exc) if isinstance(exc, Blocked) else type(exc).__name__
    require('post_action_readback_error' not in report, 'post-action readback unavailable')
    require(action.get('path') == 'ax', 'semantic delivery unproven; no retry')
    require(report['fixture_value_matches'], 'fixture value did not match; no retry')
    require(report['foreground_unchanged_after_action'], 'foreground changed during check')
    report['stage'] = 'verify'
    await observe()
    require((root / 'value').read_text() == value, 'fixture did not retain expected state')
    report['semantic_route'] = 'ax'


def fixture_window_absent(pid):
    raw = subprocess.check_output(['hyprctl', '-j', 'clients'], timeout=4, stderr=subprocess.DEVNULL)
    clients = json.loads(raw)
    require(isinstance(clients, list) and all(isinstance(c, dict) and type(c.get('pid')) is int
                                              for c in clients), 'cannot verify compositor client PIDs')
    return not any(c['pid'] == pid for c in clients)  # Do not record any client listing.


async def cleanup(root, lease, initial, report):
    errors = []
    try:
        (root / 'lease').unlink()
        deadline = time.monotonic() + 5
        while True:
            try:
                fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                require(time.monotonic() < deadline, 'fixture cleanup not verified')
                await asyncio.sleep(.1)
        report['fixture_lease_released'] = True
        if 'fixture_pid' in report:
            report['fixture_window_absent'] = fixture_window_absent(report['fixture_pid'])
            require(report['fixture_window_absent'], 'fixture PID still has a compositor window')
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        errors.append(str(exc) if isinstance(exc, Blocked) else type(exc).__name__)
    try:
        final = foreground()
        report['foreground_final'] = dict(pid=final[0], address=final[1])
        report['foreground_unchanged_after_cleanup'] = final == initial
        require(final == initial, 'foreground changed; not restored by checker')
    except (Blocked, OSError, ValueError, subprocess.SubprocessError) as exc:
        errors.append(str(exc) if isinstance(exc, Blocked) else type(exc).__name__)
    report['cleanup_errors'] = errors


async def run(report):
    report['action_attempted'] = False
    initial = foreground()
    report['foreground_initial'] = dict(pid=initial[0], address=initial[1])
    with tempfile.TemporaryDirectory(prefix='cua-native-') as tmp:
        root = Path(tmp)
        with (root / 'lease').open('x') as lease:
            try:
                async with proxy() as call:
                    await exercise(call, root, initial, report)
            finally:
                await cleanup(root, lease, initial, report)
            # Reached only when exercise succeeded. A primary failure propagates
            # unchanged, with any independent cleanup failures alongside it.
            require(not report['cleanup_errors'], 'cleanup postcondition failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='authorize this disposable GTK window and one semantic write')
    parser.add_argument('--report', type=Path, help='new JSON report path (created exclusively, mode 0600)')
    args = parser.parse_args()
    if not args.run or not args.report:
        parser.error('both --run and --report NEW_FILE are required; nothing was started')
    report = {'status': 'blocked', 'stage': 'preflight', 'native_observation': 'not_exercised'}
    with os.fdopen(os.open(args.report, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'w') as output:
        try:
            asyncio.run(run(report))
            report.update(status='passed', stage='complete')
        except Refused as exc:
            report.update(status='refused', reason=str(exc))
        except Blocked as exc:
            report['reason'] = str(exc)
        except (OSError, subprocess.SubprocessError, TypeError, KeyError, ValueError, KeyboardInterrupt) as exc:
            report['reason'] = type(exc).__name__  # Do not log raw protocol or desktop data.
        json.dump(report, output, indent=2)
        output.write('\n')
    print(f"{report['status']}: {args.report}")
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
