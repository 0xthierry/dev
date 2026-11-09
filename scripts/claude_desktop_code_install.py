#!/usr/bin/env python3
"""Install the exact signed Code bundle selected by the pinned macOS Desktop.
The CLI links to Desktop's checksum-keyed managed path; no mutable install.sh.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def validate_members(members):
    seen = set()
    for entry in members:
        path = PurePosixPath(entry.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != 'claude.app':
            raise ValueError('Unconfined Code archive member')
        if entry.name in seen: raise ValueError('Duplicate Code archive member')
        seen.add(entry.name)
        if not (entry.isfile() or entry.isdir() or entry.issym() or entry.islnk()):
            raise ValueError('Unsupported Code archive entry')
        if (entry.issym() or entry.islnk()) and PurePosixPath(entry.linkname).is_absolute():
            raise ValueError('Absolute archive link')
    # tarfile's data filter also checks resolved links during extraction.


def verify(slot, release, bundle):
    app = slot / 'claude.app'
    binary = app / 'Contents/MacOS/claude'
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    details = subprocess.run(['/usr/bin/codesign', '-dv', '--verbose=2', str(app)], check=True, capture_output=True, text=True).stderr
    if f'TeamIdentifier={release["vendor_team_id"]}' not in details:
        raise ValueError('Code bundle vendor signature mismatch')
    if sha256(binary) != bundle['executable_sha256']:
        raise ValueError('Pinned Code executable checksum mismatch')
    if (slot / '.verified').read_text().strip() != bundle['sha256']:
        raise ValueError('Code installation checksum marker mismatch')
    with tempfile.TemporaryDirectory(prefix='claude-version-') as home:
        env = {'PATH': os.environ['PATH'], 'HOME': home, 'CLAUDE_CONFIG_DIR': home + '/.claude', 'DISABLE_AUTOUPDATER': '1', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'}
        actual = subprocess.check_output([str(binary), '--version'], env=env, cwd=home, text=True, timeout=15).strip()
    if actual != release['code_version'] + ' (Claude Code)':
        raise ValueError(f'Unexpected Code version: {actual}')
    return binary


def install(home, release):
    bundle = release['code_bundles'][platform.machine()]
    parent = home / 'Library/Application Support/Claude/claude-code' / release['code_version']
    slot = parent / bundle['sha256'][:12]
    parent.mkdir(parents=True, exist_ok=True)
    if not slot.exists():
        if not shutil.which('zstd'): raise RuntimeError('zstd is required; install the macbook package set first')
        with tempfile.TemporaryDirectory(prefix='.repo-stage-', dir=parent) as temp:
            stage = Path(temp)
            archive = stage / 'claude.app.tar.zst'
            url = release['code_base_url'] + '/' + release['code_version'] + '/' + bundle['platform'] + '/claude.app.tar.zst'
            with urllib.request.urlopen(url, timeout=60) as response, archive.open('xb') as output:
                shutil.copyfileobj(response, output, 1024 * 1024)
            if archive.stat().st_size != bundle['size'] or sha256(archive) != bundle['sha256']:
                raise ValueError('Code archive checksum/size mismatch')
            tar_path = stage / 'claude.app.tar'
            with tar_path.open('xb') as output:
                subprocess.run(['zstd', '--decompress', '--stdout', str(archive)], stdout=output, check=True)
            unpacked = stage / 'payload'
            unpacked.mkdir()
            with tarfile.open(tar_path) as source:
                validate_members(source.getmembers())
                source.extractall(unpacked, filter='data')
            (unpacked / '.verified').write_text(bundle['sha256'])
            verify(unpacked, release, bundle)
            # Never merge or overwrite another installer's populated slot.
            unpacked.rename(slot)
    binary = verify(slot, release, bundle)
    target = home / '.local/bin/claude'
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_symlink() and target.resolve() == binary.resolve():
        return binary
    if target.exists() or target.is_symlink():
        backup = target.with_name('claude.backup-' + uuid.uuid4().hex)
        if target.is_symlink(): backup.symlink_to(os.readlink(target))
        else: shutil.copy2(target, backup)
    temp_link = target.with_name('.claude-' + uuid.uuid4().hex)
    try:
        temp_link.symlink_to(binary)
        temp_link.replace(target)
    finally:
        temp_link.unlink(missing_ok=True)
    return binary


def main():
    if platform.system() != 'Darwin': raise RuntimeError('Pinned Desktop Code bundle is macOS-only')
    os.umask(0o077)
    release = json.loads((ROOT / 'configs/claude-desktop-patch/release.json').read_text())
    manifest = json.loads((ROOT / 'configs/claude-desktop-patch/manifest.json').read_text())
    if release['code_version'] != manifest['engine_version']:
        raise RuntimeError('CLI release and Desktop engine pins disagree')
    binary = install(Path.home(), release)
    print(json.dumps({'version': release['code_version'], 'shared_executable': str(binary)}))


if __name__ == '__main__':
    main()
