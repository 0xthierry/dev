#!/usr/bin/env python3
"""Offline Mac install boundary tests; Apple signing and launchd themselves require a Mac."""
import importlib.util
import io
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1] / 'configs/cua-driver'
VERSION = '0.59.4'
PREFIX = f'cua-driver-rs-{VERSION}-darwin-universal'


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / f'{name}.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


mac = load('macos-runtime')
archive = load('extract-runtime')


class Extraction(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.app = PREFIX + '/CuaDriver.app/'

    def extract(self, links=(), prefix=PREFIX):
        package = self.root / 'release.tgz'
        # Actual full archive shape: top-level *bare* binary, SDK, signed bundle.
        with tarfile.open(package, 'w:gz') as tar:
            for name in ['cua-driver', 'libcua_driver_sdk.dylib', 'CuaDriver.app/Contents/Info.plist',
                         'CuaDriver.app/Contents/MacOS/cua-driver', 'CuaDriver.app/Contents/_CodeSignature/CodeResources']:
                info = tarfile.TarInfo(f'{prefix}/{name}')
                payload = b'exact signed contents'
                info.size = len(payload)
                info.mode = 0o755 if 'MacOS/' in name else 0o644
                tar.addfile(info, io.BytesIO(payload))
            for name, target, kind in links:
                info = tarfile.TarInfo(name)
                info.type, info.linkname = kind, target
                tar.addfile(info)
        dest = self.root / 'out'
        archive.extract(package, dest, 'darwin-universal', VERSION)
        return dest

    def test_only_the_intact_bundle_is_extracted(self):
        dest = self.extract([(self.app + 'Contents/Resources/driver', '../MacOS/cua-driver', tarfile.SYMTYPE)])
        self.assertEqual(list(dest.iterdir()), [dest / 'CuaDriver.app'])
        link = dest / 'CuaDriver.app/Contents/Resources/driver'
        self.assertEqual(os.readlink(link), '../MacOS/cua-driver')
        self.assertEqual(link.read_bytes(), b'exact signed contents')
        self.assertTrue(os.access(link, os.X_OK))

    def test_release_without_the_versioned_bundle_fails(self):
        with self.assertRaisesRegex(ValueError, 'missing required'):
            self.extract(prefix='unexpected-layout')

    def test_outside_bundle_symlink_rejected_without_external_writes(self):
        (self.root / 'victim').write_text('unchanged')
        with self.assertRaises((ValueError, OSError)):
            self.extract([(self.app + 'Contents/escape', '../../../victim', tarfile.SYMTYPE)])
        self.assertEqual((self.root / 'victim').read_text(), 'unchanged')

    def test_archive_cannot_create_a_child_through_a_symlink(self):
        victim = self.root / 'victim'
        victim.mkdir()
        with self.assertRaises((ValueError, OSError)):
            self.extract([(self.app + 'Contents/escape', '../../../victim', tarfile.SYMTYPE),
                          (self.app + 'Contents/escape/child', '../MacOS/cua-driver', tarfile.SYMTYPE)])
        self.assertEqual(list(victim.iterdir()), [])

    def test_hard_link_in_macos_archive_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'link or unsupported'):
            self.extract([(self.app + 'hardlink', 'cua-driver', tarfile.LNKTYPE)])

    def test_duplicate_after_normalization_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.extract([(self.app + 'Contents/MacOS/./CUA-DRIVER', '../MacOS/cua-driver', tarfile.SYMTYPE)])


class MacInstall(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        app = self.root / 'Applications/CuaDriver.app'
        app.parent.mkdir()
        self.src = self.root / 'source/CuaDriver.app'
        self.bundle(self.src, VERSION)
        self.enter(patch.object(mac, 'APP', app))
        self.enter(patch.dict(os.environ, HOME=str(self.root)))
        tools = self.root / 'bin'
        tools.mkdir()
        self.enter(patch.dict(os.environ, PATH=str(tools) + ':' + os.environ['PATH']))
        self.script('ditto', 'cp -Rp "$1" "$2"')
        self.script('lipo', 'test -f "$1" && [ "$2 $3 $4" = "-verify_arch arm64 x86_64" ]')
        self.script('codesign', '''case "$1" in
          -d) echo '# designated => previously-trusted';;
          --verify) case "$*" in *'previously-trusted'*) [ ! -e "$BLOCK_COMPAT" ];;
                      *'identifier "com.trycua.driver" and anchor apple generic and certificate leaf[subject.OU] = "YCK386LBJ7"'*) [ ! -e "$BLOCK_SIGNATURE" ];;
                      *) exit 1;; esac;;
          *) exit 1;; esac''')
        self.script('lsregister', '[ "$1" = -f ] && test ! -e "$FAIL_REGISTER"')
        self.enter(patch.dict(os.environ, BLOCK_COMPAT=str(self.root / 'incompatible'),
                              FAIL_REGISTER=str(self.root / 'fail-register'), BLOCK_SIGNATURE=str(self.root / 'bad-signature')))
        self.enter(patch.object(mac, 'LSREGISTER', str(tools / 'lsregister')))
        # Linux does not export renamex_np. Only substitute the swap primitive,
        # not staging, identity comparison, post-swap registration, or recovery.
        if os.uname().sysname != 'Darwin':
            def swap(a, b):
                tmp = self.root / 'swap-test'
                a.rename(tmp)
                b.rename(a)
                tmp.rename(b)
            self.enter(patch.object(mac, 'exchange', swap))

    def enter(self, ctx):
        ctx.start()
        self.addCleanup(ctx.stop)

    def script(self, name, body):
        target = self.root / 'bin' / name
        target.write_text('#!/bin/sh\nset -eu\n' + body + '\n')
        target.chmod(0o755)

    def bundle(self, app, version):
        (app / 'Contents/MacOS').mkdir(parents=True)
        (app / mac.DRIVER).write_text(version)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'com.trycua.driver',
            'CFBundleExecutable': 'cua-driver', 'CFBundleShortVersionString': version}))

    def test_upgrade_retains_previous_bundle(self):
        self.bundle(mac.APP, '0.28.3')
        mac.install(self.src, VERSION)
        self.assertEqual((mac.APP / mac.DRIVER).read_text(), '0.59.4')
        backup, = mac.APP.parent.glob('.cua-driver-backup-*/CuaDriver.app')
        self.assertEqual((backup / mac.DRIVER).read_text(), '0.28.3')

    def test_registration_failure_restores_previous_bundle(self):
        self.bundle(mac.APP, '0.28.3')
        (self.root / 'fail-register').touch()
        with self.assertRaises(subprocess.CalledProcessError):
            mac.install(self.src, VERSION)
        self.assertEqual((mac.APP / mac.DRIVER).read_text(), '0.28.3')

    def test_incompatible_previous_designated_requirement_blocks_swap(self):
        self.bundle(mac.APP, '0.28.3')
        (self.root / 'incompatible').touch()
        with self.assertRaises(subprocess.CalledProcessError):
            mac.install(self.src, VERSION)
        self.assertEqual((mac.APP / mac.DRIVER).read_text(), '0.28.3')

    def test_invalid_signature_blocks_even_first_install(self):
        (self.root / 'bad-signature').touch()
        with self.assertRaises(subprocess.CalledProcessError):
            mac.install(self.src, VERSION)
        self.assertFalse(mac.APP.exists())

    def test_login_job_serves_without_granting_or_changing_other_clients(self):
        # launchctl is an external GUI-domain boundary: emulate its loaded job state.
        self.script('launchctl', '''case "$1" in
          print) case "$2" in */dev.setup.cua-driver) test -f "$HOME/loaded" && cat "$HOME/loaded";; *) exit 0;; esac;;
          bootstrap) test ! -e "$HOME/loaded"; printf 'path = %s\\nprogram = %s\\nCUA_SETUP_RELEASE => 0.59.4\\n' "$3" "$HOME/Applications/CuaDriver.app/Contents/MacOS/cua-driver" > "$HOME/loaded";;
          bootout) rm "$HOME/loaded";; *) exit 97;; esac''')
        mac.service(VERSION)
        plist = self.root / 'Library/LaunchAgents/dev.setup.cua-driver.plist'
        job = plistlib.loads(plist.read_bytes())
        self.assertEqual(job['ProgramArguments'], [str(mac.APP / mac.DRIVER), 'serve', '--no-automation-prompts'])
        self.assertEqual(job['LimitLoadToSessionType'], 'Aqua')
        self.assertEqual(job['EnvironmentVariables'], {'CUA_SETUP_RELEASE': '0.59.4',
                         'CUA_DRIVER_RS_TELEMETRY_ENABLED': 'false', 'CUA_DRIVER_RS_UPDATE_CHECK': 'false'})
        loaded = self.root / 'loaded'
        before = loaded.stat().st_mtime_ns
        mac.service(VERSION)
        self.assertEqual(loaded.stat().st_mtime_ns, before)
        loaded.write_text(loaded.read_text().replace('0.59.4', '0.28.3'))
        mac.service(VERSION)
        self.assertIn('CUA_SETUP_RELEASE => 0.59.4', loaded.read_text())

    def test_foreign_socket_not_displaced(self):
        self.script('launchctl', 'case "$2" in */dev.setup.cua-driver) exit 1;; *) exit 0;; esac')
        endpoint = self.root / 'Library/Caches/cua-driver/cua-driver.sock'
        endpoint.parent.mkdir(parents=True)
        with socket.socket(socket.AF_UNIX) as server:
            server.bind(str(endpoint))
            server.listen()
            with self.assertRaisesRegex(ValueError, 'another Cua daemon'):
                mac.service(VERSION, preflight=True)
        self.assertFalse((self.root / 'Library/LaunchAgents').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
