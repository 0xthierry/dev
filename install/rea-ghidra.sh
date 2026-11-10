#!/usr/bin/env bash
# REA's isolated Ghidra; deliberately independent of ghidra-cli's 12.0 runtime.
set -euo pipefail
# shellcheck source=install/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# REA 6.7.0 GhidraReleasePolicy.js verifies 12.1.4 / JDK 21.
# Digest: https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/Ghidra_12.1.4_build
REA_GHIDRA_VERSION="12.1.4"
REA_GHIDRA_ARCHIVE="ghidra_12.1.4_PUBLIC_20260921.zip"
REA_GHIDRA_SHA256="ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db"
REA_GHIDRA_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${REA_GHIDRA_VERSION}_build/$REA_GHIDRA_ARCHIVE"
# Full Temurin JDK, not a JRE. mise verifies its vendor download and never selects it globally.
# https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.13%2B9
REA_GHIDRA_JAVA_VERSION="temurin-21.0.13+9.0.LTS"

rea_ghidra_validate() {
  python3 - "$1" "$2" "$3" "$REA_GHIDRA_VERSION" <<'PY'
import os
from pathlib import Path
import re
import struct
import subprocess
import sys

root, java, platform, version = sys.argv[1:]
root, java = Path(root), Path(java)
try:
    properties = dict(line.split('=', 1) for line in
                      (root / 'Ghidra/application.properties').read_text().splitlines()
                      if '=' in line and not line.startswith('#'))
    if (properties.get('application.version') != version or
            properties.get('application.java.min') != '21' or
            properties.get('application.java.max') not in ('', '0', None)):
        raise ValueError('unexpected Ghidra version or Java requirements')
    for executable in (root / 'support/analyzeHeadless', java / 'bin/java', java / 'bin/javac'):
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError(f'missing executable: {executable}')
    for name in ('decompile', 'sleigh'):
        executable = root / 'Ghidra/Features/Decompiler/os' / platform / name
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ValueError(f'missing native executable: {executable}')
        with executable.open('rb') as stream:
            header = stream.read(20)
        if platform == 'mac_arm_64':
            matches = len(header) == 20 and struct.unpack('<II', header[:8]) == (0xfeedfacf, 0x100000c)
        else:
            matches = (len(header) == 20 and header[:6] == b'\x7fELF\x02\x01'
                       and struct.unpack('<H', header[18:20])[0] == 62)
        if not matches:
            raise ValueError(f'wrong native executable architecture: {executable}')
    env = dict(os.environ, JAVA_HOME=str(java))
    probe = subprocess.run([str(java / 'bin/java'), '-XX:-UsePerfData',
                            '-XshowSettings:properties', '-version'], env=env,
                           capture_output=True, text=True, timeout=20, check=True)
    settings = dict(re.findall(r'^\s*([\w.]+)\s*=\s*(.*?)\s*$',
                               probe.stdout + probe.stderr, re.MULTILINE))
    expected_arch = 'aarch64' if platform == 'mac_arm_64' else 'amd64'
    if (settings.get('java.version') != '21.0.13' or
            settings.get('sun.arch.data.model') != '64' or
            settings.get('os.arch') != expected_arch):
        raise ValueError('pinned Java must be a matching native 64-bit JDK 21.0.13')
    # mise's macOS root has bin symlinks into Contents/Home. Record the JVM's
    # canonical home, which is also the path REA's installation inspector reports.
    reported_home = Path(settings.get('java.home', ''))
    if not reported_home.is_absolute() or not reported_home.samefile(java):
        # A macOS bundle's Contents/Home is allowed, never an unrelated JVM.
        if not (java / 'Contents/Home').is_dir() or not reported_home.samefile(java / 'Contents/Home'):
            raise ValueError('Java reports an unrelated home')
    compiler = subprocess.run([str(reported_home / 'bin/javac'), '-version'], env=env,
                              capture_output=True, text=True, timeout=20, check=True)
    if (compiler.stdout + compiler.stderr).strip() != 'javac 21.0.13':
        raise ValueError('pinned full JDK compiler is unavailable')
    print(reported_home)
except (OSError, ValueError, subprocess.SubprocessError) as error:
    sys.exit(f'error: REA Ghidra validation failed: {error}')
PY
}

install_rea_ghidra() (
  local host="${1:-}" runtime="$HOME/.local/share/rea" platform="" os="" arch=""
  local target="" path="" mise_bin="" java_home="" stage="" extracted="" cpp="" marker=""
  case "$host" in
    dev|omarchy) platform="linux_x86_64" ;;
    macbook) platform="mac_arm_64" ;;
    *) printf 'error: REA Ghidra requires dev, omarchy, or macbook\n' >&2; return 1 ;;
  esac
  target="$runtime/ghidra/$REA_GHIDRA_VERSION"
  marker="rea-ghidra-v1 $REA_GHIDRA_VERSION $REA_GHIDRA_SHA256 $platform"
  log_section "REA Ghidra"
  # No reads of mise/package tools and no directory creation in a dry run.
  if (( ${DRY_RUN:-0} )); then
    dry_run_cmd mise install "java@$REA_GHIDRA_JAVA_VERSION"
    dry_run_cmd curl -fL "$REA_GHIDRA_URL" -o "$REA_GHIDRA_ARCHIVE"
    log_item "Would verify SHA-256 $REA_GHIDRA_SHA256 and stage Ghidra in $target"
    if [[ "$host" == macbook ]]; then
      log_item "Would build decompile and sleigh for arm64 from bundled sources using Xcode clang++/make"
    fi
    log_item "Would validate native $platform executables and full JDK, then record $runtime/{ghidra-path,java-home}"
    return 0
  fi
  os="$(uname -s)"; arch="$(uname -m)"
  case "$host/$os/$arch" in
    macbook/Darwin/arm64|dev/Linux/x86_64|omarchy/Linux/x86_64) ;;
    *) printf 'error: unsupported REA Ghidra host: %s/%s/%s (requires macbook Darwin arm64 or dev/omarchy Linux x86_64)\n' "$host" "$os" "$arch" >&2; return 1 ;;
  esac
  for path in "$runtime" "$runtime/ghidra" "$target"; do
    if [[ -L "$path" || ( -e "$path" && ! -d "$path" ) ]]; then
      printf 'error: refusing unrelated REA Ghidra path: %s\n' "$path" >&2; return 1
    fi
  done
  for path in "$runtime/ghidra-path" "$runtime/java-home"; do
    if [[ -L "$path" || ( -e "$path" && ! -f "$path" ) ]]; then
      printf 'error: refusing unrelated REA Ghidra record: %s\n' "$path" >&2; return 1
    fi
  done
  if [[ -d "$target" ]] && { [[ -L "$target/.rea-owned" || ! -f "$target/.rea-owned" ]] ||
       [[ "$(< "$target/.rea-owned")" != "$marker" ]]; }; then
    printf 'error: refusing unowned REA Ghidra installation: %s\n' "$target" >&2; return 1
  fi
  # Existing records are only ours if they refer to a previously owned runtime.
  if [[ -e "$runtime/ghidra-path" || -e "$runtime/java-home" ]] && [[ ! -f "$target/.rea-owned" ]]; then
    printf 'error: refusing existing REA Ghidra records without an owned installation\n' >&2; return 1
  fi
  for path in python3 curl unzip; do
    if ! command -v "$path" >/dev/null 2>&1; then
      printf 'error: REA Ghidra requires %s; install the declared prerequisites first\n' "$path" >&2; return 1
    fi
  done
  mise_bin="$(resolve_mise_bin)" || { printf 'error: REA Ghidra requires mise\n' >&2; return 1; }
  if [[ "$host" == macbook && ! -d "$target" ]]; then
    if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find clang++ >/dev/null 2>&1 ||
       ! command -v make >/dev/null 2>&1; then
      printf 'error: REA Ghidra arm64 native build requires Xcode Command Line Tools (xcode-select --install) and make\n' >&2; return 1
    fi
  fi
  "$mise_bin" install "java@$REA_GHIDRA_JAVA_VERSION" || return
  java_home="$("$mise_bin" where "java@$REA_GHIDRA_JAVA_VERSION")" || return
  if [[ "$java_home" != /* || ! -x "$java_home/bin/java" || ! -x "$java_home/bin/javac" ]]; then
    printf 'error: mise did not provide an absolute full JDK home\n' >&2; return 1
  fi
  mkdir -p "$runtime/ghidra" || return
  stage="$(mktemp -d "$runtime/ghidra/.install.XXXXXX")" || return
  # Only remove the fresh staging directory this invocation created, never installations.
  trap '[[ -z "$stage" ]] || rm -rf -- "$stage"' EXIT
  if [[ ! -d "$target" ]]; then
    curl --fail --location --retry 2 --connect-timeout 20 --max-time 900 \
      "$REA_GHIDRA_URL" -o "$stage/$REA_GHIDRA_ARCHIVE" || return
    python3 - "$stage/$REA_GHIDRA_ARCHIVE" "$REA_GHIDRA_SHA256" <<'PY' || return
import hashlib
import sys
with open(sys.argv[1], 'rb') as stream:
    digest = hashlib.file_digest(stream, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else None
    if digest is None:
        sha = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            sha.update(block)
        digest = sha.hexdigest()
if digest != sys.argv[2]:
    sys.exit('error: REA Ghidra archive SHA-256 mismatch')
PY
    unzip -q "$stage/$REA_GHIDRA_ARCHIVE" -d "$stage" || return
    extracted="$stage/ghidra_${REA_GHIDRA_VERSION}_PUBLIC"
    if [[ "$host" == macbook ]]; then
      cpp="$extracted/Ghidra/Features/Decompiler/src/decompile/cpp"
      # Upstream Makefile defaults to x86_64 even on Apple Silicon. Override it;
      # use the generated parsers shipped in the verified archive, no Gradle/npm.
      # Separate goals preserve Makefile's per-goal dependency selection.
      make -C "$cpp" -j4 ghidra_opt 'CXX=clang++ -std=c++11' \
        'ARCH_TYPE=-arch arm64' 'ADDITIONAL_FLAGS=-mmacosx-version-min=11.0' || return
      make -C "$cpp" -j4 sleigh_opt 'CXX=clang++ -std=c++11' \
        'ARCH_TYPE=-arch arm64' 'ADDITIONAL_FLAGS=-mmacosx-version-min=11.0' || return
      mkdir -p "$extracted/Ghidra/Features/Decompiler/os/$platform" || return
      cp "$cpp/ghidra_opt" "$extracted/Ghidra/Features/Decompiler/os/$platform/decompile" || return
      cp "$cpp/sleigh_opt" "$extracted/Ghidra/Features/Decompiler/os/$platform/sleigh" || return
    fi
    java_home="$(rea_ghidra_validate "$extracted" "$java_home" "$platform")" || return
    printf '%s\n' "$marker" > "$extracted/.rea-owned" || return
    # os.rename refuses a nonempty concurrent destination rather than nesting the
    # new release inside it (the behavior of mv when a directory already exists).
    python3 - "$extracted" "$target" <<'PY' || return
import os
import sys
if os.path.lexists(sys.argv[2]):
    sys.exit('error: REA Ghidra destination appeared during installation; rerun')
os.rename(sys.argv[1], sys.argv[2])
PY
  else
    java_home="$(rea_ghidra_validate "$target" "$java_home" "$platform")" || return
    log_item "REA Ghidra $REA_GHIDRA_VERSION: installed and validated"
  fi
  # Never overwrite a user-repointed record, even beside an owned installation.
  if { [[ -f "$runtime/ghidra-path" ]] && [[ "$(< "$runtime/ghidra-path")" != "$target" ]]; } ||
     { [[ -f "$runtime/java-home" ]] && [[ "$(< "$runtime/java-home")" != "$java_home" ]]; }; then
    printf 'error: refusing unrelated REA Ghidra record contents\n' >&2; return 1
  fi
  # Write records only after validation. An interruption here is reconciled by
  # the next run, which reuses the completed, owned versioned installation.
  printf '%s\n' "$java_home" > "$stage/java-home" || return
  printf '%s\n' "$target" > "$stage/ghidra-path" || return
  write_if_changed "$stage/java-home" "$runtime/java-home" || return
  write_if_changed "$stage/ghidra-path" "$runtime/ghidra-path" || return
  log_item "REA Ghidra $REA_GHIDRA_VERSION ready; global Java and ghidra-cli runtime unchanged"
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  DRY_RUN=0
  if [[ $# -eq 2 && "$2" == --dry-run ]]; then DRY_RUN=1
  elif [[ $# -ne 1 ]]; then
    printf 'Usage: bash install/rea-ghidra.sh <dev|macbook|omarchy> [--dry-run]\n' >&2
    exit 1
  fi
  install_rea_ghidra "$1"
fi
