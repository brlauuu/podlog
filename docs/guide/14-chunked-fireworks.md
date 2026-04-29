# Chunked Fireworks Transcription (Long Episodes)

Fireworks AI's transcription endpoint enforces an undocumented upload cap that aborts large files mid-upload at the TLS layer. Long podcast episodes (typically over ~2 hours) hit this and fail with a `FIREWORKS_UPLOAD_REJECTED` error. The actionable fallback used to be "re-run on local inference," which works but is slow if you have many such episodes.

**Chunked Fireworks transcription** is the alternative: Podlog splits the audio into smaller pieces, transcribes each separately on Fireworks, and stitches the results back into a single transcript. Diarization runs once on the original whole file via your configured diarization provider — chunking is purely a transcription-side workaround.

This is opt-in. The default is single-shot upload, byte-identical to the historical behavior.

## When to enable it

Turn it on when:

- You have a backlog of episodes that failed with `FIREWORKS_UPLOAD_REJECTED` (or pre-#600 `TRANSIENT_NETWORK` failures whose error message contains the SSL `BAD_RECORD_MAC` signature — same root cause).
- You want to keep transcription on Fireworks for speed/cost reasons rather than falling back to local for long episodes.
- You're processing podcasts where episodes routinely exceed ~2 hours.

Keep it off when:

- You don't use Fireworks for transcription at all.
- You only have short episodes (under ~1 hour) and you've never seen the upload-cap failure.
- You're fine running long episodes on local inference.

## How it works

1. **Plan**: Podlog probes the audio duration and computes a chunk schedule (default chunk size 15 min, default 3 s overlap between adjacent chunks).
2. **Extract & upload**: Each chunk is extracted with ffmpeg `-c copy` (no re-encode, fast and lossless) into a tempdir, then uploaded to Fireworks's transcription endpoint.
3. **Retry & bisect**: If a chunk fails with a transient error, it's retried (default 2 retries). If a chunk hits the upload cap itself, it's bisected — split into halves with the same overlap, recursed up to depth 2 (max 4 sub-chunks). A bisect floor of 30 s prevents infinite recursion when the failure isn't size-related.
4. **Stitch**: All per-chunk responses are concatenated with timestamps shifted to whole-episode time. In each overlap window, duplicate words are resolved by midpoint split — the earlier chunk owns the first half of the seam, the later chunk owns the second half.
5. **Diarize**: Diarization runs separately on the **whole file** via the provider configured for the Diarization step (local pyannote or pyannote.ai precision-2 cloud). Per-chunk Fireworks speaker IDs are not used because they cannot be reconciled across chunks (each chunk's `SPEAKER_00` is a different person).

The resulting database row is indistinguishable from a single-shot Fireworks run.

## Setup

### 1. Make sure Fireworks transcription is configured

Open Settings (**http://localhost:3000/settings**) → **Remote Inference** tab. The Transcription step's switch must be set to "Remote" (Fireworks) and a valid Fireworks API key must be saved. If you're new to remote inference, see the existing remote inference docs for getting an API key.

### 2. Enable chunked transcription

Under the Transcription step card you'll now see **Chunk long episodes**. Flip it on. The default tunables work for most cases.

If you want to override defaults, expand **Advanced tunables**:

| Setting | Default | Notes |
|---|---|---|
| Chunk size (sec) | 900 (15 min) | Smaller = more uploads but lower risk of hitting the cap. Minimum 60. |
| Overlap (sec) | 3 | Buffer for words that straddle a cut. 0 makes chunks contiguous (more risk of splitting words). |
| Per-chunk retries | 2 | Retries on transient errors. Does **not** retry on the upload cap (that triggers bisection instead). |

### 3. Pick a diarization provider

Chunked transcription delegates diarization to your configured provider. Two options:

- **pyannote.ai precision-2 cloud** (recommended for long episodes): no local CPU/RAM cost, no per-chunk reconciliation needed, and pyannote.ai's upload path is presigned-URL PUT (S3-style) which doesn't share Fireworks's cap. See the [pyannote Cloud guide](13-pyannote-cloud.md) for setup.
- **Local pyannote**: works, but defeats some of the speedup since long episodes are exactly the ones where local diarization is slowest. Use only if you don't want to add another paid service.

> **Open question.** pyannote.ai precision-2's exact size cap is not publicly documented. Podlog's working assumption is that it's effectively unbounded for typical podcast files (architectural signal: presigned-URL upload, no API gateway gating). If you find an episode that fails diarization on precision-2 with a size error, please open an issue — the fallback is local pyannote on the whole file, but no automatic switch is implemented.

### 4. Bulk-retry your backlog

If you already have failed episodes piling up, the Queue dashboard shows a banner with the count and Fireworks cost estimate:

> **245 episodes failed because Fireworks rejected the upload.** Total 21629 min · estimated $129.78 on Fireworks STT.

The "Retry with chunking" button is enabled only after you've turned on chunked transcription in Settings. Click it, confirm the dialog, and Podlog re-enqueues every matching episode. Both post-#600 (`FIREWORKS_UPLOAD_REJECTED`) and pre-#600 (`TRANSIENT_NETWORK` with `BAD_RECORD_MAC`) failures are caught.

## Failure handling

Each chunk has its own failure handling, and the whole episode fails with a clean message naming the offending audio range when something terminal happens.

| Situation | Behavior |
|---|---|
| Chunk hits a transient error (`TRANSIENT_NETWORK`, `HTTP_ACCESS`) | Retry up to `chunk_max_retries` times, then bisect or fail. |
| Chunk hits the upload cap | Bisect into halves, retry. Up to depth 2 (max 4 sub-chunks per original chunk). |
| Chunk smaller than 30 s still hits the cap | Refuse to bisect further (the cap isn't size-related at that point). Episode fails with `FIREWORKS_CHUNK_FAILED` and the failing audio range. |
| All bisects exhausted | Episode fails with `FIREWORKS_CHUNK_FAILED` and the original chunk's audio range. **No automatic fallback to local** — surfacing the failure is the design (you decide whether to flip transcription to local for that episode). |

## Cost

Costs are linear in audio minutes regardless of how many chunks you split into — chunking does not duplicate audio billing. The estimated cost shown in the bulk-retry banner is `total_minutes × fireworks_stt_cost_per_minute_usd` (the per-minute rate you configured in Settings → Remote Inference). For 245 episodes totaling ~360 hours at the default $0.006/min rate, that's roughly $130.

A bisect that succeeds adds the bisected sub-chunks' minutes on top of the original chunk's minutes — but bisects are rare in practice unless you're actively hitting the cap, and the duplication is bounded by depth 2.

## Caveats

- **Diarization on local pyannote runs on the whole long file.** If your hardware can't handle whole-file local pyannote, switch the Diarization step to pyannote.ai cloud.
- **Per-chunk speaker IDs from Fireworks are discarded** when chunked transcription is on. Don't enable Fireworks's `diarize=true` flag (the wiring already overrides it) and don't expect to see speaker labels in the raw Fireworks artifact.
- **Tempdir disk usage**: each chunk briefly lives on disk during transcription. With 15-minute chunks at typical podcast bitrates, that's ~22 MB per chunk. The tempdir is automatically cleaned up on success or failure.
- **The worker is single-threaded.** Chunks for one episode upload sequentially, not in parallel. Cross-episode parallelism is unchanged (still one episode at a time per the existing `concurrency=1` design).

## Related

- [Issue #600](https://github.com/brlauuu/podlog/issues/600) — the upstream root cause and `FIREWORKS_UPLOAD_REJECTED` classifier this builds on.
- [Issue #610](https://github.com/brlauuu/podlog/issues/610) — design discussion and acceptance criteria for the chunked path.

---

**Next:** [Meta-Analysis Dashboard](15-meta-analysis.md) | **Back:** [pyannote Cloud Diarization](13-pyannote-cloud.md) | **Home:** [Guide](README.md)
