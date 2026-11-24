#!/usr/bin/python
"""Recover a missing G325 audio card once normal Bluetooth negotiation has settled."""
import subprocess

from gi.repository import Gio, GLib

ADDRESS = '40:58:99:E9:AC:AF'
CARD = 'bluez_card.' + ADDRESS.replace(':', '_')
AUDIO_SINK = '0000110b-0000-1000-8000-00805f9b34fb'
DEVICE = 'org.bluez.Device1'
WATCHED = {'Address', 'Connected', 'Paired', 'Trusted', 'Blocked', 'ServicesResolved'}
GRACE_MS = 5000
RETRY_MS = 8000
MAX_ATTEMPTS = 3


def eligible(props):
    return (props.get('Address') == ADDRESS and props.get('Connected') is True
            and props.get('Paired') is True and props.get('Trusted') is True
            and props.get('Blocked') is False)


def card_missing():
    try:
        cards = subprocess.check_output(['pactl', 'list', 'short', 'cards'],
                                        text=True, timeout=3)
    except (OSError, subprocess.SubprocessError):
        return None  # An unavailable sound server isn't evidence of a missing card.
    return all(row.split()[1:2] != [CARD] for row in cards.splitlines())


class Episode:
    def __init__(self, proxy):
        self.proxy = proxy
        self.timer = 0
        self.attempts = 0
        self.done = False
        self.pending = False

    def schedule(self, delay):
        if not self.done and not self.timer and not self.pending and self.attempts < MAX_ATTEMPTS:
            self.timer = GLib.timeout_add(delay, self.check)

    def stop(self):
        self.done = True
        if self.timer:
            GLib.source_remove(self.timer)
            self.timer = 0

    def check(self):
        self.timer = 0
        missing = card_missing()
        if missing is None:
            self.attempts += 1
            self.schedule(RETRY_MS)
            return False
        if not missing:
            self.done = True
            return False
        # pactl can block while disconnect/removal signals are queued. Don't rely
        # on cached properties for permission to send the remote profile request.
        try:
            props, = self.proxy.call_sync('org.freedesktop.DBus.Properties.GetAll',
                GLib.Variant('(s)', (DEVICE,)), Gio.DBusCallFlags.NO_AUTO_START,
                3000, None).unpack()
        except GLib.Error:
            self.done = True
            return False
        if not eligible(props) or not props.get('ServicesResolved'):
            return False
        self.attempts += 1
        self.pending = True
        print(f'{self.proxy.get_object_path()}: requesting A2DP ({self.attempts}/{MAX_ATTEMPTS})', flush=True)
        self.proxy.call('ConnectProfile', GLib.Variant('(s)', (AUDIO_SINK,)),
                        Gio.DBusCallFlags.NO_AUTO_START, 20000, None, self.completed)
        return False

    def completed(self, proxy, result):
        try:
            proxy.call_finish(result)
        except GLib.Error as error:
            print(f'ConnectProfile: {error.message}', flush=True)
        self.pending = False
        self.schedule(RETRY_MS)  # Card appearance, not D-Bus success, is the result.


def main():
    manager = Gio.DBusObjectManagerClient.new_for_bus_sync(
        Gio.BusType.SYSTEM, Gio.DBusObjectManagerClientFlags.DO_NOT_AUTO_START,
        'org.bluez', '/', None, None, None)
    episodes = {}

    def update(obj):
        path = obj.get_object_path()
        proxy = obj.get_interface(DEVICE)
        props = ({name: proxy.get_cached_property(name).unpack()
                  for name in WATCHED.intersection(proxy.get_cached_property_names() or ())}
                 if proxy else {})
        if not eligible(props):
            removed(path)
            return
        if path not in episodes:
            episodes[path] = Episode(proxy)
        if props.get('ServicesResolved'):
            episodes[path].schedule(GRACE_MS)

    def removed(path):
        episode = episodes.pop(path, None)
        if episode:
            episode.stop()

    def changed(manager, obj, proxy, changes, invalidated):
        if (proxy.get_interface_name() == DEVICE and
                WATCHED.intersection(changes.unpack().keys() | set(invalidated))):
            update(obj)

    manager.connect('object-added', lambda _, obj: update(obj))
    manager.connect('object-removed', lambda _, obj: removed(obj.get_object_path()))
    manager.connect('interface-added', lambda _, obj, iface: update(obj)
                    if iface.get_interface_name() == DEVICE else None)
    manager.connect('interface-removed', lambda _, obj, iface: removed(obj.get_object_path())
                    if iface.get_interface_name() == DEVICE else None)
    manager.connect('interface-proxy-properties-changed', changed)
    for obj in manager.get_objects():
        update(obj)
    GLib.MainLoop().run()


if __name__ == '__main__':
    main()
