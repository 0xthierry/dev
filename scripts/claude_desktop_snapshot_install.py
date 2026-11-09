#!/usr/bin/env python3
"""Pin vendor Desktop and prepare the research snapshot patch. macOS only.

Patch deployment is blocked: macOS rejects the preserved restricted entitlements
under ad-hoc signing. `pin` installs only the original signed vendor build.
Never stops processes or edits account/session data.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'configs/claude-desktop-patch'
PATCHER = ROOT / 'scripts/claude_desktop_snapshot_patch.py'


def run(*args):
    return subprocess.run([str(arg) for arg in args], check=True, capture_output=True, text=True)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def patch_state(app):
    return json.loads(run(sys.executable, PATCHER, 'check', '--app', app, '--manifest', CONFIG / 'manifest.json').stdout)


def verify_signature(app):
    run('/usr/bin/codesign', '--verify', '--deep', '--strict', app)
    release = json.loads((CONFIG / 'release.json').read_text())
    expected = release['signing']
    details = run('/usr/bin/codesign', '-dv', '--verbose=2', app).stderr
    flags = re.search(r'flags=0x([0-9a-f]+)', details)
    if flags is None or int(flags[1], 16) & ~2 != expected['flags_without_adhoc']:
        raise RuntimeError('Signing flags differ from the pinned app')
    if f'Identifier={expected["identifier"]}\n' not in details or f'Runtime Version={expected["runtime_version"]}\n' not in details:
        raise RuntimeError('Signing identifier/runtime differ from the pinned app')
    canonical = json.dumps(entitlements(app), sort_keys=True, separators=(',', ':')).encode()
    if hashlib.sha256(canonical).hexdigest() != expected['entitlements_sha256']:
        raise RuntimeError('Entitlements differ from the pinned vendor app')
    # Ad-hoc signatures are expected only for the exactly pinned patched state.
    state = patch_state(app)['state']
    if state == 'original' and f'TeamIdentifier={release["vendor_team_id"]}\n' not in details:
        raise RuntimeError('Original app must retain the pinned vendor signature')
    if state == 'patched' and 'Signature=adhoc\n' not in details:
        raise RuntimeError('Patched app must have the expected local ad-hoc signature')


def entitlements(app):
    data = subprocess.run(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(app)], check=True, capture_output=True).stdout
    return plistlib.loads(data)


def running_processes(app):
    # Read executable names only, never process environments or prompt arguments.
    rows = run('/bin/ps', '-axo', 'pid=,comm=').stdout.splitlines()
    root = str(app) + '/'
    return [line.strip() for line in rows if len(line.strip().split(None, 1)) == 2
            and (line.strip().split(None, 1)[1].startswith(root)
                 or '/claude-code/' in line.strip().split(None, 1)[1])]


def require_stopped(app):
    active = running_processes(app)
    if active:
        raise RuntimeError('Quit Claude Desktop and its Code sessions before install/restore. No processes were stopped.\n' + '\n'.join(active))


def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temp.open('x') as stream:
            json.dump(data, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def backup_json_write(path, value):
    if path.exists():
        if json.loads(path.read_text()) == value:
            return
        shutil.copy2(path, path.with_name(path.name + '.backup-' + uuid.uuid4().hex))
    save_json(path, value)


def pin_desktop_updates(home):
    """Preserve the selected provider profile; only add disableAutoUpdates."""
    library = home / 'Library/Application Support/Claude-3p/configLibrary'
    meta_path = library / '_meta.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {'entries': []}
    if not isinstance(meta, dict): raise ValueError('Desktop profile metadata must be an object')
    if meta.get('hybridPointer'):
        raise RuntimeError('Desktop hybrid bootstrap overrides the local profile; cannot guarantee the update pin. No profile changes made.')
    selected = meta.get('appliedId')
    if selected is not None:
        # Reject path traversal and unexpected selection state before writing.
        uuid.UUID(selected)
        profile_path = library / (selected + '.json')
        profile = json.loads(profile_path.read_text())
        if not isinstance(profile, dict): raise ValueError('Desktop profile must be an object')
        backup_json_write(profile_path, {**profile, 'disableAutoUpdates': True})
    else:
        if not isinstance(meta.get('entries', []), list): raise ValueError('Invalid Desktop profile entries')
        selected = str(uuid.uuid4())
        save_json(library / (selected + '.json'), {'disableAutoUpdates': True})
        backup_json_write(meta_path, {**meta, 'appliedId': selected, 'entries': [*meta.get('entries', []), {'id': selected, 'name': 'Repo-pinned Desktop and CLI versions'}]})


def fetch_vendor(staging, release):
    archive = staging / 'Claude.zip'
    with urllib.request.urlopen(release['desktop_url'], timeout=60) as response, archive.open('xb') as output:
        shutil.copyfileobj(response, output, 1024 * 1024)
    if digest(archive) != release['desktop_zip_sha256']:
        raise RuntimeError('Pinned Desktop ZIP checksum mismatch')
    extracted = staging / 'vendor'
    run('/usr/bin/ditto', '-x', '-k', archive, extracted)
    return extracted / 'Claude.app'


def prepare(app, state, release):
    work = Path(tempfile.mkdtemp(prefix='stage-', dir=state))
    candidate = work / 'Claude.app'
    source = app if app.exists() else fetch_vendor(work, release)
    verify_signature(source)
    version = plistlib.loads((source / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
    if version != release['desktop_version']:
        raise RuntimeError(f'Unsupported Desktop {version}; expected {release["desktop_version"]}. Refusing automatic upgrade/downgrade.')
    original_state = patch_state(source)
    # Original sources must still have Anthropic's valid signature. An already
    # patched input is validated by the pinned patcher and local signature.
    if original_state['state'] == 'original':
        details = run('/usr/bin/codesign', '-dv', '--verbose=2', source).stderr
        if f'TeamIdentifier={release["vendor_team_id"]}' not in details:
            raise RuntimeError('Original app is not signed by the pinned vendor team')
    expected_entitlements = entitlements(source)
    run('/usr/bin/ditto', source, candidate)
    run(sys.executable, PATCHER, 'apply', '--app', candidate, '--manifest', CONFIG / 'manifest.json')
    run('/usr/bin/codesign', '--force', '--sign', '-', '--preserve-metadata=identifier,entitlements,flags,runtime', candidate)
    verify_signature(candidate)
    if entitlements(candidate) != expected_entitlements:
        raise RuntimeError('Signing changed entitlements; refusing deployment')
    checked = patch_state(candidate)
    if checked['state'] != 'patched': raise RuntimeError('Staged app is not patched')
    record = {'candidate': str(candidate), 'target': str(app), 'desktop_version': release['desktop_version'], 'code_version': release['code_version'], 'signature': 'local ad-hoc, original entitlements preserved', 'gui_verified': False}
    save_json(work / 'prepared.json', record)
    save_json(state / 'prepared.json', record)
    return candidate


def refuse_patch_deployment():
    release = json.loads((CONFIG / 'release.json').read_text())
    reason = release.get('patch_deployment_blocked_reason') or 'No supported patch deployment mechanism is implemented.'
    raise RuntimeError('PATCH DEPLOYMENT BLOCKED: ' + reason)


def pin_vendor(app, state, release):
    if app.exists():
        verify_signature(app)
        if patch_state(app)['state'] != 'original':
            raise RuntimeError('Version pin requires the original signed vendor app')
    else:
        require_stopped(app)
        work = Path(tempfile.mkdtemp(prefix='vendor-', dir=state))
        source = fetch_vendor(work, release)
        verify_signature(source)
        if patch_state(source)['state'] != 'original': raise RuntimeError('Download is not the original pinned vendor app')
        app.parent.mkdir(parents=True, exist_ok=True)
        adjacent = app.parent / ('.Claude.vendor-stage-' + uuid.uuid4().hex)
        run('/usr/bin/ditto', source, adjacent)
        verify_signature(adjacent)
        require_stopped(app)
        if app.exists(): raise RuntimeError('App appeared during download; refusing replacement')
        adjacent.rename(app)
    pin_desktop_updates(Path.home())
    return {'state': 'vendor-pinned', 'desktop_version': release['desktop_version'], 'code_version': release['code_version'], 'snapshot_patch_installed': False, 'patch_deployment_blocked_reason': release['patch_deployment_blocked_reason']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'pin', 'prepare', 'install', 'restore'])
    parser.add_argument('--app', type=Path, default=Path('/Applications/Claude.app'))
    parser.add_argument('--state', type=Path, default=Path.home() / '.local/share/dev-setup/claude-desktop-patch')
    parser.add_argument('--prepared', type=Path, help='Reserved: patch deployment is currently blocked')
    parser.add_argument('--backup', type=Path, help='Reserved: patch deployment and restore are currently blocked')
    args = parser.parse_args()
    if args.prepared is not None and args.action != 'install':
        parser.error('--prepared is accepted only with install')
    if platform.system() != 'Darwin': raise RuntimeError('This pinned Desktop patch is macOS-only')
    app = args.app.absolute()
    if app.suffix != '.app': raise RuntimeError('Destination must be an explicit .app bundle')
    if app.is_symlink() or app.resolve() != app: raise RuntimeError('App path must not contain symlinks')
    state_path = args.state.resolve()
    if state_path == app or app in state_path.parents:
        raise RuntimeError('State/staging must be outside the installed app')
    args.state = state_path
    release = json.loads((CONFIG / 'release.json').read_text())
    manifest = json.loads((CONFIG / 'manifest.json').read_text())
    if (release['desktop_version'], release['code_version']) != (manifest['desktop_version'], manifest['engine_version']):
        raise RuntimeError('Release pins and patch manifest versions disagree')
    if args.action in ('install', 'restore'):
        refuse_patch_deployment()
    if args.action == 'status':
        result = patch_state(app) if app.exists() else {'state': 'absent'}
        result['patch_deployment_blocked_reason'] = release['patch_deployment_blocked_reason']
        if app.exists(): verify_signature(app)
        print(json.dumps(result, indent=2))
        return
    os.umask(0o077)
    args.state.mkdir(parents=True, exist_ok=True)
    with (args.state / '.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == 'pin':
            print(json.dumps(pin_vendor(app, args.state, release), indent=2))
            return
        candidate = prepare(app, args.state, release)
        print(json.dumps({'state': 'prepared-not-installed', 'candidate': str(candidate), 'gui_verified': False, 'deployment_blocked_reason': release['patch_deployment_blocked_reason']}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'error: {error}', file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr, file=sys.stderr)
        raise SystemExit(1)
