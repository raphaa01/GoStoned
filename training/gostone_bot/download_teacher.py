from __future__ import annotations

import hashlib
import shutil
import sys
import urllib.request
from pathlib import Path

from .teacher import TEACHER_FILENAME, TEACHER_SHA256, TEACHER_URL, default_cache_dir


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def download_teacher(destination: Path | None = None) -> Path:
    target = destination or default_cache_dir() / TEACHER_FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and digest(target) == TEACHER_SHA256:
        print(f"KataGo human teacher already verified: {target}")
        return target
    temporary = target.with_suffix(target.suffix + ".download")
    temporary.unlink(missing_ok=True)
    print(f"Downloading the local-only KataGo teacher ({TEACHER_FILENAME})...")
    try:
        with urllib.request.urlopen(TEACHER_URL) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        actual = digest(temporary)
        if actual != TEACHER_SHA256:
            raise RuntimeError(f"Teacher checksum mismatch: expected {TEACHER_SHA256}, got {actual}")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Teacher ready and verified: {target}")
    return target


if __name__ == "__main__":
    try:
        download_teacher()
    except Exception as error:
        print(f"Teacher download failed: {error}", file=sys.stderr)
        raise SystemExit(1) from error
