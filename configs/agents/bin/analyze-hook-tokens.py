#!/usr/bin/env python3
"""Analyze hook context consumption across Claude Code sessions.

Hook injections (system-reminders) are NOT stored in transcripts — they're
injected at runtime into API requests. This script combines:
  1. hooks.jsonl — exact fire counts per session per hook
  2. Measured output sizes from hook source code
  3. API usage from transcripts — actual token consumption per turn

Usage:
    python3 analyze-hook-tokens.py [--days N] [--project PATTERN] [--verbose]
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

CLAUDE_PROJECTS = Path.home() / ".claude" / "projects"
HOOKS_LOG = Path.home() / ".agents" / "hooks" / ".logs" / "hooks.jsonl"
CHARS_PER_TOKEN = 4

# Measured output sizes (chars) per hook outcome, from reading hook source code.
# Only hooks that produce additionalContext or stdout are listed.
# "block" = verify/on-stop writes ~500-1500 chars (failure details + instructions)
HOOK_OUTPUT_CHARS = {
    ("Stop", "verify/on-stop", "block"): 1000,
    ("PreToolUse", "guards", "block"): 200,
    ("PreToolUse", "guards", "warn"): 150,
}

# Hooks that fire but produce NO context injection (logging/state only)
SILENT_HOOKS = {
    ("PreToolUse", "guards", "allow"),
    ("PostToolUse", "verify/on-edit", "tracked"),
    ("PostToolUse", "verify/on-bash", "skip"),
    ("PostToolUse", "verify/on-bash", "pass"),
    ("Stop", "verify/on-stop", "allow"),
    ("Stop", "verify/on-stop", "allow-token-verified"),
    ("Stop", "verify/on-stop", "allow-circuit-breaker"),
}


def tokens(chars: int) -> int:
    return max(1, chars // CHARS_PER_TOKEN)


def format_tok(t: int) -> str:
    if t >= 1000:
        return f"{t / 1000:.1f}k"
    return str(t)


def color_pct(pct: float) -> str:
    if pct >= 5:
        return f"\033[31m{pct:.1f}%\033[0m"
    if pct >= 2:
        return f"\033[33m{pct:.1f}%\033[0m"
    return f"\033[32m{pct:.1f}%\033[0m"


def parse_hooks_log(cutoff: datetime) -> dict[str, dict]:
    """Parse hooks.jsonl into per-session hook fire counts."""
    sessions = defaultdict(lambda: defaultdict(int))
    if not HOOKS_LOG.exists():
        return {}

    with open(HOOKS_LOG) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            ts_str = d.get("ts", "")
            try:
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue

            if ts < cutoff:
                continue

            sid = d.get("session", "")
            event = d.get("event", "")
            hook = d.get("hook", "")
            outcome = d.get("outcome", "")
            key = (event, hook, outcome)
            sessions[sid][key] += 1

    return dict(sessions)


def get_session_api_usage(path: Path) -> dict:
    """Extract API usage from a transcript file."""
    peak_input = 0
    total_output = 0
    turn_count = 0

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue

            if d.get("type") != "assistant":
                continue

            msg = d.get("message", {})
            usage = msg.get("usage", {})
            if not usage:
                continue

            inp = usage.get("input_tokens", 0)
            cache_r = usage.get("cache_read_input_tokens", 0)
            cache_w = usage.get("cache_creation_input_tokens", 0)
            total_in = inp + cache_r + cache_w
            out = usage.get("output_tokens", 0)

            if total_in > peak_input:
                peak_input = total_in
            total_output += out
            turn_count += 1

    return {
        "peak_input_tokens": peak_input,
        "total_output_tokens": total_output,
        "turn_count": turn_count,
    }


def find_transcript(session_id: str, project_filter: str | None) -> Path | None:
    """Find the transcript file for a session ID."""
    for project_dir in CLAUDE_PROJECTS.iterdir():
        if not project_dir.is_dir():
            continue
        if project_filter and project_filter not in project_dir.name:
            continue
        candidate = project_dir / f"{session_id}.jsonl"
        if candidate.exists():
            return candidate
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--days", type=int, default=3, help="Analyze sessions from last N days"
    )
    parser.add_argument("--project", type=str, help="Filter by project path pattern")
    parser.add_argument(
        "--verbose", "-v", action="store_true", help="Show per-session details"
    )
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)

    # Parse hooks log
    hook_fires = parse_hooks_log(cutoff)
    if not hook_fires:
        print("No hook data found for the given period.", file=sys.stderr)
        sys.exit(1)

    # Analyze each session
    results = []
    agg_hooks = defaultdict(lambda: {"count": 0, "est_chars": 0})

    for sid, fires in sorted(hook_fires.items()):
        transcript = find_transcript(sid, args.project)
        if args.project and not transcript:
            continue

        api = (
            get_session_api_usage(transcript)
            if transcript
            else {"peak_input_tokens": 0, "total_output_tokens": 0, "turn_count": 0}
        )

        session_inject_chars = 0
        session_inject_count = 0
        session_silent_count = 0
        session_hook_detail = {}

        for key, count in fires.items():
            est_chars = HOOK_OUTPUT_CHARS.get(key, 0) * count
            hook_label = f"{key[0]}:{key[1]}:{key[2]}"

            if key in SILENT_HOOKS:
                session_silent_count += count
            elif est_chars > 0:
                session_inject_chars += est_chars
                session_inject_count += count
                session_hook_detail[hook_label] = {
                    "count": count,
                    "est_chars": est_chars,
                }
                agg_hooks[hook_label]["count"] += count
                agg_hooks[hook_label]["est_chars"] += est_chars
            else:
                # Unknown hook with output — count but can't estimate size
                session_silent_count += count

        est_inject_tokens = tokens(session_inject_chars)
        peak = api["peak_input_tokens"]
        inject_pct = (est_inject_tokens / peak * 100) if peak > 0 else 0

        proj = transcript.parent.name if transcript else "?"

        results.append(
            {
                "session_id": sid,
                "project": proj,
                "turn_count": api["turn_count"],
                "peak_input_tokens": peak,
                "est_inject_tokens": est_inject_tokens,
                "inject_pct": inject_pct,
                "inject_count": session_inject_count,
                "silent_count": session_silent_count,
                "hooks": session_hook_detail,
            }
        )

    if not results:
        print("No sessions found for the given period.", file=sys.stderr)
        sys.exit(1)

    if args.json:
        json.dump(results, sys.stdout, indent=2, default=str)
        return

    # Aggregate
    total_sessions = len(results)
    total_inject_chars = sum(h["est_chars"] for h in agg_hooks.values())
    total_inject_count = sum(h["count"] for h in agg_hooks.values())
    total_peak = sum(r["peak_input_tokens"] for r in results)
    total_inject_tokens = tokens(total_inject_chars)

    print()
    print("=" * 72)
    print("  HOOK CONTEXT CONSUMPTION ANALYSIS")
    print(f"  {total_sessions} sessions | last {args.days} days")
    print("=" * 72)

    # Per-hook breakdown
    print()
    print("INJECTION BREAKDOWN (hooks that add to context window)")
    print("-" * 72)
    print(
        f"  {'Hook':<50} {'Fires':>6} {'~Tokens':>8} {'Avg/fire':>8}"
    )
    print(f"  {'-' * 50} {'-' * 6} {'-' * 8} {'-' * 8}")

    sorted_hooks = sorted(
        agg_hooks.items(), key=lambda x: x[1]["est_chars"], reverse=True
    )
    for label, stats in sorted_hooks:
        tok = tokens(stats["est_chars"])
        avg = tok // stats["count"] if stats["count"] > 0 else 0
        print(f"  {label:<50} {stats['count']:>6} {format_tok(tok):>8} {avg:>8}")

    print(f"  {'-' * 50} {'-' * 6} {'-' * 8}")
    print(
        f"  {'TOTAL':<50} {total_inject_count:>6} {format_tok(total_inject_tokens):>8}"
    )

    # Per-session table
    active = [r for r in results if r["inject_count"] > 0]
    active.sort(key=lambda r: r["inject_pct"], reverse=True)
    display = active if args.verbose else active[:15]

    if display:
        print()
        title = "PER-SESSION DETAILS" if args.verbose else "TOP SESSIONS BY HOOK OVERHEAD"
        print(title)
        print("-" * 72)
        print(
            f"  {'Session':<14} {'Project':<24} {'Turns':>5} {'Peak In':>8} {'Hooks':>8} {'%ctx':>6}"
        )
        print(f"  {'-' * 14} {'-' * 24} {'-' * 5} {'-' * 8} {'-' * 8} {'-' * 6}")

        for r in display:
            print(
                f"  {r['session_id'][:14]:<14} "
                f"{r['project'][-24:]:<24} "
                f"{r['turn_count']:>5} "
                f"{format_tok(r['peak_input_tokens']):>8} "
                f"{format_tok(r['est_inject_tokens']):>8} "
                f"{color_pct(r['inject_pct']):>16}"
            )

    # Cumulative impact estimate
    print()
    print("CUMULATIVE IMPACT")
    print("-" * 72)
    avg_pct = (
        sum(r["inject_pct"] for r in active) / len(active) if active else 0
    )
    avg_inject = total_inject_tokens // len(active) if active else 0
    print(f"  Sessions with injections:  {len(active)} / {total_sessions}")
    print(f"  Avg hook tokens/session:   ~{format_tok(avg_inject)}")
    print(f"  Avg % of peak context:     {color_pct(avg_pct)}")
    print(f"  Total hook tokens (all):   ~{format_tok(total_inject_tokens)}")

    # Recommendations
    print()
    print("RECOMMENDATIONS")
    print("-" * 72)
    if sorted_hooks:
        top = sorted_hooks[0]
        top_tok = tokens(top[1]["est_chars"])
        print(f"  Biggest consumer: {top[0]}")
        print(f"    {top[1]['count']} fires, ~{format_tok(top_tok)} tokens total")
        if "verify/on-stop" in top[0]:
            print("    -> Blocks Stop until tests/lint/typecheck are run.")
            print("    -> Review the block message — tighten if too verbose.")

    if avg_pct < 1:
        print("  Overall: hook overhead is negligible (<1%).")
    elif avg_pct < 3:
        print("  Overall: hook overhead is low (1-3%). Monitor but no action needed.")
    else:
        print("  Overall: hook overhead is significant (>3%). Consider optimizing.")
    print()


if __name__ == "__main__":
    main()
