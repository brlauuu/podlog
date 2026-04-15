# Managing Feeds

Podlog organizes content by RSS feed. Each feed represents one podcast.

## Feed Modes

When adding a feed, you choose how many episodes to ingest:

| Mode | Episodes Ingested | Auto-Poll | Use Case |
|---|---|---|---|
| **Test** | 1 (latest only) | Yes | Try a feed before committing to the full back-catalog |
| **Selective** | You pick which ones | Yes | Large back-catalogs where you only want specific episodes |
| **Full** | All episodes | Yes | Normal subscription — ingest everything and keep up to date |

All modes auto-poll for new episodes (default: every 24 hours, configurable via `FEED_POLL_INTERVAL_HOURS`).

## Adding a Feed

1. Open **Sources** (`/podcasts`) and click **Manage feeds**, or go directly to `/feeds`. Click **Add Feed**.
2. Paste the RSS feed URL
3. Choose a mode:
   - **Test** — click Add, the latest episode is queued immediately
   - **Selective** — click Next to see a list of all episodes, check the ones you want, then Add
   - **Full** — click Add, all episodes are queued

## Promoting a Feed

You can upgrade a feed's mode at any time:

- **Test → Full**: click **Promote to Full** on the feed card. All remaining episodes are queued for processing.
- **Selective → Full**: same button. Episodes you didn't select initially are now queued.

Promotion never re-processes episodes that are already done.

## Polling for New Episodes

- **Automatic:** The worker checks all feeds every 24 hours (configurable). New episodes are queued automatically.
- **Manual:** Click the refresh icon on any feed card to poll immediately.

Manual polling is useful when you know a new episode just dropped and don't want to wait for the next automatic poll.

## Deleting a Feed

Click the delete button on a feed card. You'll be asked whether to also delete the feed's episodes and transcripts, or keep them.

- **Keep episodes:** Transcripts remain searchable, but no new episodes will be ingested.
- **Delete episodes:** All transcripts, segments, and archived audio for that feed are removed.

---

**Next:** [Search](04-search.md) | **Back:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
