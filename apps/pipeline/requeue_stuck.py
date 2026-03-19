"""One-off script to re-queue transcription for episodes stuck at downloading:100."""

from app.database import SessionLocal
from app.models import Episode
from app import job_queue

db = SessionLocal()
try:
    stuck = db.query(Episode).filter(Episode.status == "downloading:100").all()
    print(f"Found {len(stuck)} episodes stuck at downloading:100")
    for ep in stuck:
        print(f"  Queuing: {ep.title}")
        job_queue.enqueue(db, str(ep.id), "transcribe")
    print(f"Done — queued {len(stuck)} transcription tasks")
finally:
    db.close()
