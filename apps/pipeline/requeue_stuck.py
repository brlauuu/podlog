"""One-off script to re-queue transcription for episodes stuck at downloading:100."""

from app.database import SessionLocal
from app.models import Episode
from app.tasks.transcribe import transcribe_episode

db = SessionLocal()
try:
    stuck = db.query(Episode).filter(Episode.status == "downloading:100").all()
    print(f"Found {len(stuck)} episodes stuck at downloading:100")
    for ep in stuck:
        print(f"  Queuing: {ep.title}")
        transcribe_episode.delay(str(ep.id))
    print(f"Done — queued {len(stuck)} transcription tasks")
finally:
    db.close()
