# Updating Podlog

How to move to a new version without losing work, and how to get back if it
goes wrong.

## The short version

```bash
make update                  # move to the newest release
make update VERSION=0.10.0   # pin an exact version, or go back to one
```

## What `make update` actually does

The order matters more than the commands. Each step is there because skipping
it costs something real.

**1. It refuses if your working copy is dirty.** Updating moves `HEAD`, which
would either fail outright or bury your edits. Commit or `git stash` first.

**2. It drains the queue.** Podlog processes one episode at a time and a
transcription runs for minutes. Restarting mid-job loses that work — the
episode comes back as a `SYSTEM_ERROR` when the zombie sweep notices. If jobs
are running, the update stops the worker gracefully, gives it up to 60
seconds, and then checks that nothing is still marked running before going on.

**3. It takes a database backup, and refuses to continue without one.**
Migrations run automatically when the pipeline starts, so the update *is* the
migration. The nightly backup is not good enough here: restoring a day-old
dump costs a day of transcription, which on modest hardware is hours of CPU.
It waits up to 30 minutes for the dump to finish — a large library takes
minutes — and accepts only a dump completed by this run, never one already on
disk. Set `BACKUP_WAIT_SECONDS` if yours needs longer.

**4. It moves the working copy** — to the newest release tag, to `main` on the
`edge` channel, or to the tag you pinned with `VERSION=`.

**5. It fetches images** — pulling on `stable`, rebuilding on `edge`.

**6. It reports configuration drift.** Settings the new version's
`.env.example` lists that your `.env` does not set. This is advisory and never
blocks the update.

**7. It restarts**, and prints the restore command if anything failed.

## Channels

Set `PODLOG_CHANNEL` in `.env`:

| Channel | What `make update` follows |
|---|---|
| `stable` | the newest release tag (default) |
| `edge` | current `main`, rebuilt from source on every update |

`edge` builds rather than pulls, so it costs you the full compile each time.
It exists for tracking development, not for running a podcast archive you
care about.

Passing `VERSION=X.Y.Z` overrides the channel entirely.

## Configuration drift

```bash
make env-diff
```

Reports two things: settings `.env.example` lists that your `.env` does not
set, and settings in your `.env` that the example no longer mentions.

Neither is necessarily a problem. Most of `.env.example` is commented out on
purpose — it documents optional knobs, and many have working defaults in the
app. Read the comment above each one in `.env.example` to tell which matter.

**It never edits `.env`.** That file holds your Postgres password and every
API key you have configured. Applying anything is your keystroke, not a
script's.

## Rolling back

When an update goes wrong, `make update` has already printed the way out:

```bash
make restore-db DATE=2026-08-27          # the dump it took before starting
make update VERSION=<the one you were on>
```

That order matters — restore the database first, then move the code back to
match it.

**Rolling back does not mean `alembic downgrade`.** The downgrade paths across
Podlog's migrations have never been exercised, and presenting them as a safe
route would be a lie. Restore-from-dump is the supported rollback, which is
why step 3 above refuses to proceed without a fresh one.

## Architecture

Published images are **linux/amd64 only**. Multi-architecture builds would mean
emulating a multi-gigabyte machine-learning dependency install in CI — slow and
flaky, for no current benefit.

On any other architecture, build from source:

```bash
make build && make up
```

Everything else on this page works the same; only the pull step differs.

## Being told an update exists

Off by default. Podlog does not contact anything you did not ask it to, and a
version check is an outbound call like any other.

To turn it on, set this in `.env` and restart the web service:

```
UPDATE_CHECK_ENABLED=true
```

The footer then shows a link when a newer release exists. Details worth
knowing:

- **The machine running Podlog makes the call**, not your browser. On a LAN
  install that is one request rather than one per device per page.
- **Roughly every six hours**, cached in between. A tab left open does not
  keep asking.
- **It never installs anything.** Updating is still `make update`, run by you.
- **Failure is silence.** Offline, air-gapped, DNS blocked or rate-limited all
  show nothing rather than an error.

## Where the backups are

`make update` uses the same backup system as everything else. To see what is on
disk:

```bash
make backup-list
```

See [Backups](16-backups.md) for retention, restore walkthroughs, and how to
copy dumps off the machine.
