"""Extract only the pinned runtime (never the SDK, compositor plugin, or installer)."""
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tarfile
import unicodedata


def extract(archive, destination, platform, version):
    mac = platform == 'darwin-universal'
    if not mac and platform not in ('linux-arm64', 'linux-x86_64'):
        raise ValueError('unsupported Cua archive platform')
    bundle = PurePosixPath(f'cua-driver-rs-{version}-darwin-universal/CuaDriver.app')
    entries = {}
    names = set()
    with tarfile.open(archive, 'r:gz') as tar:
        for member in tar:
            path = PurePosixPath(member.name)
            if not member.name or path.is_absolute() or '..' in path.parts:
                raise ValueError(f'unsafe archive member: {path}')
            key = unicodedata.normalize('NFC', str(path)).casefold() if mac else str(path)
            if key in names:
                raise ValueError(f'duplicate archive member: {path}')
            names.add(key)
            bundle_link = mac and member.issym() and bundle in path.parents
            if not (member.isdir() or member.isfile() or bundle_link):
                raise ValueError(f'link or unsupported member: {path}')
            if bundle_link and (not member.linkname or PurePosixPath(member.linkname).is_absolute()):
                raise ValueError(f'unsafe app bundle symlink: {path}')
            entries[path] = member

        if mac:
            selected = {Path('CuaDriver.app') / p.relative_to(bundle): m for p, m in entries.items()
                        if p == bundle or bundle in p.parents}
            required = ['CuaDriver.app/Contents/Info.plist', 'CuaDriver.app/Contents/MacOS/cua-driver',
                        'CuaDriver.app/Contents/_CodeSignature/CodeResources']
        else:
            selected = {Path(p): m for p, m in entries.items() if p.parts and
                        (str(p) in ('cua-driver', 'cua-cursor-theme') or p.parts[0] == 'wayland-helper')}
            required = ['cua-driver', 'cua-cursor-theme', 'wayland-helper/install.sh', 'wayland-helper/README.md',
                        'wayland-helper/winrects@cua/metadata.json', 'wayland-helper/winrects@cua/extension.js']
        for item in required:
            if Path(item) not in selected or not selected[Path(item)].isfile():
                raise ValueError(f'missing required archive file: {item}')

        # Private, new staging directory. Never traverse a link while writing: create
        # all data first, then links exclusively, then resolve every target strictly.
        destination.mkdir(mode=0o700)
        for path, member in selected.items():
            target = destination / path
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
            elif member.issym():
                target.parent.mkdir(parents=True, exist_ok=True)
        for path, member in selected.items():
            if member.issym():
                os.symlink(member.linkname, destination / path)
        for path, member in selected.items():
            if member.issym():
                (destination / path).resolve(strict=True).relative_to((destination / 'CuaDriver.app').resolve())


if __name__ == '__main__':
    try:
        extract(sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4])
    except (OSError, ValueError, RuntimeError, tarfile.TarError) as exc:
        sys.exit(f'error: Cua Driver archive rejected: {exc}')
