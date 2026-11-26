#!/usr/bin/env python3
"""Claude Bash accident guard, not an arbitrary-shell sandbox.

Inspect ordinary rm commands without executing shell syntax. Computed recursive
rm operands/cwd require rewriting as explicit paths. Shell interpreters, aliases,
functions and programs that themselves delete files are outside this guard.
"""
import fnmatch
import glob
import io
import json
import os
import re
import shlex
import sys

DENIAL = "Blocked rm: protected or ambiguous deletion target. Use explicit, specific paths after reviewing the deletion."


def literal_path(value, home, cwd):
    value = re.sub(r"\$(?:HOME\b|\{HOME\})", lambda _: home, value)
    if value == "~" or value.startswith("~/"):
        value = home + value[1:]
    if any(c in value for c in "$`{}") or value.startswith("~"):
        return None
    if not os.path.isabs(value):
        if cwd is None:
            return None
        value = os.path.join(cwd, value)
    # Preserve symlink/.. traversal for realpath; lexical normalization first
    # can turn a genuinely protected destination into an innocent-looking one.
    return value


def unsafe_target(value, home, cwd, protected):
    # Brace expansion is intentionally unresolved, including {*,.*}.
    path = literal_path(value, home, cwd)
    if path is None:
        return True
    if glob.has_magic(path):
        parent, pattern = os.path.split(path)
        if glob.has_magic(parent) and ".." in path.split(os.sep):
            return True
        # Match components, not fnmatch's slash-crossing wildcard semantics.
        parts = os.path.normpath(path).split(os.sep)
        if any(len(parts) == len(p.split(os.sep)) and
               all(fnmatch.fnmatchcase(component, pat) for component, pat in zip(p.split(os.sep), parts))
               for p in protected):
            return True
        broad = all(fnmatch.fnmatchcase(sample, pattern) for sample in ("x", "arbitrary-name")) or all(
            fnmatch.fnmatchcase(sample, pattern) for sample in (".x", ".arbitrary-name"))
        if broad and (os.path.normpath(parent) in protected or os.path.realpath(parent) in protected or
                      any(os.path.realpath(match) in protected for match in glob.glob(parent))):
            return True
        # Inspect real expansions for symlink destinations, without running rm
        # or a shell. Scoped patterns need not be rejected just for containing *.
        return any(unsafe_target(match, home, cwd, protected)
                   for match in glob.glob(path) if not glob.has_magic(match))
    return os.path.normpath(path) in protected or os.path.realpath(path) in protected


def command_words(words):
    """Unwrap common command prefixes; leave unrelated commands untouched."""
    while words and words[0] in {"then", "do", "else", "if", "elif", "while", "until", "!", "{"}:
        words = words[1:]
    while words and re.match(r"[A-Za-z_][A-Za-z_0-9]*=", words[0]):
        words = words[1:]
    while words and os.path.basename(words[0]) in {"sudo", "command", "env", "exec", "builtin", "time"}:
        wrapper, words = os.path.basename(words[0]), words[1:]
        while words and (words[0].startswith("-") or
                         (wrapper == "env" and "=" in words[0])):
            option, words = words[0], words[1:]
            if option == "--":
                break
            if wrapper == "sudo" and option in {"-u", "-g", "-h", "-p", "-C", "-T", "-R", "-D", "--user", "--group", "--host", "--prompt", "--chroot", "--chdir"}:
                words = words[1:]
    return words


def blocked(command, cwd, home):
    protected = {"/", "/root", home, os.path.dirname(home)}
    protected |= {os.path.realpath(p) for p in protected}
    class CommentStream(io.StringIO):
        def readline(self, *args):
            line = super().readline(*args)
            # shlex discards comment lines via readline(), including their
            # newline. Leave that separator available to the command parser.
            if line.endswith("\n"):
                self.seek(self.tell() - 1)
            return line

    lexer = shlex.shlex(CommentStream(command), posix=True, punctuation_chars=";&|()<>\n")
    lexer.whitespace = " \t\r"
    lexer.whitespace_split = True
    lexer.commenters = "#"
    try:
        tokens = list(lexer)
    except ValueError:
        # Malformed shell is not executable, but do not approve an rm rewrite.
        return bool(re.search(r"\brm\b", command))
    segments, current = [], []
    for token in tokens:
        if token and all(c in ";&|()\n" for c in token):
            segments.append((current, token))
            current = []
        else:
            current.append(token)
    segments.append((current, ""))
    changed_environment = False
    for segment, separator in segments:
        if any(re.match(r"(?:export )?HOME=", p) for p in segment):
            changed_environment = True
        words = command_words(segment)
        if not words:
            if "(" in separator or ")" in separator:
                cwd = None
            continue
        name = os.path.basename(words[0])
        if name not in {"rm", "echo", "printf", "git"}:
            # Unknown shell constructs (e.g. leading redirections/case syntax)
            # must not hide a recursive rm. Do not treat ordinary echoed text
            # or git's own rm subcommand as shell deletion.
            for index, word in enumerate(words[1:], 1):
                if os.path.basename(word) == "rm":
                    tail = words[index + 1:]
                    if any(p == "--recursive" or
                           (p.startswith("-") and not p.startswith("--") and
                            bool(set(p[1:]) & {"r", "R"})) for p in tail):
                        return True
        if name in {"cd", "pushd", "popd"}:
            args = words[1:]
            if args[:1] == ["--"]:
                args = args[1:]
            cwd = literal_path(args[0] if args else home, home, cwd) if name == "cd" and len(args) <= 1 and args != ["-"] else None
            if separator != "&&" or (cwd and any(c in cwd for c in "*?[")):
                cwd = None
        elif name == "rm":
            recursive, targets, options = False, [], True
            for arg in words[1:]:
                if options and arg == "--":
                    options = False
                elif options and arg.startswith("-") and arg != "-":
                    recursive |= arg == "--recursive" or (not arg.startswith("--") and bool(set(arg[1:]) & {"r", "R"}))
                else:
                    targets.append(arg)
            if recursive and (changed_environment or any(unsafe_target(p, home, cwd, protected) for p in targets)):
                return True
            if any(any(c in p for c in "*?[") and
                   (changed_environment or unsafe_target(p, home, cwd, protected)) for p in targets):
                return True
            # Prefix assignments and sudo cwd changes alter resolution; never
            # pretend the inherited HOME/cwd describes those recursive commands.
            if recursive and (segment != words and any("=" in p or p in {"-D", "-R", "--chdir", "--chroot"} for p in segment[:len(segment) - len(words)])):
                return True
        if "(" in separator or ")" in separator:
            cwd = None
    return False


def main():
    try:
        payload = json.load(sys.stdin)
        if payload.get("tool_name") != "Bash":
            return 0
        command = payload["tool_input"]["command"]
        cwd = payload.get("cwd")
        home = os.path.normpath(os.environ["HOME"])
        if not isinstance(command, str) or not os.path.isabs(home):
            raise ValueError("invalid command or HOME")
        if not isinstance(cwd, str) or not os.path.isabs(cwd):
            cwd = None
        if not blocked(command, cwd, home):
            return 0
    except (ValueError, KeyError, TypeError, AttributeError):
        pass
    print(DENIAL, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
