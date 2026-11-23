#!/usr/bin/python3
"""Private, non-focusable GTK fixture, exclusively for check-cua-native.py."""
import fcntl
import os
from pathlib import Path
import sys
import time


def main(root):
    # The owner unlinks the lease to request shutdown, then takes its lock to
    # verify the window is gone. A late-starting fixture cannot open a window.
    with (root / 'lease').open() as lease:
        fcntl.flock(lease, fcntl.LOCK_EX)
        if not (root / 'lease').exists():
            return
        os.environ['GDK_BACKEND'] = 'wayland'
        import gi
        gi.require_version('Gtk', '3.0')
        from gi.repository import Gtk, GLib
        win = Gtk.Window(title='Cua native check ' + root.name)
        win.set_accept_focus(False)
        win.set_focus_on_map(False)
        entry = Gtk.Entry()
        entry.get_accessible().set_name('Fixture value ' + root.name)
        (root / 'value').write_text('')
        entry.connect('changed', lambda field: (root / 'value').write_text(field.get_text()))
        win.add(entry)
        win.connect('destroy', lambda *_: Gtk.main_quit())
        deadline = time.monotonic() + 90

        def check_lease():
            if time.monotonic() >= deadline or not (root / 'lease').exists():
                win.destroy()
                return False
            return True

        (root / 'pid').write_text(str(os.getpid()))
        GLib.timeout_add(100, check_lease)
        win.show_all()
        Gtk.main()


if __name__ == '__main__':
    main(Path(sys.argv[1]))
