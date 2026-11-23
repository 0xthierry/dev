"""Fingerprint the exact installed Linux runtime without executing or following it.

The installer pins one digest per signed archive. Hash a fixed ordered file set
(path NUL SHA256), validating its entire directory tree and executable modes.
"""
import hashlib
from pathlib import Path
import os
import stat
import sys

FILES = {'cua-driver': 0o755, 'cua-cursor-theme': 0o755, 'wayland-helper/install.sh': 0o755,
         'wayland-helper/README.md': 0o644, 'wayland-helper/winrects@cua/metadata.json': 0o644,
         'wayland-helper/winrects@cua/extension.js': 0o644}
DIRS = {'wayland-helper', 'wayland-helper/winrects@cua'}


def digest(root):
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise ValueError('not a runtime directory')
    found, dirs_found = set(), set()
    def fail(exc):
        raise exc
    for parent, dirs, files in os.walk(root, followlinks=False, onerror=fail):
        for name in dirs + files:
            path = Path(parent) / name
            key = path.relative_to(root).as_posix()
            mode = path.lstat().st_mode
            if key in DIRS and stat.S_ISDIR(mode):
                dirs_found.add(key)
            elif key in FILES and stat.S_ISREG(mode) and stat.S_IMODE(mode) == FILES[key]:
                found.add(key)
            else:
                raise ValueError(f'unexpected runtime member or mode: {key}')
    if found != FILES.keys() or dirs_found != DIRS:
        raise ValueError('incomplete runtime')
    manifest = hashlib.sha256()
    for key in sorted(found):
        with (root / key).open('rb') as stream:
            content = hashlib.sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                content.update(chunk)
        manifest.update(key.encode() + b'\0' + content.digest())
    return manifest.hexdigest()


if __name__ == '__main__':
    try:
        print(digest(Path(sys.argv[1])))
    except (OSError, ValueError) as exc:
        sys.exit(f'error: unverified Linux Cua runtime: {exc}')
