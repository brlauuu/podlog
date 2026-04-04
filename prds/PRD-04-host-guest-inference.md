# PRD-04: Host & Guest Inference from Episode Metadata

**Project:** Podlog — Self-hosted Podcast Transcription & Search  
**Document:** PRD-04 — Host & Guest Inference  
**Version:** 1.1  
**Status:** Draft  
**Depends on:** PRD-01 v1.1, PRD-02 v1.1, PRD-03 v1.1

---

## 1. Problem Statement

After diarization, speakers are labeled `SPEAKER_00`, `SPEAKER_01`, etc. with no human context. The user must manually rename each speaker on every episode. Podcast RSS feeds almost always contain episode descriptions and feed-level metadata that name the host and guest(s) explicitly — phrases like "my guest today is Dr. Jane Smith" or "featuring Lex Fridman" are ubiquitous. This feature parses that metadata using spaCy NER and heuristic pattern matching to infer which speaker is the host and which are guests, then assigns speaker slots deterministically: `SPEAKER_00` is always the host, `SPEAKER_01`/`SPEAKER_02`/etc. are guests. The result is pre-populated display names in the UI that the user can confirm or correct, dramatically reducing manual labeling work.

---

## 2. Goals & Non-Goals

### Goals
- Extract named persons from episode descriptions and feed-level metadata using spaCy
- Classify extracted names as host or guest using heuristic pattern matching
- Assign `SPEAKER_00` → host, `SPEAKER_01`+ → guests deterministically after diarization
- Pre-populate `speaker_names` table with inferred names and a confidence flag
- Surface inferred names in the UI as suggestions the user can confirm or override
- Run entirely on CPU with no additional network calls or paid services

### Non-Goals
- Voice fingerprinting or audio-based host identification
- Cross-episode speaker identity linking (each episode is independent in V1)
- Named entity disambiguation (if two people named "John" appear, this is out of scope)
- Handling feeds with no textual description at all — graceful no-op if no names found

---

## 3. User Stories

| ID | Story |
|----|-------|
| US-01 | As a user, when I open an episode's transcript page, speaker labels are pre-filled with inferred names (e.g. "Tim Ferriss", "Dr. Andrew Huberman") rather than "SPEAKER_00". |
| US-02 | As a user, I can see which speaker labels were inferred automatically vs. set by me, so I know what to verify. |
| US-03 | As a user, I can confirm, edit, or dismiss an inferred name with one click — the same rename flow I already use. |
| US-04 | As a user, if inference found nothing, the episode behaves exactly as before (SPEAKER_N labels, manual rename). |
| US-05 | As a user, the host is always SPEAKER_00 across all episodes of the same podcast, so the transcript layout is consistent. |

---

## 4. Functional Requirements

### 4.1 spaCy NER Extraction

- **Model:** `en_core_web_trf` (transformer-based, highest accuracy). Fall back to `en_core_web_lg` if the trf model is unavailable or memory-constrained.
- **Input sources** (in priority order, all parsed if available):
  1. Episode `description` field (episode-level show notes — most reliable)
  2. Feed `title` field (often contains host name: "The Tim Ferriss Show")
  3. Feed `description` field (show-level bio)
- **Target entity type:** `PERSON` labels from spaCy's NER output only. Discard all other entity types (ORG, GPE, etc.).
- **Output:** A list of candidate `{ name: str, source: str }` objects, deduplicated by normalized name (lowercased, whitespace-collapsed).

### 4.2 Host vs. Guest Classification

Apply heuristic rules to the candidate name list in order. The first rule that fires for a name determines its classification. Rules are applied per name against the text they were extracted from.

**Host signals** (classify as host if any match):
- Name appears in the feed title (e.g. "The Tim Ferriss Show" → "Tim Ferriss" is host)
- Name appears in the feed description with phrases: "hosted by", "host of", "your host", "I'm [name]"
- Name is the most frequent `PERSON` entity across the last 10 episodes of this feed (recurring presence = host)

**Guest signals** (classify as guest if any match):
- Name appears in episode description within a window of 10 tokens of: "guest", "join", "joining", "joined", "today's guest", "featuring", "feat.", "interview", "sit down with", "talk to", "talks to", "welcome", "welcomes", "with me today", "my guest", "special guest"
- Name appears in episode description after a colon in the episode title (e.g. "Ep. 42: Jane Smith on AI")

**Fallback / ambiguous cases:**
- If a name matches neither signal, it is added as a guest candidate with `confidence = LOW`.
- If only one name is found total, it is classified as guest with `confidence = LOW` (the host is presumably well-known and not mentioned in the episode description).
- If no names are found at all, inference produces an empty result — no `speaker_names` rows are written, episode proceeds as normal.

### 4.3 Confidence Levels

Every inferred name is tagged with a confidence level stored in the `speaker_names` table:

| Level | Meaning |
|-------|---------|
| `HIGH` | Host matched from feed title; or guest matched with strong proximity pattern ("my guest today is X") |
| `MEDIUM` | Host matched from feed description; or guest matched with weaker proximity pattern |
| `LOW` | Fallback classification; name found but no strong signal |

### 4.4 Speaker Slot Assignment

After diarization completes and speaker segments exist in the database, the inference service assigns speaker slots as follows:

1. Identify the host name (if any) from the inference result.
2. All speakers are assigned slots in order of their first appearance in the transcript: the first speaker to appear becomes `SPEAKER_00` (host), next becomes `SPEAKER_01`, etc.
3. Write inferred display names to the `speaker_names` table with `inferred = true` and the appropriate confidence level.
4. If no host name was inferred, `SPEAKER_00` is still assigned to the first speaker to appear, but no display name is written (user must rename manually as before).

**Rationale for first-appearance = host:** The first speaker in a podcast episode is overwhelmingly the host (introducing the show, welcoming the guest). This heuristic is simpler and more reliable than speaking-time, which can misfire when a guest dominates the conversation.

### 4.5 Re-ordering of pyannote Speaker Labels

pyannote outputs speaker labels in an arbitrary internal order. To enforce the invariant that `SPEAKER_00` = first speaker:

- After diarization, before writing segments to the database, the pipeline remaps pyannote's internal labels so that the first-appearing speaker is always written as `SPEAKER_00`.
- The remapping is a label swap only — no audio data is changed.
- If inference found no host, the remapping still applies (first-appearing speaker gets `SPEAKER_00`) for consistency.
- Tiebreaking: if two speakers first appear at the same timestamp, they are ordered alphabetically by their original pyannote label.

### 4.6 Pipeline Integration

Inference runs as a new pipeline stage **after** diarization and **before** archival:

```
DOWNLOADING → TRANSCRIBING → DIARIZING → INFERRING → ARCHIVING → DONE
```

- New job state: `INFERRING`
- If inference fails for any reason, it is a **non-blocking soft failure**: the episode continues to `ARCHIVING` and is marked `DONE`. A new field `inference_error` is populated with the failure reason. No retry.
- Inference is skipped (no-op, no error) if `has_diarization = false` on the episode.
- Inference adds no more than ~30 seconds to total processing time on CPU.

### 4.7 Flat .txt Transcript Output

The flat `.txt` file written after processing (per PRD-01 §5.7) uses inferred display names where available:

```
# PodSearch Transcript
# Episode: Ep. 712: Andrew Huberman on Sleep
# Host: Tim Ferriss (inferred)
# Guests: Andrew Huberman (inferred)

[00:01:23 - 00:01:45] Tim Ferriss: Welcome to the show...
[00:01:45 - 00:02:10] Andrew Huberman: Thanks for having me...
```

If inference found no names, the file uses `SPEAKER_00`, `SPEAKER_01` as before.

---

## 5. Data Model Changes

### 5.1 `speaker_names` table — new columns

```sql
ALTER TABLE speaker_names
  ADD COLUMN inferred      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN confidence    TEXT,    -- HIGH | MEDIUM | LOW | NULL (for manually set names)
  ADD COLUMN confirmed_by_user BOOLEAN NOT NULL DEFAULT false;
```

- `inferred = true` means the name was set by the inference service, not the user.
- `confirmed_by_user = true` means the user has explicitly confirmed or edited the name (regardless of origin).
- When a user edits an inferred name, set `confirmed_by_user = true` and `inferred = false`.

### 5.2 `episodes` table — new columns

```sql
ALTER TABLE episodes
  ADD COLUMN inference_skipped  BOOLEAN NOT NULL DEFAULT false,  -- true if no diarization
  ADD COLUMN inference_error    TEXT;                            -- populated on soft failure
```

### 5.3 New database index

```sql
CREATE INDEX speaker_names_inferred ON speaker_names(episode_id, inferred);
```

---

## 6. New Service: `apps/pipeline/app/services/inference.py`

This module is responsible for all host/guest inference logic.

```
inference.py
  ├── load_spacy_model() → nlp                     Load en_core_web_trf (or lg fallback)
  ├── extract_candidates(feed, episode) → list     NER extraction from all text sources
  ├── classify_candidates(candidates, feed, episode) → InferenceResult
  ├── assign_speaker_slots(result, segments) → label_map   Remap pyannote labels
  └── write_speaker_names(episode_id, label_map, result, db)
```

**`InferenceResult` dataclass:**
```python
@dataclass
class InferenceResult:
    host: Optional[CandidateName]         # None if no host found
    guests: list[CandidateName]           # Empty list if no guests found
    raw_candidates: list[CandidateName]   # All extracted names before classification

@dataclass
class CandidateName:
    name: str
    source: str          # "episode_description" | "feed_title" | "feed_description"
    role: str            # "host" | "guest"
    confidence: str      # "HIGH" | "MEDIUM" | "LOW"
```

---

## 7. Repository Changes

```
apps/pipeline/
  app/
    services/
      inference.py          ← NEW: NER extraction + host/guest classification
    tasks/
      ingest.py             ← MODIFIED: add INFERRING stage between DIARIZING and ARCHIVING
      diarize.py            ← MODIFIED: apply speaker slot remapping before writing segments
  tests/
    unit/
      test_inference.py     ← NEW: unit tests for extraction and classification logic
    fixtures/
      sample_descriptions/  ← NEW: fixture text files for unit tests
        solo_host.txt
        host_guest.txt
        multi_guest.txt
        no_names.txt
        feed_title_host.txt
```

**`pyproject.toml` additions:**
```toml
[tool.poetry.dependencies]
spacy = "^3.7"
en-core-web-trf = {url = "https://github.com/explosion/spacy-models/releases/download/en_core_web_trf-3.7.3/en_core_web_trf-3.7.3-py3-none-any.whl"}
# fallback — also install lg for low-memory environments:
en-core-web-lg = {url = "https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.7.1/en_core_web_lg-3.7.1-py3-none-any.whl"}
```

**Memory note:** `en_core_web_trf` uses ~500 MB RAM. It must be loaded and unloaded following the same explicit GC pattern as Whisper and pyannote (per PRD-01 §5.4). It must never be resident in memory simultaneously with either of those models.

---

## 8. UI Changes (PRD-02 additions)

### 8.1 Episode Transcript Page (`/episodes/[id]`)

- Inferred speaker labels are displayed with a **"✨ Inferred"** badge next to the name.
- The badge has a tooltip: *"This name was inferred from the episode description. Click the edit icon to confirm or change it."*
- Once the user clicks edit and saves (even without changing the name), `confirmed_by_user` is set to `true` and the badge is replaced with a checkmark **"✓ Confirmed"** badge.
- If `inference_error` is set on the episode, a subtle info note appears below the diarization status banner: *"Speaker name inference was unavailable for this episode."*

### 8.2 Search Results

- Search result cards show the inferred display name (same as manual names — no visual distinction needed in search results; inference badge is only on the episode page where the user manages labels).

### 8.3 Queue Dashboard

- The `INFERRING` stage is shown in the active job progress with label: *"Inferring speakers..."*
- No progress percentage needed (runs fast) — just a spinner for the stage.

---

## 9. Environment Variables

```env
# Optional — inference tuning
INFERENCE_ENABLED=true              # Set to false to disable inference entirely (default: true)
SPACY_MODEL=en_core_web_trf         # Override to en_core_web_lg on low-memory machines
```

---

## 10. Tech Stack Addition

| Component | Choice | Rationale |
|-----------|--------|-----------|
| NER | spaCy `en_core_web_trf` | Best accuracy for person name extraction; CPU-compatible; HuggingFace-native |
| Fallback NER | spaCy `en_core_web_lg` | Lower memory (~200 MB vs ~500 MB) for constrained machines |
| Classification | Heuristic rules (regex + token proximity) | Podcast description language is formulaic; rules outperform ML for this narrow task |

---

## 11. Testing Strategy

### Unit Tests (`pytest`)

All tests in `tests/unit/test_inference.py`. No live models needed — mock spaCy output.

| Test | Input | Expected output |
|------|-------|----------------|
| Host from feed title | "The Tim Ferriss Show" | `host = "Tim Ferriss", confidence = HIGH` |
| Guest from proximity | "my guest today is Dr. Jane Smith" | `guest = "Jane Smith", confidence = HIGH` |
| Guest from episode title colon | "Ep 5: Elon Musk on Mars" | `guest = "Elon Musk", confidence = HIGH` |
| Multi-guest | "featuring Alice Chen and Bob Kim" | `guests = ["Alice Chen", "Bob Kim"]` |
| No names found | "Today we discuss the economy" | `host = None, guests = []` |
| Recurring host detection | Name appears in 8 of 10 recent episodes | `host = that name, confidence = HIGH` |
| Slot assignment — first appearance | SPEAKER_01 appears first, SPEAKER_00 appears second | SPEAKER_01 remapped to SPEAKER_00 |
| Soft failure | spaCy raises exception | `inference_error` set, episode continues to DONE |
| Inference skipped | `has_diarization = false` | No `speaker_names` rows written, `inference_skipped = true` |

### Integration Tests

- Full pipeline run with fixture episode and feed that has a known description → assert `speaker_names` rows written with correct `inferred = true` and `confidence`
- Assert `SPEAKER_00` is always the first-appearing speaker after remapping

### What is NOT tested
- spaCy model accuracy (model quality is upstream)
- Correctness of inference on real-world podcast feeds (too variable)

---

## 12. Known Limitations & Risks

| # | Issue | Severity | Mitigation |
|---|-------|----------|------------|
| L-01 | Host inference fails for feeds where the host's name never appears in text (e.g. "Daily News Podcast") | Medium | Falls back gracefully; user renames manually as before |
| L-02 | Multi-host podcasts (two permanent hosts) — both would be classified as host, only one gets SPEAKER_00 | Medium | Accepted for V1. Most podcasts have one host. Document in README. |
| L-03 | Guest name in description but guest doesn't appear in audio (mentioned but not present) | Low | Inferred name written with LOW confidence; user can dismiss |
| L-04 | `en_core_web_trf` adds ~500 MB RAM to pipeline during INFERRING stage | Low | Explicit unload + GC enforced; fallback to `en_core_web_lg` via env var |
| L-05 | HTML in episode descriptions (links, formatting) may confuse NER | Low | Strip HTML tags before passing to spaCy using `BeautifulSoup` or `html.parser` |

---

## 13. Implementation Order

Build in this sequence due to hard dependencies:

1. **`inference.py` service** — core extraction and classification logic with unit tests
2. **`diarize.py` speaker slot remapping** — reorder pyannote labels by first appearance before DB write
3. **Pipeline stage integration** — add `INFERRING` state to `ingest.py` task flow
4. **Database migration** — add new columns to `speaker_names` and `episodes`
5. **UI: episode page badge** — inferred/confirmed badge on speaker labels
6. **UI: queue dashboard** — INFERRING stage in progress display
7. **Flat .txt output update** — write inferred names to transcript file header and segments

---

## Changelog

### v1.1 — 2026-03-18

- **Changed:** Speaker slot assignment now uses first appearance instead of most speaking time (§4.4, §4.5). The first speaker to appear becomes `SPEAKER_00` (host). Rationale: first speaker is a more reliable host signal than total speaking time.
