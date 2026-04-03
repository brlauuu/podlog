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

Speaker badges indicate the name source:
- No badge: user-confirmed name
- "AI" badge: name inferred by spaCy NER (see [Speaker Management](06-speakers.md))

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

- **"Diarization failed"** — pyannote couldn't label speakers (noisy audio, etc.), but the transcript is still usable. Speaker labels will be missing.
- **"Speaker inference unavailable"** — spaCy NER couldn't extract speaker names. You can still rename speakers manually.

---

**Next:** [Speaker Management](06-speakers.md) | **Back:** [Search](04-search.md) | **Home:** [Guide](README.md)
