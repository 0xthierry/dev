#!/usr/bin/env python3
"""Remove only old repo-owned Ollama embedding overrides from the service env."""
from pathlib import Path
import os
import tempfile

path = Path.home() / ".config/ai-memory/env"
if path.is_file():
    if path.is_symlink():
        raise SystemExit("error: ai-memory env is a symlink; review it before migrating")
    original = path.read_text()
    managed = {
        "AI_MEMORY_EMBEDDING_PROVIDER=openai-compat",
        "AI_MEMORY_EMBEDDING_MODEL=qwen3-embedding:0.6b",
        "AI_MEMORY_EMBEDDING_DIM=1024",
    }
    lines = original.splitlines(keepends=True)
    # Only the previous repo combination establishes ownership. Keep custom
    # embedding configuration rather than guessing that it belongs to setup.
    if managed.issubset({line.strip() for line in lines}):
        content = "".join(line for line in lines if line.strip() not in managed
                          and not line.strip().startswith("AI_MEMORY_EMBEDDING_BASE_URL="))
        fd, name = tempfile.mkstemp(prefix=".ai-memory-env-", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                stream.write(content)
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        print("ai-memory: removed legacy Ollama embedding overrides")
