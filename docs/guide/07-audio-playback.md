# Audio Playback

Podlog includes a persistent audio player for listening to episodes alongside their transcripts.

## The Player

The audio player is fixed to the bottom of the screen. Once you start playing an episode, the player persists across page navigation — you can search, browse other episodes, or check the queue without interrupting playback.

**Controls:**
- Play/pause
- Seek bar (click to jump to any position)
- Current time / total duration
- Volume control and mute toggle
- Skip forward/backward 15 seconds

## Playing from Timestamps

The primary way to use the player is by clicking timestamps in a transcript:

1. Open any episode with a completed transcript
2. Click a timestamp (e.g., `12:34`)
3. The player loads the episode's audio and seeks to that moment

This lets you read a transcript and instantly hear the original audio for any section.

## Direct Links

Episode URLs support a timestamp hash for direct linking:

```
http://localhost:3000/episodes/{id}#t-120
```

This opens the episode and auto-scrolls to the segment nearest 120 seconds. Combined with a timestamp click, it also starts playback. These URLs are bookmarkable and shareable.

Search result timestamps include this hash, so clicking a search result takes you directly to the relevant moment.

## When Audio Isn't Available

Audio playback requires the episode's audio to be archived locally. If audio isn't available:

- **`ARCHIVE_AUDIO=false`**: Audio is deleted after transcription to save disk. Transcripts are still fully searchable, but playback is unavailable.
- **Audio not yet archived**: The episode may still be processing. Check the [Queue](08-queue.md).

---

**Next:** [Queue Dashboard](08-queue.md) | **Back:** [Speaker Management](06-speakers.md) | **Home:** [Guide](README.md)
