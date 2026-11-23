#!/usr/bin/env python3
"""Synthetic reporting tests. No desktop or Cua service is contacted."""
import asyncio
from contextlib import asynccontextmanager
import json
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

RUN = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/check-cua-native.py'))['run']


class ReportTests(unittest.TestCase):
    def test_observation_failure_survives_changed_foreground_after_cleanup(self):
        report = {}

        @asynccontextmanager
        async def no_proxy():
            yield None

        async def observe_only(call, root, initial, report):
            report.update(stage='observe', fixture_pid=1001, native_observation='passed')
            raise RUN.__globals__['Blocked']('foreground changed before action')

        initial = {'pid': 100, 'address': '0xabc', 'title': 'private'}
        final = {'pid': 200, 'address': '0xdef', 'title': 'also-private'}
        with patch.dict(RUN.__globals__, proxy=no_proxy, exercise=observe_only), patch('subprocess.check_output',
                   side_effect=[json.dumps(initial), json.dumps([final]), json.dumps(final)]) as hyprctl:
            with self.assertRaisesRegex(RUN.__globals__['Blocked'], '^foreground changed before action$'):
                asyncio.run(RUN(report))
        self.assertEqual([c.args[0] for c in hyprctl.call_args_list],
                         [['hyprctl', '-j', 'activewindow'], ['hyprctl', '-j', 'clients'], ['hyprctl', '-j', 'activewindow']])
        self.assertEqual(report, {'stage': 'observe', 'action_attempted': False, 'fixture_pid': 1001,
                         'native_observation': 'passed', 'fixture_lease_released': True, 'fixture_window_absent': True,
                         'foreground_initial': {'pid': 100, 'address': '0xabc'},
                         'foreground_final': {'pid': 200, 'address': '0xdef'}, 'foreground_unchanged_after_cleanup': False,
                         'cleanup_errors': ['foreground changed; not restored by checker']})

    def test_remaining_fixture_window_is_not_reported_absent(self):
        with patch('subprocess.check_output', return_value='[{"pid":1234,"title":"do not store"}]'):
            self.assertFalse(RUN.__globals__['fixture_window_absent'](1234))


if __name__ == '__main__':
    unittest.main()
