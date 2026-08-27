"""Stage-to-stage flow through the pipeline (#1015).

Every other pipeline test starts an episode mid-flight: `tests/integration/
test_pipeline.py` seeds a `sample_episode`, sets `status = "transcribing"`,
and calls one task. That covers each stage's depth and none of the joins
between them.

The joins are where this project's bugs have actually been. #968 (chunking
and embedding missing from the stage list), #972 (two slot-numbering
schemes colliding across a boundary), #983 (a stale error surviving the
success path) were all seam defects, invisible to a test that runs one
stage in isolation.

There is no routing table to test -- each task hardcodes its successor at
the end of its own body, seven `job_queue.enqueue` calls in seven files.
This test drives the chain the way the worker does and asserts it holds.

WHAT IS REAL AND WHAT IS STUBBED

Real: the database, the job queue, `TASK_HANDLERS`, every task body, the
chunking logic, and the archive file moves.

Stubbed: the download, and the four calls into models we do not own
(Whisper, pyannote, the embedding model, the NER/LLM inference). Running
those for real would mean model downloads and minutes of CPU per run, to
cover libraries whose behaviour is not ours. The stage bodies and their
handoffs are ours.
"""
import shutil
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import pytest

from app import job_queue
from app.config import settings
from app.models import Chunk, Episode, Segment
from app.task_registry import TASK_HANDLERS

FIXTURE_AUDIO = Path(__file__).parent.parent / "fixtures" / "sample.mp3"

# Every module that does `from app.database import SessionLocal` at import
# time and therefore needs its own patch to reach the test session.
TASK_MODULES = [
    "app.tasks.download",
    "app.tasks.transcribe",
    "app.tasks.diarize",
    "app.tasks.chunk",
    "app.tasks.embed",
    "app.tasks.infer",
    "app.tasks.archive",
]

MOCK_SEGMENTS = [
    {"start": 0.0, "end": 5.0, "text": "Welcome to the show, I am your host."},
    {"start": 5.0, "end": 10.0, "text": "Thanks for having me on today."},
    {"start": 10.0, "end": 15.0, "text": "Let us talk about the pipeline."},
]

MOCK_DIARIZATION = [
    {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
    {"speaker": "SPEAKER_01", "start": 5.0, "end": 10.0},
    {"speaker": "SPEAKER_00", "start": 10.0, "end": 15.0},
]

# A cap, not a expectation: a routing bug that enqueues in a cycle should
# fail loudly here rather than hang CI until the job times out.
MAX_JOBS = 20


def _drain(db, observed_statuses, episode_id):
    """Run queued jobs to completion, mirroring worker.py's dispatch.

    Deliberately not `worker.main()`: that sleeps, installs signal handlers
    and runs periodic tasks. This is the same three lines that matter --
    poll, dispatch through TASK_HANDLERS, complete -- with nothing that
    makes a test slow or non-deterministic.
    """
    ran = []
    for _ in range(MAX_JOBS):
        job = job_queue.poll(db)
        if job is None:
            break
        ran.append(job.task)
        TASK_HANDLERS[job.task](job.episode_id)
        job_queue.complete(db, job)
        ep = db.query(Episode).filter(Episode.id == episode_id).one()
        observed_statuses.append(ep.status)
    else:
        raise AssertionError(
            f"queue did not drain within {MAX_JOBS} jobs; ran {ran} -- "
            "a stage is probably enqueueing itself"
        )
    return ran


@pytest.fixture
def flow(db_session, sample_episode, tmp_path):
    """An episode ready to be downloaded, with the outside world stubbed."""
    audio_src = tmp_path / "source.mp3"
    shutil.copy(FIXTURE_AUDIO, audio_src)

    flow_id = sample_episode.id
    sample_episode.status = "pending"
    sample_episode.audio_url = f"file://{audio_src}"
    db_session.flush()

    def fake_download(url, dest, episode_id, db):
        Path(dest).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(audio_src, dest)

    def _fake_compress(src, dest_dir, *args, **kwargs):
        # ffmpeg exists in the test image, but re-encoding the fixture on every
        # run buys nothing -- the file move is what archive is being tested for.
        dest = Path(dest_dir) / f"{flow_id}.mp3"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(audio_src, dest)
        return dest

    def fake_embed(texts, runtime=None):
        # 384 dims to match all-MiniLM-L6-v2, the configured default.
        return [[0.01] * 384 for _ in texts]

    with ExitStack() as stack:
        for mod in TASK_MODULES:
            stack.enter_context(patch(f"{mod}.SessionLocal", return_value=db_session))

        stack.enter_context(patch("app.tasks.download._download_file", side_effect=fake_download))
        stack.enter_context(patch("app.tasks.transcribe._convert_to_wav"))
        stack.enter_context(patch("app.tasks.transcribe._unload_whisper"))
        stack.enter_context(
            patch("app.services.whisper.transcribe", return_value=(MOCK_SEGMENTS, "en", None))
        )
        stack.enter_context(patch("app.services.pyannote.diarize", return_value=MOCK_DIARIZATION))
        stack.enter_context(patch("app.services.embed.embed_texts", side_effect=fake_embed))
        # audio_raw_dir / audio_archive_dir / transcript_dir are all computed
        # properties over data_dir, so redirecting the one field keeps every
        # file this flow writes inside tmp_path.
        stack.enter_context(patch.object(settings, "data_dir", str(tmp_path / "data")))
        stack.enter_context(
            patch("app.tasks.archive._compress_audio", side_effect=_fake_compress)
        )

        yield sample_episode


class TestPipelineFlow:
    def test_one_download_job_carries_the_episode_to_done(self, db_session, flow):
        """The whole point: enqueue once, and the chain does the rest."""
        observed: list[str] = []
        job_queue.enqueue(db_session, str(flow.id), "download")

        ran = _drain(db_session, observed, flow.id)

        db_session.refresh(flow)
        assert flow.status == "done", f"ended at {flow.status!r} after running {ran}"

    def test_every_stage_runs_in_order(self, db_session, flow):
        """Reaching `done` is not enough -- #968 was episodes skipping stages.

        A chain that silently dropped embed would still finish; asserting the
        endpoint alone would have called that a pass.
        """
        observed: list[str] = []
        job_queue.enqueue(db_session, str(flow.id), "download")

        ran = _drain(db_session, observed, flow.id)

        assert ran == [
            "download",
            "transcribe",
            "diarize",
            "chunk",
            "embed",
            "infer",
            "archive",
        ]

    def test_each_stage_leaves_what_the_next_one_needs(self, db_session, flow):
        """The handoff, checked by its output rather than its status."""
        job_queue.enqueue(db_session, str(flow.id), "download")
        _drain(db_session, [], flow.id)

        db_session.refresh(flow)

        segments = db_session.query(Segment).filter(Segment.episode_id == flow.id).all()
        assert len(segments) == len(MOCK_SEGMENTS), "transcribe left no segments for diarize"
        assert any(s.speaker_label for s in segments), "diarize labelled nothing for chunk"

        chunks = db_session.query(Chunk).filter(Chunk.episode_id == flow.id).all()
        assert chunks, "chunk produced nothing for embed"
        assert any(c.embedding is not None for c in chunks), "embed wrote no vectors"

        assert flow.audio_local_path, "download recorded no audio path"
        assert flow.has_diarization is True

    def test_success_leaves_no_stale_error_state(self, db_session, flow):
        """#983: inference_error survived the success path and kept showing."""
        job_queue.enqueue(db_session, str(flow.id), "download")
        _drain(db_session, [], flow.id)

        db_session.refresh(flow)
        assert flow.status == "done"
        assert flow.error_message is None
        assert flow.error_class is None
        assert flow.inference_error is None
