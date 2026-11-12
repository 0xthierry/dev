#!/usr/bin/env python3
"""Explicit, reversible macOS trial. Never called by normal setup."""
import argparse
import contextlib
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
import tempfile

ROOT = Path(__file__).resolve().parents[1]
ENGINE = Path('Contents/MacOS/claude')


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, **kwargs)


def pins(root):
    directory = root / 'configs/claude-desktop-patch'
    release = json.loads((directory / 'release.json').read_text())
    manifest = json.loads((directory / 'manifest.json').read_text())
    if (release['code_version'], manifest['engine_version'], release['desktop_version'], manifest['desktop_version']) != ('2.1.321', '2.1.321', '4.23118.1', '4.23118.1'):
        raise RuntimeError('Trial supports only engine 2.1.321 / Desktop 4.23118.1')
    return release, manifest


def verify_signature(app, team):
    run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)])
    details = run(['/usr/bin/codesign', '-dv', '--verbose=2', str(app)]).stderr.splitlines()
    if 'TeamIdentifier=' + team not in details:
        raise RuntimeError('Vendor signature team mismatch')


def running_processes():
    # Executable names only: never collect process arguments or credentials.
    lines = run(['/bin/ps', '-axo', 'pid=,comm=']).stdout.splitlines()
    active = []
    for line in lines:
        fields = line.strip().split(None, 1)
        if len(fields) != 2 or int(fields[0]) == os.getpid():
            continue
        executable = fields[1]
        if executable == '/Applications/Claude.app/Contents/Helpers/chrome-native-host':
            continue
        if ('/Claude.app/' in executable or '/claude.app/' in executable or
                Path(executable).name in ('claude', 'Claude')):
            active.append(int(fields[0]))
    return active


def require_stopped():
    active = running_processes()
    if active:
        raise RuntimeError(f'Close Claude Desktop and all Claude engines (PIDs {active}). No processes were stopped.')


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_copy(source, target):
    fd, name = tempfile.mkstemp(prefix='.proxy-trial-', dir=target.parent)
    os.close(fd)
    temp = Path(name)
    try:
        shutil.copy2(source, temp)
        with temp.open('rb') as stream:
            os.fsync(stream.fileno())
        os.replace(temp, target)
        fsync_directory(target.parent)
    finally:
        temp.unlink(missing_ok=True)


class Trial:
    def __init__(self, home, app=Path('/Applications/Claude.app'), root=ROOT):
        if platform.system() != 'Darwin':
            raise RuntimeError('Proxy trial is macOS-only')
        if platform.machine() not in ('arm64', 'x86_64'):
            raise RuntimeError('Unsupported macOS architecture')
        self.home, self.app, self.root = home, app, root
        self.release, self.manifest = pins(root)
        self.bundle = self.release['code_bundles'][platform.machine()]
        self.slot = home / 'Library/Application Support/Claude/claude-code' / self.release['code_version'] / self.bundle['sha256'][:12]
        self.container = self.slot / 'claude.app'
        self.binary = self.container / ENGINE
        self.link = home / '.local/bin/claude'
        self.state = home / '.local/share/dev-setup/claude-snapshot-proxy'
        self.backup = self.state / 'original/claude.app'
        self.proxy = self.state / 'proxy'
        self.record = self.state / 'state.json'

    def preflight(self):
        if platform.system() != 'Darwin':
            raise RuntimeError('Proxy trial is macOS-only')
        with (self.app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        if (info.get('CFBundleShortVersionString') != self.release['desktop_version'] or
                info.get('CFBundleIdentifier') != self.manifest['bundle_identifier']):
            raise RuntimeError('Desktop exact version/identifier mismatch')
        verify_signature(self.app, self.release['vendor_team_id'])
        if not self.binary.is_file() or self.binary.is_symlink():
            raise RuntimeError('Managed executable must be a regular file')
        if (self.slot / '.verified').read_text().strip() != self.bundle['sha256']:
            raise RuntimeError('Managed .verified marker mismatch')
        if not self.link.is_symlink() or self.link.resolve() != self.binary.resolve():
            raise RuntimeError('Shared CLI symlink does not point to the managed slot')

    def verify_original(self, app):
        if sha256(app / ENGINE) != self.bundle['executable_sha256']:
            raise RuntimeError('Original engine checksum mismatch')
        verify_signature(app, self.release['vendor_team_id'])

    def source_hashes(self):
        source = self.root / 'configs/claude-snapshot-proxy'
        production = {path.name for path in source.glob('*.go') if not path.name.endswith('_test.go')}
        if production != {'proxy.go'}:
            raise RuntimeError('Unexpected production Go inputs; trial supports only proxy.go')
        return {name: sha256(source / name) for name in ('go.mod', 'proxy.go')}

    def load_record(self):
        if not self.record.exists():
            return None
        data = json.loads(self.record.read_text())
        expected = {'schema': 1, 'slot': str(self.binary), 'engine': str(self.backup / ENGINE),
                    'engine_sha256': self.bundle['executable_sha256'],
                    'desktop_version': self.release['desktop_version'], 'code_version': self.release['code_version']}
        if any(data.get(key) != value for key, value in expected.items()):
            raise RuntimeError('Trial state identity mismatch')
        if not re.fullmatch('[0-9a-f]{64}', data.get('proxy_sha256', '')):
            raise RuntimeError('Invalid proxy checksum in trial state')
        if not isinstance(data.get('source_sha256'), dict):
            raise RuntimeError('Missing source checksums in trial state')
        self.verify_original(self.backup)
        if not self.proxy.is_file() or sha256(self.proxy) != data['proxy_sha256']:
            raise RuntimeError('Saved proxy checksum mismatch')
        return data

    def classify(self, record):
        digest = sha256(self.binary)
        if digest == self.bundle['executable_sha256']:
            self.verify_original(self.container)
            return 'original'
        if record and digest == record['proxy_sha256']:
            return 'proxy'
        raise RuntimeError('Unknown managed executable bytes; refusing mutation')

    def status(self):
        self.preflight()
        record = self.load_record()
        return {'status': self.classify(record), 'shared_executable': str(self.binary),
                'backup': str(self.backup), 'audit': str(self.state / 'events.jsonl'),
                'running_pids': running_processes()}

    @contextlib.contextmanager
    def lock(self):
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.state.is_symlink() or self.state.stat().st_uid != os.getuid() or self.state.stat().st_mode & 0o077:
            raise RuntimeError('Trial state must be an owned private directory (0700)')
        with (self.state / '.lock').open('a') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield

    def prepare(self):
        # No authoritative state exists yet; a completed backup from an interrupted
        # preparation is reusable, but never overwrite it or accept unknown bytes.
        if self.backup.exists():
            self.verify_original(self.backup)
        else:
            self.backup.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with tempfile.TemporaryDirectory(prefix='.backup-', dir=self.state) as temp:
                staged = Path(temp) / 'claude.app'
                run(['/usr/bin/ditto', str(self.container), str(staged)])
                self.verify_original(staged)
                os.replace(staged, self.backup)
                fsync_directory(self.backup.parent)
        env = dict(os.environ, GOTOOLCHAIN='local', GOPROXY='off', GOSUMDB='off', GOENV='off', GOFLAGS='', GOWORK='off',
                   GOOS='darwin', GOARCH={'arm64': 'arm64', 'x86_64': 'amd64'}[platform.machine()], CGO_ENABLED='0')
        version = run(['go', 'version'], env=env).stdout.strip()
        if not re.fullmatch(r'go version go1\.27\.3 darwin/(?:arm64|amd64)', version):
            raise RuntimeError('Trial requires local Go 1.27.3 for macOS; got ' + version)
        source_hashes = self.source_hashes()
        with tempfile.TemporaryDirectory(prefix='.build-', dir=self.state) as temp:
            output = Path(temp) / 'proxy'
            # Go's linker flag parser honors quoted -X arguments, including spaces.
            engine = str(self.backup / ENGINE)
            audit = str(self.state / 'events.jsonl')
            if any(char in engine + audit for char in "'\n\r"):
                raise RuntimeError('Unsupported quote/newline in trial path')
            flags = f"-X 'main.enginePath={engine}' -X 'main.auditPath={audit}'"
            run(['go', 'build', '-trimpath', '-buildvcs=false', '-ldflags', flags, '-o', str(output), 'proxy.go'],
                cwd=self.root / 'configs/claude-snapshot-proxy', env=env)
            if self.source_hashes() != source_hashes:
                raise RuntimeError('Proxy source changed during build')
            shutil.copystat(self.backup / ENGINE, output)
            atomic_copy(output, self.proxy)
        data = {'schema': 1, 'slot': str(self.binary), 'engine': str(self.backup / ENGINE),
                'engine_sha256': sha256(self.backup / ENGINE), 'proxy_sha256': sha256(self.proxy),
                'source_sha256': source_hashes, 'desktop_version': self.release['desktop_version'],
                'code_version': self.release['code_version']}
        with tempfile.TemporaryDirectory(prefix='.record-', dir=self.state) as temp:
            staged = Path(temp) / 'state.json'
            staged.write_text(json.dumps(data, indent=2) + '\n')
            staged.chmod(0o600)
            atomic_copy(staged, self.record)
        return data

    def change(self, command):
        require_stopped()
        self.preflight()
        # Reject unknown bytes before creating even the trial state directory.
        record = self.load_record()
        self.classify(record)
        with self.lock():
            require_stopped()
            self.preflight()
            record = self.load_record()
            current = self.classify(record)
            if command == 'install':
                if record is None:
                    record = self.prepare()
                if record['source_sha256'] != self.source_hashes():
                    raise RuntimeError('Recorded proxy source differs; restore is still available')
                if current != 'proxy':
                    require_stopped()
                    self.preflight()
                    self.classify(record)
                    atomic_copy(self.proxy, self.binary)
                if sha256(self.binary) != record['proxy_sha256']:
                    raise RuntimeError('Installed proxy checksum mismatch')
                return 'proxy'
            if current == 'proxy':
                require_stopped()
                self.preflight()
                self.classify(record)
                atomic_copy(self.backup / ENGINE, self.binary)
            self.verify_original(self.container)
            return 'original'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('install', 'status', 'restore'))
    args = parser.parse_args()
    os.umask(0o077)
    try:
        trial = Trial(Path.home())
        result = trial.status() if args.command == 'status' else {'status': trial.change(args.command)}
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, f'Proxy trial refused: {error}\n')


if __name__ == '__main__':
    main()
