# Episodes & Transcripts

Each processed episode has a detail page showing its full transcript with speaker labels and timestamps.

## Episode Detail Page

Navigate to any episode from search results, the podcast page, or the queue. The episode page shows:

- **Metadata**: title, publication date, duration, processing times
- **Podcast context**: feed title, artwork
- **Transcript**: the full text organized by speaker turns with timestamps

## Reading the Transcript

The transcript is displayed as a series of speaker-labeled sections. Each section shows:

- **Speaker name** (or label like SPEAKER_00 if not yet named) with a colored badge
- **Timestamp** — the start time of that segment, clickable to play audio
- **Text** — the transcribed speech

In the speaker panel, badges next to each name indicate where it came from:

- **Inferred** (violet) — the name was proposed by spaCy NER and you haven't confirmed it yet. A **Confirm** button sits alongside so you can accept it in one click.
- **✓ Confirmed** (green) — you confirmed or typed this name yourself.
- Neither badge — the speaker still has its raw `SPEAKER_NN` label and no name has been proposed.

See [Speaker Management](06-speakers.md) for the full workflow.

## Clickable Timestamps

Click any timestamp to start audio playback from that point. The persistent player at the bottom of the screen loads the episode's audio and seeks to the clicked position. See [Audio Playback](07-audio-playback.md) for details.

## Reprocessing an Episode

If you change your Whisper model, compute type, or other processing settings, existing episodes aren't automatically re-transcribed. To reprocess:

1. Open the episode detail page
2. Click **Reprocess**
3. The episode is re-queued through the full pipeline

This deletes the existing transcript and segments, then re-downloads, re-transcribes, and re-diarizes from scratch.

## Status Banners

You may see banners at the top of an episode page:

- **"Speaker labels unavailable — diarization failed"** — pyannote couldn't label speakers (noisy audio, etc.), but the transcript is still usable. The reason is appended when pyannote reported one. Episode cards show the same condition as a **No labels** tag.
- **"Speaker name inference was unavailable for this episode."** — spaCy NER couldn't extract any speaker names. You can still rename speakers manually. This banner is suppressed if inference managed to name at least one speaker.
- **"Processing failed"** — shown for a failed episode, with the error class in brackets and the error message underneath. See [Queue Dashboard](08-queue.md) for what each class means.

---

**Next:** [Speaker Management](06-speakers.md) | **Back:** [Search](04-search.md) | **Home:** [Guide](README.md)
