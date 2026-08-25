# Backups

Podlog ships with a daily backup service that runs automatically as part of the standard `make up` stack. It dumps the Postgres database and snapshots the audio archive to a host directory you can mount on a separate disk.

## What's backed up

| Volume | What it holds | Backed up? | Why |
|---|---|---|---|
| `podlog_postgres_data` | All transcripts, segments, chunks, embeddings, queue state, speaker name confirmations | **Yes** — daily `pg_dump` | Manually-confirmed speaker names + embeddings are expensive/impossible to regenerate |
| `podlog_audio_data` (`/data/audio/archive`) | Compressed archived episodes (~29 MB per audio-hour) | **Yes** — daily incremental rsync | RSS feeds drop old episodes; original audio can't be re-downloaded |
| `podlog_audio_data` (`/data/audio/raw`) | Raw downloads, deleted after archive | No | Intermediate; archive contains the same content compressed |
| `podlog_transcript_data` | Intermediate WhisperX/Fireworks artifacts | No | Cleaned up after each episode finishes; reproducible |
| `podlog_model_cache`, `podlog_ollama_data` | Downloaded ML models | No | Re-downloadable from HuggingFace / Ollama |

## Where backups land

On the host, in **`./backups/`** (gitignored). Layout:

```
backups/
├── db/
│   ├── daily/      podlog-YYYY-MM-DD.dump   (pg_dump --format=custom)
│   ├── weekly/     hardlinked from daily/ on Sundays
│   └── monthly/    hardlinked from daily/ on the 1st of each month
├── audio/
│   ├── 2026-05-01/ rsync snapshot (hardlinked against previous day)
│   ├── 2026-04-30/
│   └── ...
└── .last_run       date of the most recent successful run
```

Hardlinks across daily → weekly/monthly mean a weekly retention slot adds ~zero disk; the dump file is the same inode. Same for the rsync `--link-dest` snapshots — unchanged audio files cost zero per-snapshot.

## Retention

Configured via env vars (defaults in parentheses):

- `BACKUP_RETENTION_DAILY` (`7`) — last N daily DB dumps and audio snapshots.
- `BACKUP_RETENTION_WEEKLY` (`4`) — last N Sunday DB dumps.
- `BACKUP_RETENTION_MONTHLY` (`12`) — last N first-of-month DB dumps.

Set any to `0` to skip that bucket. Set all three to `0` to disable backups entirely (the service still runs and logs "backups disabled").

## Cadence

The container wakes hourly and checks whether today's date already appears in `/backups/.last_run`. If not, it runs once and writes today's date. Same-day duplicates are impossible. If the host is off when the daily window opens, the backup runs on next start.

## Inspecting backups from the web app

The **Settings → Backups** tab in the web app lists everything currently on disk: daily / weekly / monthly DB dumps with their dates and sizes, audio snapshots, the configured retention per tier, and the date of the most recent run. It's read-only — restore still goes through `make restore-db` / `make restore-audio` (next section). Useful when you want to confirm the daily run actually ran without shelling onto the host.

## Operational commands

| Command | What it does |
|---|---|
| `make backup-list` | List available DB dumps + audio snapshots |
| `make backup-now` | Force a backup run right now (clears the last-run flag) |
| `make restore-db DATE=YYYY-MM-DD` | DESTRUCTIVE: drop + recreate `podlog` from a dated dump |
| `make restore-audio DATE=YYYY-MM-DD` | DESTRUCTIVE: rsync a dated snapshot back into the audio volume |
| `docker compose logs -f backup` | Follow the backup service's logs |

Both restore commands prompt for `yes` confirmation before doing anything destructive.

## Restore walkthrough

```sh
$ make backup-list
DB dumps (daily):
  podlog-2026-04-25.dump
  podlog-2026-04-26.dump
  ...
  podlog-2026-05-01.dump
Audio snapshots:
  2026-04-25
  2026-04-26
  ...
  2026-05-01

$ make restore-db DATE=2026-04-30
About to DROP and recreate the 'podlog' database from backup dated 2026-04-30.
Type 'yes' to continue: yes
... (drops, recreates, pg_restore runs)
Restore complete. Restart the pipeline + worker to pick up the new state:
  docker compose restart pipeline worker
```

The restore Make target stops `pipeline`, `worker`, and `web` before the restore (no in-flight writes) and starts them again after.

## Off-host backups

The `./backups/` directory is the user's responsibility to replicate off-machine if you care about disaster recovery (host disk failure, accidental `rm -rf`). Pattern that works well:

```sh
# nightly cron entry, off the Podlog host:
rsync -a user@podloghost:/path/to/podlog/backups/ /local/podlog-mirror/
```

Or push to S3/B2/rclone-supported storage. Outside the scope of the built-in service.

## Disabling

Set `BACKUP_RETENTION_DAILY=0`, `BACKUP_RETENTION_WEEKLY=0`, `BACKUP_RETENTION_MONTHLY=0` in `.env` and restart the backup service. The container stays running but stops creating dumps / snapshots.

To remove the service entirely from your stack, comment out the `backup:` block in `docker-compose.yml`.

## Disk-cost estimate

For a steady-state Podlog with ~1,000 transcribed episodes:

**Audio snapshots dominate, and they cost about one extra copy.** The first snapshot is the same size as the live archive — roughly 29 GB for 1,000 one-hour episodes at 64 kbps. Every snapshot after that is hardlinked with `--link-dest`, so unchanged files cost nothing and each additional day only pays for newly archived episodes. Seven daily snapshots of a library that grew by one episode a day cost ~29 GB plus a few hundred MB, not 7 × 29 GB.

**Database dumps are small by comparison.** A `pg_dump --format=custom` of a ~4.6 GB database compresses to a few hundred MB. The weekly and monthly tiers are hardlinks to a daily dump rather than fresh copies, so they add nothing on the day they are promoted — you pay only for daily dumps that have since been pruned from `daily/` but are still held by `weekly/` or `monthly/`. Budget on the order of 1–2 GB for all 23 retention slots.

**Rule of thumb: backups roughly double your audio footprint, and add a couple of GB for the database.** Allocate accordingly, especially if `./backups/` lives on the same disk as the live volumes — which defeats most of the point, so prefer a separate disk.

## Caveats

- `pg_dump` runs against the live DB. Dumps are consistent (single transaction) but the DB serves reads/writes throughout — momentary load spike, no downtime.
- Audio rsync runs against the live archive. Files added during the rsync may or may not appear in the snapshot; the next day's snapshot will catch them.
- The backup container has the Postgres password and write access to the audio volume. Treat it like the rest of the stack — don't expose its volumes off-machine.
- Time zone: backups stamp the date in **UTC** so a "daily" backup is well-defined regardless of host clock.

---

**Next:** [Troubleshooting](17-troubleshooting.md) | **Back:** [Database Exploration with Jupyter](15-explore.md) | **Home:** [Guide](README.md)
