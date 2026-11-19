#!/usr/bin/env python3
"""Exercise image capability opt-in through the real repo zshenv in an empty HOME."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class TerminalImagesTest(unittest.TestCase):
    def render_env(self, **overrides):
        with tempfile.TemporaryDirectory() as home:
            env = {"HOME": home, "PATH": os.environ["PATH"], **overrides}
            result = subprocess.run(
                ["zsh", "-f", "-c", 'source "$1"; printf "%s" "${CLAUDE_CODE_FORCE_TERMINAL_IMAGES-unset}"',
                 "test", str(ROOT / "configs/shell/zshenv")],
                env=env, text=True, capture_output=True, check=True,
            )
            return result.stdout

    def test_plain_ghostty_enables_images(self):
        self.assertEqual(self.render_env(TERM_PROGRAM="ghostty"), "1")

    def test_herdr_terminal_identity_enables_images(self):
        self.assertEqual(self.render_env(TERM_PROGRAM="herdr"), "1")

    def test_herdr_environment_enables_images(self):
        self.assertEqual(self.render_env(HERDR_ENV="1"), "1")

    def test_other_terminal_is_not_forced(self):
        self.assertEqual(self.render_env(TERM_PROGRAM="Apple_Terminal"), "unset")

    def test_explicit_disable_survives_ghostty(self):
        self.assertEqual(self.render_env(TERM_PROGRAM="ghostty", CLAUDE_CODE_FORCE_TERMINAL_IMAGES="0"), "0")

    def test_explicit_disable_survives_herdr(self):
        self.assertEqual(self.render_env(HERDR_ENV="1", CLAUDE_CODE_FORCE_TERMINAL_IMAGES="0"), "0")


if __name__ == "__main__":
    unittest.main()
