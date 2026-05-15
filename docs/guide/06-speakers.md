# Speaker Management

Podlog automatically labels speakers in each episode and offers tools to rename, role-tag, and merge them.

## Automatic Speaker Labeling

After transcription, pyannote analyzes the audio to detect different speakers. Each speaker is assigned a label: `SPEAKER_00`, `SPEAKER_01`, etc. These labels are consistent within an episode but not across episodes (the same person may be SPEAKER_00 in one episode and SPEAKER_01 in another).

A speaker's slot number is meaningful: `SPEAKER_00` is the first real speaker to appear (the host on most podcasts). Subsequent slots are guests / cohosts / others in their order of first appearance.

## AI-Inferred Names

If `INFERENCE_ENABLED=true` (the default), Podlog reads the episode's RSS metadata (title, description, `<itunes:author>`, `<podcast:person>` tags) and the first few minutes of the transcript, runs spaCy named-entity recognition over that text, and guesses host and guest names. Inferred names show an "AI" badge to distinguish them from user-confirmed names — they're a starting point, override them if they're wrong.

A speaker can also be tagged with one of three roles using the buttons on each speaker card: **Host**, **Guest**, or **Other**. Roles drive how the speaker is sorted in the panel (hosts first, then guests, then others, then unassigned) and how their text is treated by features like the Meta-Analysis "host share" chart.

## Renaming a Speaker

1. On the episode detail page, click any speaker name.
2. Type the correct name.
3. The name is saved immediately and marked as user-confirmed.

User-confirmed names take priority over AI-inferred names and won't be overwritten by future inference runs.

Confirmed names are also what populate the **Speaker** filter on the `/search` page, and they feed the per-feed "speaker cache" that helps name the same person automatically on later episodes of the same show.

## Merging Speakers

Sometimes pyannote splits one real speaker into multiple labels (e.g., `SPEAKER_00` and `SPEAKER_02` are both the host). To fix this:

1. On the episode detail page, open the speaker panel.
2. Select the speakers you want to merge (checkboxes).
3. Choose the target speaker (the one to keep).
4. Click **Merge**.

All segments from the source speakers are reassigned to the target. The merge is atomic — it either fully completes or doesn't change anything.

You'll also frequently see speakers labeled with role **Other** and no display name. These are usually short voice fragments — cold opens, ad-reads, brief misdiarized interjections — that the inference pipeline deliberately did not name (see "Why some speakers come up as Other" below). The expected workflow is to merge each Other into whichever real speaker it actually belongs to, or to give it its own name if it really is a distinct person.

## When Diarization Fails

If pyannote can't process the audio (too noisy, unsupported language, etc.), the episode is still transcribed — you just won't have speaker labels. The transcript shows all text without speaker separation. Renaming and merging are unavailable in this case since there are no speaker labels to work with.

---

## Under the hood: how speaker inference works

This section walks through the actual code that produces the inferred names you see in the speaker panel. It's pinned to the codebase as of commit `9237a61` — if a function gets renamed or moved, the links here will need to be updated alongside.

### The pipeline

Speaker inference runs as one stage of the per-episode processing pipeline, after diarization and before archival. The entry point is [`apps/pipeline/app/tasks/infer.py`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/tasks/infer.py). Each invocation:

1. Loads the episode + feed rows from Postgres and the segment list ordered by `start_time`.
2. Builds the candidate set — every plausible name to consider — from RSS metadata, NER over text, and the per-feed user-rename cache.
3. Classifies each candidate as host, guest, or "other" with HIGH / MEDIUM / LOW confidence.
4. Decides which speaker slot each candidate belongs to by analyzing the segment stream (the "run analysis" step).
5. Writes the final names back to the `speaker_names` table.

Inference is a **soft failure** — if it crashes for any reason, the episode still archives normally, just without inferred names. The schema field `episodes.inference_error` records what went wrong.

### Where candidates come from

Two functions feed the candidate list. Both live in [`apps/pipeline/app/services/inference_ner.py`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_ner.py).

**[`extract_metadata_candidates`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_ner.py#L186)** — pulls names from structured RSS data and prior user history. These bypass NER entirely and arrive at the classifier with a pre-declared role and confidence:

| Source | Role | Confidence | Notes |
|---|---|---|---|
| `feed_speaker_cache` (SPEAKER_00 entries) | host | HIGH | Names the user has previously confirmed on this feed's host slot. The strongest signal — these are corrections, not guesses. |
| `feed_speaker_cache` (SPEAKER_NN entries) | guest | HIGH | Names the user has previously confirmed on guest slots, **but only when corroborated by this episode's title, description, or `<podcast:person>` tags**. Otherwise dropped. This guard prevents every cached guest from being seeded into every episode. |
| `<podcast:person>` on the episode | as declared | HIGH | Publisher-declared role on the specific episode. |
| `<podcast:person>` on the channel | as declared | HIGH | Publisher-declared role on the feed. |
| `<itunes:author>` | host | HIGH | Implies "this is the on-air author". |
| Recurring host observation | host | MEDIUM | When the same name appears as SPEAKER_00 across ≥ 80% of the feed's recent episodes (see [`get_recurring_host_name`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_db.py#L32)). Kept at MEDIUM specifically so the rule cannot self-reinforce — every cycle still has to consume a real HIGH signal from somewhere else. |
| `<itunes:owner>` | host | MEDIUM | Sometimes a business contact, sometimes the on-air voice. |
| Episode-level `<author>` / `<dc:creator>` | host | MEDIUM | Same as above. |

**[`extract_candidates`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_ner.py#L131)** — runs spaCy on five text sources to extract PERSON entities. These start *without* a role or confidence; the classifier assigns those based on context (see below).

| Source | What it is |
|---|---|
| `episode_description` | The episode's text description, HTML-stripped. |
| `episode_title` | The episode's title, with "Ep 42:" / "S03E12 -" prefixes stripped so they don't confuse spaCy. |
| `feed_title` | The show's top-level title. |
| `feed_description` | The show's top-level description, HTML-stripped. |
| `transcript_intro` | The concatenated text of the first ≤ 300 seconds (or first 150 segments) of the episode. Catches host / guest self-introductions like "Today I'm joined by Dror Poleg" that don't appear in the written description. |

The metadata and NER lists are merged (with dedupe by normalized name — "Dr. Jane Smith" and "Jane Smith" are the same person) by [`merge_candidates`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_classify.py#L25).

### How names get classified

[`classify_candidates`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_classify.py#L73) takes the merged list and decides host vs guest, HIGH vs MEDIUM vs LOW. Metadata candidates keep their pre-assigned role/confidence — the rules below only apply to NER candidates (no `source` from `METADATA_SOURCES`):

1. **Name appears in `feed_title`** → host, HIGH. ("Tim Ferriss" found in "The Tim Ferriss Show" is the strongest possible host signal.)
2. **Name appears near a host-pattern phrase in `feed_description`** ("hosted by …", "with your host …") → host, MEDIUM.
3. **Name appears near a guest-signal phrase in `episode_description`** ("with guest …", "today's guest is …", "joined by …") → guest, HIGH or MEDIUM depending on the strength of the surrounding phrase.
4. **Name appears after a colon in `episode_title` or the description's first line** ("Ep 42: Elon Musk on AI") → guest, HIGH.
5. **Fallback**: guest, LOW.

The first host wins; later host-classified candidates get demoted to guest. For metadata sources where confidence reflects how strong the signal is (`<podcast:person>`, recurring-host, `feed_speaker_cache`), the demoted candidate keeps its confidence; for `itunes:author` / `itunes:owner` the second slot is usually a business contact, so they get demoted to LOW.

If only **one** name is found total and it came from NER (not metadata), it gets reclassified as guest LOW — a single name in a podcast description is more often a guest than the host.

### Slot assignment and run analysis

Once we know who's host and who's a guest, we need to map them to actual SPEAKER_NN slots in the segments table. That happens in [`assign_speaker_slots`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference.py#L138).

This is the step that handles the "first speaker isn't always the host" problem. The naive rule of "first voice you hear becomes SPEAKER_00" mislabels every show that opens with a producer voice-over or a skit. Instead:

1. **Walk the segments in time order** and group consecutive same-label segments into *runs*. A run extends across gaps ≤ 2 seconds when no other speaker spoke in between; longer gaps or a different-label segment close the run.
2. **A run is "real"** if `run_duration ≥ 15 s` OR `run_segments ≥ 20`. Otherwise it's "short".
3. **A pyannote label is "real"** if it has at least one real run anywhere in the episode. Otherwise it's "fully short" — every appearance is a brief interjection.
4. **Real labels** keep all their segments together and get assigned SPEAKER_00, SPEAKER_01, … by order of first appearance among themselves. SPEAKER_00 is always a real label (it's the first real speaker to talk).
5. **Each run of a fully-short label** becomes its own SPEAKER_NN slot, numbered after the real labels, and marked `role='other'` with no display name. The user sees these as "Other" cards ready to merge into the right speaker.

Why "real" looks at runs not totals: a speaker who talks for 30 seconds in one block is a real participant even if they only have 1 or 2 segments; a speaker with 13 scattered 1-second interjections is almost always a diarization slip or a multi-voice misclustering, not a real participant.

**Isolated-short-run carve-out.** Step 4 above keeps short interjections glued to a real pyannote label by default, which trusts pyannote's clustering at the label level. That trust breaks down when pyannote conflates two different voices into one label — for example, a 4-second cold-open / pre-roll voice that gets clustered with the guest because both clips are short. To catch this without over-fragmenting normal back-and-forth, a short run is *also* split off as Other when its temporally-nearest same-label neighbour (previous or next run with the same pyannote label) is more than `DEFAULT_ISOLATION_GAP_SECONDS = 60.0` away. Typical mid-conversation interjections sit within a few seconds of surrounding same-label runs, so they stay; an isolated intro voice with a > 60 s gap before its parent label reappears gets the Other treatment.

Defaults are exposed as module constants in `inference.py` — `DEFAULT_SHORT_RUN_SECONDS = 15.0`, `DEFAULT_SHORT_RUN_SEGMENTS = 20`, `DEFAULT_RUN_GAP_SECONDS = 2.0`, `DEFAULT_ISOLATION_GAP_SECONDS = 60.0`.

### Why some speakers come up as Other

After slot assignment, the inference pipeline writes one of two row types to `speaker_names`:

- **Named row** — assigned to a real speaker label, with the host or guest name from the classifier. [`write_speaker_names`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/services/inference_db.py#L201) only writes a row when the SPEAKER_NN slot actually appears in the segments table — it does **not** mechanically fill SPEAKER_01..N with leftover guest candidates the classifier had on hand (that would produce phantom rows for people who aren't in the episode).
- **Other row** — assigned to fragmented short runs, with `display_name=""` and `role='other'`. [`_write_other_rows`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/tasks/infer.py#L229) emits these for every slot in the slot assignment's `other_labels` set.

Once you start renaming and merging Others into real speakers, your fixes feed back through `feed_speaker_cache` and influence inference on future episodes of the same feed.

### Tuning knobs

Settings in [`apps/pipeline/app/config.py`](https://github.com/brlauuu/podlog/blob/9237a61b712ccb288a6ef5b89ce4bc5c39e4c60c/apps/pipeline/app/config.py#L70) that affect inference:

| Env var | Default | What it does |
|---|---:|---|
| `INFERENCE_ENABLED` | `true` | Master switch. Set `false` to skip inference entirely; segments still get SPEAKER_NN labels from pyannote. |
| `SPACY_MODEL` | `en_core_web_trf` | Which spaCy model NER uses. Falls back to `en_core_web_lg` if `trf` isn't installed. The `trf` model is ~500 MB and is the PRD-04 default; `lg` is ~200 MB. |
| `RECURRING_HOST_WINDOW` | `10` | How many recent episodes the recurring-host observation looks at. |
| `RECURRING_HOST_THRESHOLD` | `0.8` | How much of that window has to agree on the same name before it fires. |
| `FEED_SPEAKER_CACHE_RECENCY_DAYS` | `365` | Cache entries older than this many days are ignored. Set `0` to disable the cutoff. |

The run-analysis defaults (`DEFAULT_SHORT_RUN_SECONDS`, `DEFAULT_SHORT_RUN_SEGMENTS`, `DEFAULT_RUN_GAP_SECONDS`, `DEFAULT_TRANSCRIPT_NER_MAX_SECONDS`, `DEFAULT_TRANSCRIPT_NER_MAX_SEGMENTS`) are module constants today, not environment variables. They're tuned for typical podcast episodes; if you have a show with unusual structure (very short episodes, fast-paced multi-host shows, etc.) and need to override them, file an issue.

### Known tradeoffs

- **Quiet hosts.** If your host barely speaks in an episode (e.g., a heavily guest-led interview where the host's longest turn is 14 seconds), the host's pyannote label might fall on the wrong side of the "real" threshold and fragment into Other slots. Workaround: rename + merge after the fact; the rename will populate `feed_speaker_cache` so the next episode will use the recurring-host pathway.
- **Cohost shows where one cohost only sometimes shows up.** The "sometimes" cohost will land as SPEAKER_01 in episodes they appear in and not be inferred in episodes they don't. The cache helps on later episodes once they've been renamed.
- **Episodes where the host doesn't self-introduce and isn't named anywhere in metadata.** Rare but possible — these will get a host-less inference result and you'll have to label SPEAKER_00 manually.
- **Whisper transcription errors in the first 5 minutes.** Self-introductions are the highest-value text the new transcript-intro NER source consumes; if Whisper hears "Welcome to the Jeff Shapiro Podcast" instead of "Jacob Shapiro", inference will follow the mistake. The metadata path usually rescues this on shows with good RSS data.
- **Re-running inference on an already-renamed episode.** A reprocess of an episode where you've already confirmed names will preserve the confirmed `speaker_names` rows (the `confirmed_by_user` guard) but may change *which* SPEAKER_NN label each segment carries if the run analysis settles differently. After a reprocess, double-check the speaker panel.

---

**Next:** [Audio Playback](07-audio-playback.md) | **Back:** [Episodes & Transcripts](05-episodes.md) | **Home:** [Guide](README.md)
