"""Maintain the official signed app at its TCC/LaunchServices identity path.

The tag-pinned upstream _install-rust.sh documents why a versioned symlink
or bare executable is not equivalent. Never sign, grant, reset, or run connect.
"""
import ctypes
import os
from pathlib import Path
import plistlib
import re
import socket
import subprocess
import sys
import tempfile

APP = Path('/Applications/CuaDriver.app')
DRIVER = Path('Contents/MacOS/cua-driver')
TEAM = 'YCK386LBJ7'
BUNDLE = 'com.trycua.driver'
REQUIREMENT = f'identifier "{BUNDLE}" and anchor apple generic and certificate leaf[subject.OU] = "{TEAM}"'
LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister'
LABEL = 'dev.setup.cua-driver'


def verify(app, version=None):
    if app.is_symlink() or not app.is_dir():
        raise ValueError(f'expected a real, signed app at {app}')
    subprocess.run(['codesign', '--verify', '--all-architectures', '--deep', '--strict', '-R', '=' + REQUIREMENT, app], check=True)
    with (app / 'Contents/Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    if info.get('CFBundleIdentifier') != BUNDLE or info.get('CFBundleExecutable') != 'cua-driver':
        raise ValueError('unexpected Cua Driver bundle identity or executable')
    if version is not None:
        if info.get('CFBundleShortVersionString') != version:
            raise ValueError('unexpected Cua Driver version')
        subprocess.run(['lipo', app / DRIVER, '-verify_arch', 'arm64', 'x86_64'], check=True)
    return info['CFBundleShortVersionString']


def exchange(left, right):
    # renamex_np(RENAME_SWAP): same-volume atomic exchange of nonempty directories.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.renamex_np(os.fsencode(left), os.fsencode(right), 2) != 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))


def install(source, version):
    verify(source, version)
    # Stage on the destination volume; ditto preserves the signed bundle's metadata.
    # Retain the old app under a hidden, unique backup outside LaunchServices discovery.
    with tempfile.TemporaryDirectory(prefix='.cua-stage-', dir=APP.parent) as tmp:
        staged = Path(tmp) / APP.name
        subprocess.run(['ditto', source, staged], check=True)
        verify(staged, version)
        previous = os.path.lexists(APP)
        if previous:
            verify(APP)
            text = subprocess.check_output(['codesign', '-d', '-r-', APP], stderr=subprocess.STDOUT, text=True)
            requirement = re.search(r'^(?:# )?designated => (.+)$', text, re.M)
            if not requirement:
                raise ValueError('previous signing requirement unavailable; leaving installed app untouched')
            subprocess.run(['codesign', '--verify', '--all-architectures', '--strict', '-R', '=' + requirement[1], staged], check=True)
            backup = Path(tempfile.mkdtemp(prefix='.cua-driver-backup-', dir=APP.parent)) / APP.name
            # Exchange directly with the retained backup, so an interrupted run never
            # leaves the old app in an automatically cleaned staging directory.
            staged.rename(backup)
            exchange(backup, APP)
        else:
            staged.rename(APP)
        try:
            verify(APP, version)
            subprocess.run([LSREGISTER, '-f', APP], check=True)
        except BaseException:
            if previous:
                exchange(backup, APP)
                subprocess.run([LSREGISTER, '-f', APP], check=False)
            else:
                APP.rename(staged)
            raise
        if previous:
            print(f'  Previous Cua Driver app retained at {backup}')


def launch_plist(version):
    return {'Label': LABEL, 'ProgramArguments': [str(APP / DRIVER), 'serve', '--no-automation-prompts'],
            'EnvironmentVariables': {'CUA_SETUP_RELEASE': version, 'CUA_DRIVER_RS_TELEMETRY_ENABLED': 'false',
                                     'CUA_DRIVER_RS_UPDATE_CHECK': 'false'}, 'LimitLoadToSessionType': 'Aqua',
            'RunAtLoad': True, 'KeepAlive': True}


def service(version, *, preflight=False):
    home = Path.home()
    plist = home / 'Library/LaunchAgents' / (LABEL + '.plist')
    desired = launch_plist(version)
    old = None
    if os.path.lexists(plist):
        if plist.is_symlink() or not plist.is_file():
            raise ValueError(f'refusing to replace unrelated {plist}')
        with plist.open('rb') as stream:
            old = plistlib.load(stream)
        old_version = old.get('EnvironmentVariables', {}).get('CUA_SETUP_RELEASE', '')
        if not old_version or old != launch_plist(old_version):
            raise ValueError(f'refusing to replace unmanaged LaunchAgent: {plist}')
    domain = f'gui/{os.getuid()}'
    job = f'{domain}/{LABEL}'
    def inspect(target):
        return subprocess.run(['launchctl', 'print', target], capture_output=True, text=True)
    gui = inspect(domain).returncode == 0
    loaded = inspect(job) if gui else None
    active = loaded is not None and loaded.returncode == 0
    # launchctl has no JSON print API; validate entire fields and on-disk ownership.
    fields = {line.strip() for line in loaded.stdout.splitlines()} if active else set()
    if active and (not old or f'path = {plist}' not in fields or f'program = {APP / DRIVER}' not in fields):
        raise ValueError(f'refusing to modify unrecognized loaded job: {job}')
    if not active and gui:
        endpoint = home / 'Library/Caches/cua-driver/cua-driver.sock'
        if endpoint.exists():
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                probe.settimeout(2)
                try:
                    probe.connect(str(endpoint))
                except (ConnectionRefusedError, FileNotFoundError):
                    pass
                else:
                    raise ValueError('another Cua daemon owns the socket; stop it explicitly before configuring the managed job')
    if preflight:
        return
    if old != desired:
        plist.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=plist.parent, delete=False) as stream:
            temp = Path(stream.name)
            try:
                plistlib.dump(desired, stream)
                stream.flush()
                os.replace(temp, plist)
            finally:
                temp.unlink(missing_ok=True)
    if not gui:
        print('  LaunchAgent installed; it will start at the next graphical login')
        return
    if active and f'CUA_SETUP_RELEASE => {version}' not in fields:
        subprocess.run(['launchctl', 'bootout', job], check=True)
        active = False
    if not active:
        subprocess.run(['launchctl', 'bootstrap', domain, plist], check=True)


if __name__ == '__main__':
    try:
        action, version, *args = sys.argv[1:]
        if action == 'ready':
            verify(APP, version)
        elif action == 'install':
            install(Path(args[0]), version)
        elif action in ('preflight', 'service'):
            service(version, preflight=action == 'preflight')
        else:
            raise ValueError('unexpected macOS installer action')
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        sys.exit(f'error: macOS Cua Driver: {exc}')
