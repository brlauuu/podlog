# Managing Feeds

Podlog organizes content by RSS feed. Each feed represents one podcast.

## Feed Modes

When adding a feed, you choose how many episodes to ingest — and, as a consequence, whether Podlog keeps watching the feed for new ones:

| Mode | Episodes Ingested | Auto-Poll | Use Case |
|---|---|---|---|
| **Test** | 1 (the most recent) | No | Try a feed before committing to the full back-catalog |
| **Selective** | You pick which ones | No | Large back-catalogs where you only want specific episodes |
| **Full** | All episodes | Yes | Normal subscription — ingest everything and keep up to date |

**Only Full-mode feeds are polled automatically.** Test and Selective feeds are ingested once and then left alone: a Test feed exists to try one episode, and a Selective feed contains exactly the episodes you chose, so pulling in new ones behind your back would defeat the point of both. Promote a feed to Full when you want it kept current.

## Adding a Feed

1. Open **Sources** (`/podcasts`) and click **Manage feeds**, or go directly to `/feeds`. Click **Add Feed**.
2. Paste the RSS feed URL
3. Choose a mode:
   - **Test** — click Add, the latest episode is queued immediately
   - **Selective** — click Next to see a list of all episodes, check the ones you want, then Add
   - **Full** — click Add, all episodes are queued

On the Selective episode list there is a **filter box** above the episodes. Type part of a title to narrow the list — useful on a back-catalogue of several hundred, where scrolling to find two specific episodes is painful. The filter only changes what you can see: anything you have already ticked stays ticked and is still added, even while hidden. While a filter is active, **Select all** applies to just the episodes on screen and says so ("Select all 12 shown"), so you can filter to a year or a guest and take the lot in one click.

Feed cards carry a **Test** or **Selective** badge so you can tell at a glance which feeds are being kept current and which are not. Full-mode feeds are unbadged. Each card also shows its episode count and when it was last polled.

## Promoting a Feed

You can upgrade a feed's mode at any time:

- **Test → Full**: click **Promote to Full** on the feed card, and confirm. All remaining episodes are queued for processing.
- **Selective → Full**: same button. Episodes you didn't select initially are now queued.

Promotion never re-processes episodes that are already done. It is also what switches a feed on for automatic polling.

## Adding More Selective Episodes

Selective feeds get an extra **Add episodes** button. It reopens the episode picker with everything you haven't ingested yet, so you can pull in a few more without promoting the whole back-catalog. The same filter box is available here, and episodes already in the feed stay greyed out and untouched — including when you use **Select all** on a filtered view.

## Polling for New Episodes

- **Automatic:** The worker checks every Full-mode, unpaused feed on a fixed interval (default 24 hours, configurable via `FEED_POLL_INTERVAL_HOURS`). New episodes are queued automatically.
- **Manual:** Click the refresh icon on a Test or Full feed card to poll immediately. Selective feeds have no refresh icon — use **Add episodes** instead.

Manual polling is useful when you know a new episode just dropped and don't want to wait for the next automatic poll. Note that polling a Test feed will not pull anything new: Test mode is capped at one episode, so once it has that episode the poll updates the "last polled" timestamp and stops.

**If a poll can't reach the feed** — the show's host is down, or your network is — the "last polled" timestamp is left alone and the feed is tried again on the next cycle, rather than counting the failure as a completed poll and waiting another full interval. A manual refresh reports the error instead of quietly doing nothing. So a feed whose timestamp is older than the poll interval is telling you something real: recent polls have been failing. The worker logs `poll_feed_failed` with the feed id in that case.

## Pausing a Feed

The pause button on a feed card stops ingestion without deleting anything. A paused feed shows a **Paused** badge, is skipped by automatic polling, and has its refresh icon disabled — the tooltip reads *"Unpause to poll"*. Everything already ingested stays searchable.

Use this when a show goes on hiatus, or when you want to stop a chatty feed from filling the queue for a while. Click the same button again to resume. Selective feeds have no pause button, since they are never auto-polled in the first place.

## Deleting a Feed

Click the delete button on a feed card. You'll be asked whether to also delete the feed's episodes and transcripts, or keep them.

- **Keep episodes:** Transcripts remain searchable, but no new episodes will be ingested.
- **Delete episodes:** All transcripts, segments, and archived audio for that feed are removed.

---

**Next:** [Search](04-search.md) | **Back:** [First Run](02-first-run.md) | **Home:** [Guide](README.md)
