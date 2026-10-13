#!/usr/bin/env python3
"""Verify pinned runtime ZIP bytes and extract/compare only its regular payload."""
import hashlib
import pathlib
import stat
import sys
import zipfile


def main():
    mode, directory, digest, platform = sys.argv[1:]
    root = pathlib.Path(directory)
    archive = root / "release.zip"
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise ValueError("tunnel-client runtime archive SHA256 mismatch")
    stem = f"tunnel-client-runtime-v0.0.16-linux-{platform}"
    expected = {
        "tunnel-client-runtime", "LICENSE", "NOTICE",
        f"{stem}-licenses.txt", f"{stem}.spdx.json",
    }
    with zipfile.ZipFile(archive) as release:
        members = release.infolist()
        if len(members) != len(expected) or {m.filename for m in members} != expected:
            raise ValueError("unexpected tunnel-client runtime ZIP members")
        for member in members:
            kind = stat.S_IFMT(member.external_attr >> 16)
            if kind not in (0, stat.S_IFREG) or member.file_size > 200_000_000:
                raise ValueError("unsafe tunnel-client runtime ZIP member")
            data = release.read(member)
            destination = root / member.filename
            if mode == "extract":
                destination.write_bytes(data)
            elif mode == "verify":
                if destination.is_symlink() or not destination.is_file() or destination.read_bytes() != data:
                    raise ValueError("installed tunnel-client payload differs from verified archive")
            else:
                raise ValueError("expected extract or verify mode")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        sys.exit(f"error: {error}")
