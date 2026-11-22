"""Read-only verification of retired setup material and active references."""
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs/history/README.md"
entries = re.findall(
    r"^\| `([^`]+)` \| \[[^\]]+\]\(https://github\.com/0xthierry/dev/blob/([0-9a-f]{40})/([^\)]+)\) \|$",
    INDEX.read_text(),
    re.MULTILINE,
)
errors = []
if len(entries) != 6:
    errors.append(f"Expected six archive entries, found {len(entries)}")
for path, commit, linked_path in entries:
    if path != linked_path:
        errors.append(f"Archive link points to wrong path: {path}")
    current = ROOT / path
    if current.exists() or current.is_symlink():
        errors.append(f"Retired path remains active: {path}")
    result = subprocess.run(
        ["git", "cat-file", "-t", f"{commit}:{path}"],
        cwd=ROOT, capture_output=True, text=True, check=False,
    )
    if result.returncode or result.stdout.strip() != "blob":
        errors.append(f"Historical blob unavailable: {commit}:{path}")

files = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=ROOT,
).decode().split("\0")
for name in sorted(set(files)):
    if not name or name.startswith("docs/history/"):
        continue
    current = ROOT / name
    if not current.is_file() or current.is_symlink():
        continue
    try:
        text = current.read_text()
    except UnicodeDecodeError:
        continue
    for path, _, _ in entries:
        # Basenames catch relative Markdown links as well as root-based paths.
        # INSTALL.md is shared by live guides, so match its retired directory.
        needle = path if path == "parallel/INSTALL.md" else Path(path).name
        for number, line in enumerate(text.splitlines(), 1):
            if needle in line:
                errors.append(f"Active retired reference: {name}:{number}: {needle}")

if errors:
    raise SystemExit("\n".join(errors))
print("Archive verified: six immutable Git blobs, no active files or references.")
