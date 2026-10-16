#!/usr/bin/env python3
"""Verify official memory skills through the real isolated agent installer."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
NAMES = (
    "ai-memory-retrieval",
    "ai-memory-handoff",
    "ai-memory-durable-pages",
    "ai-memory-learning-maintenance",
    "ai-memory-routing-install",
)


class MemorySkillsTests(unittest.TestCase):
    def test_shared_skills_are_installed_unchanged_for_every_client(self):
        with tempfile.TemporaryDirectory(prefix="memory-skills-test-") as directory:
            home = Path(directory)
            env = dict(os.environ, HOME=str(home))
            command = ["bash", str(ROOT / "configs/agents/install.sh"), "--yes"]
            for _ in range(2):
                result = subprocess.run(command, env=env, capture_output=True,
                                        text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stderr)
                for name in NAMES:
                    source = ROOT / "configs/agents/skills" / name / "SKILL.md"
                    text = source.read_text()
                    self.assertIn(f"name: {name}\n", text)
                    self.assertIn("<!-- ai-memory-managed: routing-skill -->", text)
                    for client in (".agents", ".claude", ".codex", ".pi/agent"):
                        installed = home / client / "skills" / name / "SKILL.md"
                        self.assertEqual(installed.read_bytes(), source.read_bytes())


if __name__ == "__main__":
    unittest.main()
