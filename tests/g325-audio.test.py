#!/usr/bin/python
"""Run the actual watcher on a private system-bus substitute; never touch user audio."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
import warnings

from gi.repository import Gio, GLib

WATCHER = Path(__file__).resolve().parents[1] / 'configs/omarchy/g325-audio/recover.py'
DEVICE = 'org.bluez.Device1'
MANAGER = 'org.freedesktop.DBus.ObjectManager'
PROPERTIES = 'org.freedesktop.DBus.Properties'
PATH = '/org/bluez/hci7/dev_40_58_99_E9_AC_AF'
PROFILE = (PATH, '0000110b-0000-1000-8000-00805f9b34fb')
CARD = '71\tbluez_card.40_58_99_E9_AC_AF\tmodule-bluez5-device.c\n'


class RecoveryTest(unittest.TestCase):
    def setUp(self):
        # PyGObject 3.56 warns on every iteration under Python 3.14.
        self.enterContext(warnings.catch_warnings())
        warnings.filterwarnings('ignore', category=DeprecationWarning, module=r'gi\.events')
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.cards = self.dir / 'cards'
        self.cards.write_text('3\talsa_card.usb-mic\talsa\n')
        pactl = self.dir / 'pactl'
        pactl.write_text('#!/bin/sh\n[ "$*" = "list short cards" ] || exit 66\n'
                         '[ -f cards ] && cat cards\nstatus=$?\necho check >> checks\nexit "$status"\n')
        pactl.chmod(0o755)
        self.bus = Gio.TestDBus.new(Gio.TestDBusFlags.NONE)
        self.bus.up()
        self.addCleanup(self.bus.down)
        self.conn = Gio.DBusConnection.new_for_address_sync(self.bus.get_bus_address(),
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
            None, None)
        self.addCleanup(self.conn.close_sync, None)
        self.conn.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'RequestName', GLib.Variant('(su)', ('org.bluez', 0)),
            None, Gio.DBusCallFlags.NONE, 1000, None)
        self.props = dict(Address='40:58:99:E9:AC:AF', Connected=True, Paired=True,
                          Trusted=True, Blocked=False, ServicesResolved=True, Alias='G325')
        self.present = True
        self.enumerated = False
        self.requests = []
        self.export('/', MANAGER, '<method name="GetManagedObjects"><arg direction="out" '
                    'type="a{oa{sa{sv}}}"/></method>')
        self.export(PATH, DEVICE, '<method name="ConnectProfile"><arg direction="in" '
                    'type="s"/></method>' + ''.join(
                    f'<property access="read" name="{k}" type="{self.variant(v).get_type_string()}"/>'
                    for k, v in self.props.items()))

    @staticmethod
    def variant(v):
        return GLib.Variant('s' if isinstance(v, str) else 'b', v)

    def interfaces(self):
        return {DEVICE: {k: self.variant(v) for k, v in self.props.items()}}

    def export(self, path, iface, members):
        info = Gio.DBusNodeInfo.new_for_xml(f'<node><interface name="{iface}">{members}</interface></node>')
        reg = self.conn.register_object(path, info.interfaces[0], self.method,
            lambda conn, sender, path, interface, prop: self.variant(self.props[prop]), None)
        self.addCleanup(self.conn.unregister_object, reg)

    def method(self, conn, sender, path, iface, name, args, invocation):
        if name == 'GetManagedObjects':
            self.enumerated = True
            devices = {PATH: self.interfaces()} if self.present else {}
            invocation.return_value(GLib.Variant('(a{oa{sa{sv}}})', (devices,)))
        elif name == 'ConnectProfile':
            self.requests.append((path, args.unpack()[0]))
            invocation.return_value(None)

    def change(self, **changed):
        self.props.update(changed)
        self.conn.emit_signal(None, PATH, PROPERTIES, 'PropertiesChanged', GLib.Variant(
            '(sa{sv}as)', (DEVICE, {k: self.variant(v) for k, v in changed.items()}, [])))

    def start(self):
        bootstrap = ('import sys; sys.path.insert(0, sys.argv[1]); import recover; '
                     'recover.GRACE_MS = recover.RETRY_MS = 50; recover.main()')
        env = dict(os.environ, DBUS_SYSTEM_BUS_ADDRESS=self.bus.get_bus_address(),
                   PATH=f'{self.dir}:{os.environ["PATH"]}')
        self.proc = subprocess.Popen([sys.executable, '-B', '-c', bootstrap, str(WATCHER.parent)],
            env=env, cwd=self.dir, stdout=subprocess.DEVNULL)
        self.addCleanup(self.proc.wait, 3)
        self.addCleanup(self.proc.terminate)
        self.until(lambda: self.enumerated)

    def until(self, predicate, timeout=4):
        deadline = time.monotonic() + timeout
        ctx = GLib.MainContext.default()
        while not predicate():
            while ctx.iteration(False):
                pass
            if time.monotonic() > deadline or self.proc.poll() is not None:
                self.fail(f'watcher failed to reach expected state: {self.proc.poll()=}, {self.requests=}')
            time.sleep(.002)

    def settle(self):
        end = time.monotonic() + .25
        self.until(lambda: time.monotonic() >= end)

    def checks(self):
        path = self.dir / 'checks'
        return path.read_text().splitlines() if path.exists() else []

    def test_initial_gatt_only_then_card_appears(self):
        self.start()
        self.until(lambda: len(self.requests) == 1)
        self.cards.write_text(CARD)
        self.settle()
        self.assertEqual(self.requests, [PROFILE])
        self.assertEqual(self.checks(), ['check', 'check'])

    def test_existing_card_preserved_even_when_other_events_arrive(self):
        self.cards.write_text(CARD)  # off / HFP / A2DP all expose the same card.
        self.start()
        self.until(lambda: self.checks())
        self.change(Alias='new alias')
        self.settle()
        self.assertEqual(self.checks(), ['check'])
        self.assertEqual(self.requests, [])

    def test_audio_server_unavailable_stops_after_bounded_checks(self):
        self.cards.unlink()  # pactl substitute exits nonzero
        self.start()
        self.until(lambda: len(self.checks()) == 3)
        self.settle()
        self.assertEqual(self.checks(), ['check'] * 3)
        self.assertEqual(self.requests, [])

    def test_audio_server_becomes_ready_during_startup(self):
        self.cards.unlink()
        self.start()
        self.until(lambda: self.checks())
        self.assertEqual(self.requests, [])
        self.cards.write_text('3\talsa_card.usb-mic\talsa\n')
        self.until(lambda: self.requests)
        self.cards.write_text(CARD)
        self.settle()
        self.assertEqual(self.requests, [PROFILE])

    def test_unresolved_then_appears_and_exhausts_retries(self):
        self.present = False
        self.props['ServicesResolved'] = False
        self.start()
        self.conn.emit_signal(None, '/', MANAGER, 'InterfacesAdded', GLib.Variant(
            '(oa{sa{sv}})', (PATH, self.interfaces())))
        self.settle()
        self.assertEqual(self.checks(), [])
        self.change(ServicesResolved=True)
        self.until(lambda: len(self.requests) == 3)
        self.change(Alias='new alias')
        self.change(ServicesResolved=True)
        self.settle()
        self.assertEqual(self.requests, [PROFILE] * 3)
        self.assertEqual(self.checks(), ['check'] * 3)

    def test_only_named_paired_trusted_unblocked_connected_device_qualifies(self):
        self.props.update(Address='00:11:22:33:44:55')
        self.start()
        self.settle()
        self.change(Address='40:58:99:E9:AC:AF', Trusted=False)
        self.settle()
        self.change(Trusted=True, Paired=False)
        self.settle()
        self.change(Paired=True, Blocked=True)
        self.settle()
        self.change(Blocked=False, Connected=False)
        self.settle()
        self.assertEqual(self.checks(), [])
        self.change(Connected=True)
        self.until(lambda: self.requests)
        self.assertEqual(self.requests, [PROFILE])

    def test_rechecks_connection_before_request(self):
        self.start()
        self.props['Connected'] = False  # No signal: client cache is still stale.
        self.settle()
        self.assertEqual(self.checks(), ['check'])
        self.assertEqual(self.requests, [])

    def test_disconnect_cancels_retry_and_reconnect_starts_fresh(self):
        self.start()
        self.until(lambda: len(self.requests) == 1)
        self.change(Connected=False)
        self.settle()
        self.assertEqual(self.requests, [PROFILE])
        self.change(Connected=True)
        self.until(lambda: len(self.requests) == 4)
        self.assertEqual(self.requests, [PROFILE] * 4)


if __name__ == '__main__':
    unittest.main()
