# Worker Splitting Spec (Deprecated)

**Date:** 2026-03-18  
**Status:** Deprecated

This document previously described a Celery/Redis heavy-vs-light worker split.
That architecture is no longer used in Podlog.

Current implementation uses a PostgreSQL-backed job queue with a polling worker.

Current sources of truth:
- `prds/PRD-01-ingestion-pipeline.md`
- `prds/PRD-03-infrastructure.md`
- `apps/pipeline/app/worker.py`
- `apps/pipeline/app/job_queue.py`

Reason for deprecation:
- Celery/Redis services and `celery_app.py` are no longer part of the active repository architecture.
