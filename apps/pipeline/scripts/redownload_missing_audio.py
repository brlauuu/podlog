#!/usr/bin/env python3
"""Re-download audio for episodes whose audio file is missing on disk.

Covers two cases:
  1. `audio_local_path` is set but the file is gone (external wipe of the volume).
  2. `audio_local_path` is NULL — episode was archived without keeping a path
     (e.g. archive_audio off at the time, or archive partial-failed). For these
     we recover into the standard archive path and write the path back to the DB.

Either way we re-fetch `audio_url`, re-encode to MP3 64 kbps to match
archive.py's `_compress_audio` output, and write to the archive directory.

Non-fetchable URLs (`local://`, etc.) are skipped — those are manual uploads
without a remote source and need a fresh user re-upload.

Usage (inside the worker container — needs app.* imports + /data mount):
    python /app/scripts/redownload_missing_audio.py --list
    python /app/scripts/redownload_missing_audio.py --episode-id <uuid>
    python /app/scripts/redownload_missing_audio.py --all
"""
import argparse
import logging
import sys
import tempfile
from pathlib import Path

import ffmpeg
import httpx

from app.config import settings
from app.database import SessionLocal
from app.models import Episode

logger = logging.getLogger("redownload")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def _is_fetchable_url(url: str | None) -> bool:
    return bool(url) and url.startswith(("http://", "https://"))


def _target_path(episode: Episode) -> Path:
    """Where the recovered MP3 should land."""
    if episode.audio_local_path:
        return Path(episode.audio_local_path)
    return Path(settings.audio_archive_dir) / f"{episode.id}.mp3"


def find_missing(db) -> list[Episode]:
    """Episodes that should have audio on disk but don't.

    Two states qualify:
      - audio_local_path set, file gone (volume wipe case)
      - audio_local_path NULL, episode is `done`, audio_url is fetchable
    """
    rows = (
        db.query(Episode)
        .filter(Episode.status == "done")
        .order_by(Episode.processed_at)
        .all()
    )
    out = []
    for e in rows:
        if e.audio_local_path:
            if not Path(e.audio_local_path).exists():
                out.append(e)
        elif _is_fetchable_url(e.audio_url):
            out.append(e)
    return out


def redownload_one(db, episode: Episode) -> tuple[bool, str]:
    target = _target_path(episode)
    needs_writeback = episode.audio_local_path is None
    if target.exists() and not needs_writeback:
        return True, "already_present"
    if not _is_fetchable_url(episode.audio_url):
        return False, f"unrecoverable_url_scheme: {episode.audio_url}"

    tmp = tempfile.NamedTemporaryFile(prefix="redl_", suffix=".raw", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    try:
        try:
            with httpx.stream(
                "GET",
                episode.audio_url,
                follow_redirects=True,
                timeout=120.0,
                headers={"User-Agent": "podlog-redownload/1.0"},
            ) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes(chunk_size=65536):
                        f.write(chunk)
        except httpx.HTTPStatusError as exc:
            return False, f"http_{exc.response.status_code}"
        except httpx.InvalidURL as exc:
            # `local://...` (manual upload, no remote source) — unrecoverable
            # without a fresh user upload. Caller will fall back to Plan A.
            return False, f"unrecoverable_url: {exc}"
        except httpx.RequestError as exc:
            return False, f"download_error: {type(exc).__name__}: {exc}"

        if tmp_path.stat().st_size == 0:
            return False, "empty_download"

        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            ffmpeg.input(str(tmp_path)).output(
                str(target),
                audio_bitrate=settings.audio_archive_bitrate,
                acodec="libmp3lame",
            ).overwrite_output().run(capture_stdout=True, capture_stderr=True)
        except ffmpeg.Error as exc:
            stderr = (exc.stderr or b"").decode("utf-8", "replace")[:300]
            return False, f"ffmpeg: {stderr}"

        if not target.exists() or target.stat().st_size == 0:
            return False, "encode_produced_nothing"

        size = target.stat().st_size
        if needs_writeback:
            db.query(Episode).filter(Episode.id == episode.id).update(
                {"audio_local_path": str(target)}
            )
            db.commit()
            return True, f"{size:,} bytes (path_writeback={target})"
        return True, f"{size:,} bytes"
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--episode-id", help="Re-download a single episode by ID")
    group.add_argument("--all", action="store_true", help="Re-download all missing")
    group.add_argument("--list", action="store_true", help="Dry-run: list missing episodes")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.episode_id:
            ep = db.query(Episode).filter(Episode.id == args.episode_id).first()
            if not ep:
                logger.error("episode not found: %s", args.episode_id)
                return 1
            if ep.audio_local_path and Path(ep.audio_local_path).exists():
                logger.warning(
                    "file already present at %s — nothing to do", ep.audio_local_path
                )
                return 0
            if not _is_fetchable_url(ep.audio_url):
                logger.error(
                    "audio_url not fetchable (%s) — episode needs manual re-upload",
                    ep.audio_url,
                )
                return 1
            episodes = [ep]
        else:
            episodes = find_missing(db)
            logger.info("found %d episodes with missing audio", len(episodes))
            if args.list:
                for ep in episodes:
                    print(f"{ep.id}\t{ep.title}")
                return 0

        ok = 0
        fail = 0
        failed_ids: list[str] = []
        for i, ep in enumerate(episodes, 1):
            logger.info(
                "[%d/%d] %s — %s",
                i,
                len(episodes),
                ep.id,
                (ep.title or "")[:60],
            )
            success, msg = redownload_one(db, ep)
            if success:
                ok += 1
                logger.info("  OK   %s", msg)
            else:
                fail += 1
                failed_ids.append(str(ep.id))
                logger.warning("  FAIL %s", msg)

        logger.info("=" * 60)
        logger.info("done: %d ok, %d fail", ok, fail)
        if failed_ids:
            logger.info("failed IDs (candidates for audio_local_path=NULL):")
            for fid in failed_ids:
                print(fid)
        return 0 if fail == 0 else 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
