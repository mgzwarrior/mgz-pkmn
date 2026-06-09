"""Format/age helpers + the soft warn-on-large-cache check shared by stats and lookup."""

from __future__ import annotations

import shlex
import time

import click

from .. import cache as disk_cache


def _format_bytes(n: int) -> str:
    """Render a byte count with a human-readable suffix (B/KB/MB/GB).

    Powers-of-1024 to match `du -h`; one decimal once we leave the B range
    so small caches still show "12 B" without a noisy ".0"."""
    units = ("B", "KB", "MB", "GB", "TB")
    size = float(n)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} {units[-1]}"  # unreachable, satisfies type-checkers


def _format_age(mtime: float | None, *, now: float | None = None) -> str:
    """Render an mtime as a relative age (e.g. '3d ago', '5h ago').

    `now` is injectable so tests can pin the comparison instant — production
    callers leave it at None and get `time.time()`."""
    if mtime is None:
        return "—"
    delta = (now if now is not None else time.time()) - mtime
    if delta < 60:
        return "just now"
    if delta < 3600:
        return f"{int(delta // 60)}m ago"
    if delta < 86400:
        return f"{int(delta // 3600)}h ago"
    return f"{int(delta // 86400)}d ago"


def _warn_if_cache_large() -> None:
    """Soft-warn when the on-disk cache exceeds the configured threshold."""
    threshold = disk_cache.cache_warn_threshold()
    if threshold <= 0:
        return
    size = disk_cache.cache_size_bytes()
    if size <= threshold:
        return
    root = str(disk_cache.cache_root())
    click.secho(
        f"⚠ cache directory is {_format_bytes(size)} "
        f"(threshold {_format_bytes(threshold)}). "
        f"Run with --clear-cache or `rm -rf {shlex.quote(root)}` to reclaim space.",
        fg="yellow",
        err=True,
    )
