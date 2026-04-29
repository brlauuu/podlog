"""
Diarization task -- PRD-01 S5.5

- Runs pyannote speaker diarization on the audio file
- If word-level alignment data exists (from WhisperX), assigns speakers per word
  and rebuilds segments at speaker boundaries
- Falls back to segment-level majority overlap if no word data available
- Graceful failure: if diarization fails for any reason, the transcript is
  preserved (has_diarization=False, diarization_error populated) and the
  pipeline continues through chunk/embed/infer/archive
"""
import json
import logging
import time
from pathlib import Path

from app.config import settings
from app.database import SessionLocal
from app.models import Episode, Segment
from app.services.notification_settings import (
    get_runtime_diarization_settings,
    get_runtime_inference_settings,
)
from app.tasks.helpers import update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def _elapsed_seconds(start: float) -> float:
    return round(time.monotonic() - start, 1)


def diarize_episode(episode_id: str) -> str:
    db = SessionLocal()
    alignment_path = Path(settings.transcript_dir) / f"{episode_id}.whisperx.json"
    fireworks_path = Path(settings.transcript_dir) / f"{episode_id}.fireworks.json"
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode or not episode.audio_local_path:
            raise RuntimeError(f"Episode {episode_id} missing for diarization")

        runtime = get_runtime_inference_settings(db)
        provider = runtime.get("inference_provider") or "local"
        diarization_runtime = get_runtime_diarization_settings(db)
        diarization_provider = diarization_runtime.get("diarization_provider") or "local"

        # Issue #610: chunked Fireworks transcription does not carry usable
        # speaker IDs (per-chunk numbering can't be reconciled across the
        # episode), so route diarization to the whole-file path governed by
        # diarization_provider — exactly as if inference_provider were local.
        chunked_fireworks = provider == "fireworks" and bool(
            runtime.get("fireworks_chunked_transcription_enabled")
        )

        if provider == "fireworks" and not chunked_fireworks:
            # Fireworks mode uses remote diarization metadata and never loads pyannote locally.
            step_durations: dict[str, float] = {}
            try:
                t0 = time.monotonic()
                if not bool(runtime.get("fireworks_stt_diarize", True)):
                    # Provider is remote and diarization is intentionally disabled.
                    update_episode(
                        db, episode_id,
                        has_diarization=False,
                        diarization_error=None,
                        diarize_step_durations=None,
                    )
                    job_queue.enqueue(db, episode_id, "chunk")
                    return episode_id
                if not fireworks_path.exists():
                    raise RuntimeError("Missing Fireworks transcript artifact for diarization")

                t_load = time.monotonic()
                with open(fireworks_path) as f:
                    raw = json.load(f)
                step_durations["artifact_load_secs"] = _elapsed_seconds(t_load)

                from app.services.fireworks_audio import (
                    diarization_segments_from_transcription,
                    assign_segment_speakers_from_words,
                    rebuild_segments_from_words,
                )

                # Preferred path: rebuild segments from word-level speaker data,
                # mirroring the WhisperX word-level alignment used by the local
                # provider. This gives per-sentence granularity and correct
                # speaker labels without the segment-level majority-overlap
                # approximation.
                t_rebuild = time.monotonic()
                rebuilt = rebuild_segments_from_words(raw)
                if rebuilt:
                    db.query(Segment).filter(Segment.episode_id == episode_id).delete()
                    for seg in rebuilt:
                        db.add(
                            Segment(
                                episode_id=episode_id,
                                start_time=seg["start"],
                                end_time=seg["end"],
                                text=seg["text"],
                                speaker_label=seg["speaker"],
                            )
                        )
                    db.flush()
                    step_durations["segment_rebuild_secs"] = _elapsed_seconds(t_rebuild)
                    logger.info(
                        '"action": "diarize_fireworks_wordlevel_complete", "episode_id": "%s", '
                        '"segments": %d, "speakers": %d',
                        episode_id,
                        len(rebuilt),
                        len({s["speaker"] for s in rebuilt}),
                    )
                else:
                    # Fallback: segment-level speaker assignment (no word data available).
                    t_provider = time.monotonic()
                    diarization_segments = diarization_segments_from_transcription(raw)
                    step_durations["provider_diarization_secs"] = _elapsed_seconds(t_provider)
                    if diarization_segments:
                        step_durations.update(_diarize_segment_level(db, episode_id, diarization_segments))
                    else:
                        transcript_segments = (
                            db.query(Segment)
                            .filter(Segment.episode_id == episode_id)
                            .order_by(Segment.start_time)
                            .all()
                        )
                        t_assign = time.monotonic()
                        assignments = assign_segment_speakers_from_words(
                            transcript_segments=[
                                {"id": s.id, "start": s.start_time, "end": s.end_time}
                                for s in transcript_segments
                            ],
                            raw=raw,
                        )
                        if not assignments:
                            raise RuntimeError("No speaker labels found in Fireworks transcript words")
                        for seg_id, speaker in assignments.items():
                            db.query(Segment).filter(Segment.id == seg_id).update(
                                {"speaker_label": speaker}
                            )
                        db.flush()
                        step_durations["speaker_assignment_secs"] = _elapsed_seconds(t_assign)
                diarize_secs = round(time.monotonic() - t0, 1)
                update_episode(
                    db, episode_id,
                    has_diarization=True,
                    diarization_error=None,
                    diarize_duration_secs=diarize_secs,
                    diarize_step_durations=step_durations,
                )
            except Exception as exc:
                update_episode(
                    db, episode_id,
                    has_diarization=False,
                    diarization_error=str(exc),
                    diarize_step_durations=step_durations or None,
                )
                logger.warning(
                    '"action": "diarize_failed_graceful", "episode_id": "%s", "error": "%s"',
                    episode_id,
                    str(exc),
                )
        elif diarization_provider == "precision2":
            # pyannote.ai cloud diarization — no local model load/unload needed.
            audio_path = episode.audio_local_path
            step_durations: dict[str, float] = {}
            try:
                from app.services.pyannote_cloud import diarize_via_cloud

                t0 = time.monotonic()
                t_provider = time.monotonic()
                diarization_segments, billed_secs, cost_usd = diarize_via_cloud(
                    audio_path,
                    api_key=diarization_runtime.get("pyannote_api_key") or "",
                    base_url=diarization_runtime.get("pyannote_cloud_base_url")
                    or "https://api.pyannote.ai/v1",
                    model=diarization_runtime.get("pyannote_cloud_model") or "precision-2",
                    cost_per_second_usd=float(
                        diarization_runtime.get("pyannote_cloud_cost_per_second_usd") or 0.0
                    ),
                )
                step_durations["provider_diarization_secs"] = _elapsed_seconds(t_provider)

                if alignment_path.exists():
                    step_durations.update(
                        _diarize_wordlevel(db, episode_id, alignment_path, diarization_segments)
                    )
                else:
                    step_durations.update(_diarize_segment_level(db, episode_id, diarization_segments))

                diarize_secs = round(time.monotonic() - t0, 1)
                update_episode(
                    db, episode_id,
                    has_diarization=True,
                    diarization_error=None,
                    diarize_duration_secs=diarize_secs,
                    diarize_step_durations=step_durations,
                    pyannote_cloud_cost_usd=cost_usd,
                )
                logger.info(
                    '"action": "diarize_precision2_complete", "episode_id": "%s", '
                    '"billed_secs": %.1f, "cost_usd": %.4f',
                    episode_id,
                    billed_secs,
                    cost_usd,
                )

            except Exception as exc:
                update_episode(
                    db, episode_id,
                    has_diarization=False,
                    diarization_error=str(exc),
                    diarize_step_durations=step_durations or None,
                )
                logger.warning(
                    '"action": "diarize_failed_graceful", "episode_id": "%s", "error": "%s"',
                    episode_id,
                    str(exc),
                )
        else:
            audio_path = episode.audio_local_path
            step_durations: dict[str, float] = {}

            try:
                from app.services.pyannote import diarize

                t0 = time.monotonic()
                t_provider = time.monotonic()
                diarization_segments = diarize(audio_path)
                step_durations["provider_diarization_secs"] = _elapsed_seconds(t_provider)

                # Try word-level alignment first (preferred)
                if alignment_path.exists():
                    step_durations.update(
                        _diarize_wordlevel(db, episode_id, alignment_path, diarization_segments)
                    )
                else:
                    step_durations.update(_diarize_segment_level(db, episode_id, diarization_segments))

                diarize_secs = round(time.monotonic() - t0, 1)
                update_episode(
                    db, episode_id,
                    has_diarization=True,
                    diarization_error=None,
                    diarize_duration_secs=diarize_secs,
                    diarize_step_durations=step_durations,
                )

            except Exception as exc:
                # Diarization failure is non-fatal -- transcript is preserved (PRD-01 S5.5)
                update_episode(
                    db, episode_id,
                    has_diarization=False,
                    diarization_error=str(exc),
                    diarize_step_durations=step_durations or None,
                )
                logger.warning(
                    '"action": "diarize_failed_graceful", "episode_id": "%s", "error": "%s"',
                    episode_id,
                    str(exc),
                )
            finally:
                # MANDATORY: unload pyannote before next episode's Whisper can load (PRD-01 S5.4)
                from app.services.pyannote import unload_pipeline
                unload_pipeline()

        job_queue.enqueue(db, episode_id, "chunk")
        return episode_id
    finally:
        # Clean up intermediate alignment artifacts
        if alignment_path.exists():
            try:
                alignment_path.unlink()
            except Exception:
                pass
        if fireworks_path.exists():
            try:
                fireworks_path.unlink()
            except Exception:
                pass
        db.close()


def _diarize_wordlevel(
    db, episode_id: str, alignment_path: Path, diarization_segments: list[dict]
) -> dict[str, float]:
    """Word-level speaker assignment: rebuild segments at speaker boundaries."""
    from app.services.alignment import assign_speakers_wordlevel

    step_durations: dict[str, float] = {}
    t_load = time.monotonic()
    with open(alignment_path) as f:
        aligned_result = json.load(f)
    step_durations["alignment_io_secs"] = _elapsed_seconds(t_load)

    aligned_segments = aligned_result.get("segments", [])

    # Check if word-level data actually exists
    has_words = any(seg.get("words") for seg in aligned_segments)
    if not has_words:
        logger.info(
            '"action": "diarize_wordlevel_no_words", "episode_id": "%s", '
            '"reason": "alignment data has no word timestamps, falling back to segment-level"',
            episode_id,
        )
        step_durations.update(_diarize_segment_level(db, episode_id, diarization_segments))
        return step_durations

    t_assign = time.monotonic()
    rebuilt_segments = assign_speakers_wordlevel(aligned_segments, diarization_segments)
    step_durations["speaker_assignment_secs"] = _elapsed_seconds(t_assign)

    if not rebuilt_segments:
        logger.warning(
            '"action": "diarize_wordlevel_empty_result", "episode_id": "%s", '
            '"reason": "word-level assignment produced 0 segments, falling back to segment-level"',
            episode_id,
        )
        step_durations.update(_diarize_segment_level(db, episode_id, diarization_segments))
        return step_durations

    # Replace existing segments with rebuilt ones
    db.query(Segment).filter(Segment.episode_id == episode_id).delete()
    for seg in rebuilt_segments:
        db.add(
            Segment(
                episode_id=episode_id,
                start_time=seg["start"],
                end_time=seg["end"],
                text=seg["text"],
                speaker_label=seg["speaker"],
            )
        )
    db.flush()

    logger.info(
        '"action": "diarize_wordlevel_complete", "episode_id": "%s", '
        '"segments": %d, "speakers": %d',
        episode_id,
        len(rebuilt_segments),
        len({s["speaker"] for s in rebuilt_segments}),
    )
    return step_durations


def _diarize_segment_level(
    db, episode_id: str, diarization_segments: list[dict]
) -> dict[str, float]:
    """Fallback: segment-level majority overlap speaker assignment."""
    from app.services.alignment import assign_speakers

    transcript_segments = (
        db.query(Segment)
        .filter(Segment.episode_id == episode_id)
        .order_by(Segment.start_time)
        .all()
    )

    t_assign = time.monotonic()
    assignments = assign_speakers(
        transcript_segments=[
            {"id": s.id, "start": s.start_time, "end": s.end_time}
            for s in transcript_segments
        ],
        diarization_segments=diarization_segments,
    )

    for seg_id, speaker in assignments.items():
        db.query(Segment).filter(Segment.id == seg_id).update(
            {"speaker_label": speaker}
        )
    db.flush()
    step_durations = {"speaker_assignment_secs": _elapsed_seconds(t_assign)}

    logger.info(
        '"action": "diarize_segment_level_complete", "episode_id": "%s", '
        '"segments": %d, "speakers": %d',
        episode_id,
        len(assignments),
        len(set(assignments.values())),
    )
    return step_durations
