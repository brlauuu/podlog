"""
Unit tests for host/guest inference — PRD-04 §11

All tests mock spaCy NER output to avoid requiring a live model.
"""
from unittest.mock import MagicMock, patch

import pytest

from app.services.inference import (
    CandidateName,
    InferenceResult,
    assign_speaker_slots,
    classify_candidates,
    extract_candidates,
    extract_metadata_candidates,
    get_feed_speaker_cache_priors,
    get_recurring_host_name,
    merge_candidates,
    strip_html,
    write_speaker_names,
)
from app.services.inference_helpers import (
    name_after_colon_in_title,
    strip_episode_prefix,
)


# --- Helpers ---

def _make_spacy_ent(text: str, label: str) -> MagicMock:
    ent = MagicMock()
    ent.text = text
    ent.label_ = label
    return ent


def _make_nlp(entities: list[tuple[str, str]]):
    """Return a mock spaCy nlp callable that returns given entities for any input."""
    nlp = MagicMock()

    def process(text):
        doc = MagicMock()
        doc.ents = [_make_spacy_ent(name, label) for name, label in entities]
        return doc

    nlp.side_effect = process
    return nlp


# --- strip_html ---

class TestStripHtml:
    def test_removes_tags(self):
        assert strip_html("<p>Hello <b>world</b></p>") == "Hello world"

    def test_preserves_plain_text(self):
        assert strip_html("No tags here") == "No tags here"

    def test_handles_empty_string(self):
        assert strip_html("") == ""


# --- extract_candidates ---

class TestExtractCandidates:
    def test_extracts_person_entities(self):
        nlp = _make_nlp([("Jane Smith", "PERSON"), ("Stanford", "ORG")])
        result = extract_candidates(nlp, "My guest is Jane Smith from Stanford", None, None)
        assert len(result) == 1
        assert result[0].name == "Jane Smith"
        assert result[0].source == "episode_description"

    def test_deduplicates_by_normalized_name(self):
        nlp = _make_nlp([("Jane Smith", "PERSON")])
        result = extract_candidates(
            nlp, "Jane Smith is here", None, "Hosted by Jane Smith"
        )
        # Same name from two sources — should be deduplicated
        assert len(result) == 1

    def test_extracts_from_all_sources(self):
        # Each source returns a different person
        call_count = 0
        def nlp_side_effect(text):
            nonlocal call_count
            doc = MagicMock()
            names = [
                [("Alice", "PERSON")],   # episode_description
                [("Bob", "PERSON")],     # feed_title
                [("Charlie", "PERSON")], # feed_description
            ]
            doc.ents = [_make_spacy_ent(n, l) for n, l in names[call_count]]
            call_count += 1
            return doc

        nlp = MagicMock(side_effect=nlp_side_effect)
        result = extract_candidates(nlp, "ep desc", "feed title", "feed desc")
        assert len(result) == 3
        assert result[0].source == "episode_description"
        assert result[1].source == "feed_title"
        assert result[2].source == "feed_description"

    def test_skips_none_sources(self):
        nlp = _make_nlp([("Jane", "PERSON")])
        result = extract_candidates(nlp, None, None, None)
        assert len(result) == 0
        nlp.assert_not_called()

    def test_strips_html_before_ner(self):
        nlp = _make_nlp([("Jane Smith", "PERSON")])
        result = extract_candidates(nlp, "<p>Guest: <b>Jane Smith</b></p>", None, None)
        assert len(result) == 1
        # Verify nlp was called with stripped text
        nlp.assert_called_with("Guest: Jane Smith")

    # --- #703 PR 4: transcript intro as a fifth NER source ---

    def test_picks_up_name_only_in_transcript(self):
        """A guest whose name doesn't appear in description/title can
        still be extracted from the transcript intro."""
        # nlp is called once per non-empty source; for this test only
        # the transcript source has a hit.
        call_count = 0
        def nlp_side_effect(text):
            nonlocal call_count
            doc = MagicMock()
            if "joined by Dror Poleg" in text:
                doc.ents = [_make_spacy_ent("Dror Poleg", "PERSON")]
            else:
                doc.ents = []
            call_count += 1
            return doc
        nlp = MagicMock(side_effect=nlp_side_effect)

        segments = [
            {"text": "Welcome to another episode of the podcast.", "start_time": 0, "end_time": 5},
            {"text": "Today I'm joined by Dror Poleg to talk about AI.", "start_time": 5, "end_time": 12},
        ]

        result = extract_candidates(
            nlp,
            episode_description="A conversation about AI and the economy.",  # no name
            feed_title=None,
            feed_description=None,
            episode_segments=segments,
        )
        names = [c.name for c in result]
        sources = [c.source for c in result]
        assert "Dror Poleg" in names
        assert "transcript_intro" in sources

    def test_transcript_intro_deduped_with_description(self):
        """A name found in both episode_description and the transcript
        keeps only the description source (the first source wins)."""
        nlp = _make_nlp([("Dror Poleg", "PERSON")])

        segments = [
            {"text": "Today I'm joined by Dror Poleg.", "start_time": 0, "end_time": 5},
        ]

        result = extract_candidates(
            nlp,
            episode_description="Jacob sits down with Dror Poleg.",
            feed_title=None,
            feed_description=None,
            episode_segments=segments,
        )
        # The dedup is keyed on normalized name, so only one CandidateName
        # comes out — and it's the first one we saw (description).
        assert len(result) == 1
        assert result[0].source == "episode_description"

    def test_no_segments_means_no_transcript_source(self):
        """Passing no episode_segments leaves behavior identical to
        pre-PR-4 (the transcript source is empty so nlp isn't called
        for it)."""
        nlp = _make_nlp([("Jane Smith", "PERSON")])
        result = extract_candidates(
            nlp,
            "Today's guest is Jane Smith.",
            None,
            None,
            episode_segments=None,
        )
        assert len(result) == 1
        assert result[0].source == "episode_description"

    def test_transcript_text_capped_by_seconds(self):
        """The transcript text is capped at ~300 s of audio."""
        from app.services.inference_ner import _build_transcript_intro_text
        segments = [
            {"text": f"seg {i}", "start_time": i * 30, "end_time": (i + 1) * 30}
            for i in range(20)
        ]
        # 10 segments × 30s = 300s; cap fires at end_time >= 300
        text = _build_transcript_intro_text(segments, max_seconds=300, max_segments=1000)
        # After the cap kicks in (end_time >= 300 at segment 9), we stop.
        assert "seg 9" in text
        assert "seg 15" not in text

    def test_transcript_text_capped_by_segment_count(self):
        """The transcript text is capped at the segment-count limit."""
        from app.services.inference_ner import _build_transcript_intro_text
        segments = [
            {"text": f"seg {i}", "start_time": i, "end_time": i + 0.5}
            for i in range(200)
        ]
        text = _build_transcript_intro_text(segments, max_seconds=10_000, max_segments=50)
        assert "seg 49" in text
        assert "seg 50" not in text

    def test_transcript_text_skips_whitespace_only(self):
        from app.services.inference_ner import _build_transcript_intro_text
        segments = [
            {"text": "real content", "start_time": 0, "end_time": 1},
            {"text": "   ", "start_time": 1, "end_time": 2},
            {"text": "more content", "start_time": 2, "end_time": 3},
        ]
        text = _build_transcript_intro_text(segments)
        assert text == "real content more content"

    def test_transcript_text_empty_input_returns_empty_string(self):
        from app.services.inference_ner import _build_transcript_intro_text
        assert _build_transcript_intro_text(None) == ""
        assert _build_transcript_intro_text([]) == ""


# --- classify_candidates ---

class TestClassifyCandidates:
    def test_host_from_feed_title(self):
        """PRD-04 §4.2: name in feed title → host HIGH"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Jane Smith", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "my guest today is Dr. Jane Smith", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        assert result.host.confidence == "HIGH"

    def test_guest_from_proximity(self):
        """PRD-04 §4.2: name near guest signal → guest"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Jane Smith", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "my guest today is Dr. Jane Smith", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        jane = [g for g in result.guests if g.name == "Jane Smith"]
        assert len(jane) == 1
        assert jane[0].confidence == "HIGH"

    def test_host_from_feed_description(self):
        """PRD-04 §4.2: name near 'hosted by' in feed desc → host MEDIUM"""
        candidates = [
            CandidateName(name="Joe Rogan", source="feed_description"),
            CandidateName(name="Bob Lazar", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "We discuss aliens with Bob Lazar.", None, "Hosted by Joe Rogan"
        )
        assert result.host is not None
        assert result.host.name == "Joe Rogan"
        assert result.host.confidence == "MEDIUM"

    def test_guest_from_episode_title_colon(self):
        """PRD-04 §4.2: name after colon → guest HIGH"""
        candidates = [CandidateName(name="Elon Musk", source="episode_description")]
        result = classify_candidates(
            candidates, "Ep 42: Elon Musk on AI\nWe discuss the future.", None, None
        )
        assert len(result.guests) == 1
        assert result.guests[0].name == "Elon Musk"
        assert result.guests[0].confidence == "HIGH"

    def test_multi_guest(self):
        """PRD-04 §4.2: multiple guests extracted"""
        candidates = [
            CandidateName(name="Alice Chen", source="episode_description"),
            CandidateName(name="Bob Kim", source="episode_description"),
        ]
        result = classify_candidates(
            candidates,
            "This week featuring Alice Chen and Bob Kim from Google.",
            None,
            None,
        )
        assert result.host is None
        assert len(result.guests) == 2

    def test_no_names(self):
        """PRD-04 §4.2: no candidates → empty result"""
        result = classify_candidates([], "Today we discuss the economy", None, None)
        assert result.host is None
        assert result.guests == []

    def test_single_name_is_guest_low(self):
        """PRD-04 §4.2: single name that matches host signal → reclassified as guest LOW"""
        candidates = [CandidateName(name="Tim Ferriss", source="feed_title")]
        result = classify_candidates(
            candidates, "No guests this week", "The Tim Ferriss Show", None
        )
        # Single name found, so should be reclassified as guest LOW
        assert result.host is None
        assert len(result.guests) == 1
        assert result.guests[0].confidence == "LOW"

    def test_fallback_low_confidence(self):
        """PRD-04 §4.2: name with no signals → guest LOW"""
        candidates = [
            CandidateName(name="Tim Ferriss", source="feed_title"),
            CandidateName(name="Unknown Person", source="episode_description"),
        ]
        result = classify_candidates(
            candidates, "We discuss things with Unknown Person", "The Tim Ferriss Show", None
        )
        assert result.host is not None
        assert result.host.name == "Tim Ferriss"
        # Unknown Person has no guest signals → LOW
        unknown = [g for g in result.guests if g.name == "Unknown Person"]
        assert len(unknown) == 1
        assert unknown[0].confidence == "LOW"


# --- extract_metadata_candidates (PRD-04 B1 + B3) ---

class TestExtractMetadataCandidates:
    def test_author_is_host_high_owner_is_host_medium(self):
        """PRD-04 B1: <itunes:author> is the on-air author (HIGH).
        <itunes:owner> is the business contact — weaker (MEDIUM).
        """
        out = extract_metadata_candidates(
            itunes_author="Jane Author",
            itunes_owner_name="Olivia Owner",
            episode_author=None,
        )
        assert len(out) == 2
        # Author listed first (strongest person signal per Apple spec)
        assert out[0].name == "Jane Author"
        assert out[0].source == "itunes_author"
        assert out[0].role == "host"
        assert out[0].confidence == "HIGH"
        assert out[1].name == "Olivia Owner"
        assert out[1].source == "itunes_owner"
        assert out[1].role == "host"
        assert out[1].confidence == "MEDIUM"

    def test_episode_author_is_host_medium(self):
        out = extract_metadata_candidates(None, None, "Host McHostface")
        assert len(out) == 1
        assert out[0].source == "episode_author"
        assert out[0].role == "host"
        assert out[0].confidence == "MEDIUM"

    def test_dedupes_by_normalized_name(self):
        """Same name in author + owner → keep only the stronger (author)."""
        out = extract_metadata_candidates(
            itunes_author="jane smith",
            itunes_owner_name="Jane Smith",
            episode_author="JANE SMITH",
        )
        assert len(out) == 1
        assert out[0].source == "itunes_author"  # strongest wins

    def test_empty_inputs_return_empty_list(self):
        assert extract_metadata_candidates(None, None, None) == []
        assert extract_metadata_candidates("", "", "") == []

    def test_whitespace_only_inputs_are_dropped(self):
        assert extract_metadata_candidates("   ", "\t\n", "  ") == []

    def test_company_names_are_dropped(self):
        """PRD-04 B1: owner tags frequently hold ORG names — filter them out."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name="Vox Media Podcast Network",
            episode_author=None,
        )
        assert out == []

    def test_company_name_in_author_is_dropped(self):
        out = extract_metadata_candidates(
            itunes_author="ACME Podcasts LLC",
            itunes_owner_name=None,
            episode_author=None,
        )
        assert out == []

    def test_single_token_is_dropped(self):
        """Single-token strings are rarely on-air host names."""
        out = extract_metadata_candidates(
            itunes_author="Bob",
            itunes_owner_name=None,
            episode_author=None,
        )
        assert out == []

    def test_honorific_dedupes_with_bare_name(self):
        """PRD-04 B1: 'Dr. Jane Smith' and 'Jane Smith' are the same person."""
        out = extract_metadata_candidates(
            itunes_author="Dr. Jane Smith",
            itunes_owner_name="Jane Smith",
            episode_author=None,
        )
        assert len(out) == 1
        assert out[0].source == "itunes_author"

    def test_podcast_person_feed_host_and_guest(self):
        """PRD-04 B2: channel-level <podcast:person> feeds host/guest with HIGH confidence."""
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                {"name": "Tim Ferriss", "role": "host", "group": "cast"},
                {"name": "Jane Guest", "role": "guest", "group": "cast"},
            ],
        )
        assert len(out) == 2
        host = next(c for c in out if c.name == "Tim Ferriss")
        guest = next(c for c in out if c.name == "Jane Guest")
        assert host.role == "host"
        assert host.confidence == "HIGH"
        assert host.source == "podcast_person_feed"
        assert guest.role == "guest"
        assert guest.confidence == "HIGH"

    def test_podcast_person_episode_beats_channel(self):
        """Episode-level persons are listed first so they win name collisions."""
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                {"name": "Jane Smith", "role": "host"},
            ],
            episode_podcast_persons=[
                {"name": "Jane Smith", "role": "guest"},
            ],
        )
        assert len(out) == 1
        assert out[0].source == "podcast_person_episode"
        assert out[0].role == "guest"

    def test_podcast_person_ranks_above_itunes(self):
        """<podcast:person> is richer than itunes tags — should come first."""
        out = extract_metadata_candidates(
            itunes_author="Jane Author",
            itunes_owner_name=None,
            episode_author=None,
            feed_podcast_persons=[{"name": "Tim Ferriss", "role": "host"}],
        )
        assert out[0].name == "Tim Ferriss"
        assert out[0].source == "podcast_person_feed"
        assert out[1].name == "Jane Author"

    def test_podcast_person_unknown_role_dropped(self):
        """Production crew roles (editor, narrator, etc.) are not audio speakers."""
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                {"name": "Edith Editor", "role": "editor"},
                {"name": "Norma Narrator", "role": "narrator"},
                {"name": "Jane Smith", "role": "host"},
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Jane Smith"

    def test_podcast_person_cohost_maps_to_host(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[{"name": "Sarah Silverman", "role": "cohost"}],
        )
        assert len(out) == 1
        assert out[0].role == "host"
        assert out[0].confidence == "HIGH"

    def test_podcast_person_role_case_insensitive(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[{"name": "Jane Smith", "role": "HOST"}],
        )
        assert len(out) == 1
        assert out[0].role == "host"

    def test_podcast_person_interviewer_is_host(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[{"name": "Ira Glass", "role": "interviewer"}],
        )
        assert len(out) == 1
        assert out[0].role == "host"
        assert out[0].confidence == "HIGH"

    def test_podcast_person_subject_is_guest(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[{"name": "Jane Smith", "role": "subject"}],
        )
        assert len(out) == 1
        assert out[0].role == "guest"
        assert out[0].confidence == "HIGH"

    def test_podcast_person_empty_role_defaults_to_host(self):
        """Spec: empty/missing role attribute defaults to 'host'."""
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                {"name": "Jane Smith", "role": "   "},
                {"name": "Tim Ferriss"},  # role key missing
            ],
        )
        assert len(out) == 2
        assert all(c.role == "host" for c in out)

    def test_podcast_person_empty_name_dropped(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                {"name": "   ", "role": "host"},
                {"role": "host"},  # name key missing entirely
                {"name": "Bob", "role": "host"},  # single token → dropped
            ],
        )
        assert out == []

    def test_podcast_person_non_dict_entries_ignored(self):
        """Defensive: JSONB columns can contain arbitrary data."""
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[
                "not a dict",
                None,
                {"name": "Jane Smith", "role": "host"},
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Jane Smith"

    def test_podcast_person_org_name_dropped(self):
        out = extract_metadata_candidates(
            None, None, None,
            feed_podcast_persons=[{"name": "ACME Media LLC", "role": "host"}],
        )
        assert out == []

    def test_recurring_host_seeded_as_host_medium(self):
        """PRD-04 A1: recurring host observation seeds a host candidate at
        MEDIUM confidence so its speaker_names output cannot satisfy the
        HIGH filter inside get_recurring_host_name (no self-reinforcement)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            recurring_host_name="Tim Ferriss",
        )
        assert len(out) == 1
        assert out[0].name == "Tim Ferriss"
        assert out[0].source == "recurring_host"
        assert out[0].role == "host"
        assert out[0].confidence == "MEDIUM"

    def test_recurring_host_dedup_with_itunes_author(self):
        """Same person in both itunes:author and recurring — itunes wins (declared beats observed)."""
        out = extract_metadata_candidates(
            itunes_author="Jane Smith",
            itunes_owner_name=None,
            episode_author=None,
            recurring_host_name="jane smith",
        )
        assert len(out) == 1
        assert out[0].source == "itunes_author"

    def test_recurring_host_ordered_after_podcast_person(self):
        """podcast_person is publisher-declared and outranks recurring observation."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_podcast_persons=[{"name": "Publisher Host", "role": "host"}],
            recurring_host_name="Recurring Host",
        )
        assert [c.name for c in out] == ["Publisher Host", "Recurring Host"]

    def test_recurring_host_ordered_before_itunes_owner(self):
        """Recurring observation beats itunes:owner (which is usually a business contact)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name="Owner McOwner",
            episode_author=None,
            recurring_host_name="Recurring Host",
        )
        assert [c.source for c in out] == ["recurring_host", "itunes_owner"]

    def test_recurring_host_company_name_dropped(self):
        """Defensive: if somehow a company name is returned by the recurring-host
        query, it must not be seeded as a person candidate."""
        out = extract_metadata_candidates(
            None, None, None, recurring_host_name="ACME Podcasts LLC"
        )
        assert out == []

    def test_recurring_host_empty_is_noop(self):
        out = extract_metadata_candidates(None, None, None, recurring_host_name="")
        assert out == []
        out2 = extract_metadata_candidates(None, None, None, recurring_host_name="   ")
        assert out2 == []

    # --- feed_speaker_cache priors (PRD-04 C1/C2) ---

    def test_feed_speaker_cache_seeded_as_host_high(self):
        """User-confirmed cache entries are ground truth → HIGH host."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Jane Doe", "speaker_label": "SPEAKER_00", "occurrence_count": 5}
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Jane Doe"
        assert out[0].source == "feed_speaker_cache"
        assert out[0].role == "host"
        assert out[0].confidence == "HIGH"

    def test_feed_speaker_cache_ranked_before_podcast_person(self):
        """User confirmation trumps publisher-declared podcast:person."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_podcast_persons=[{"name": "Publisher Host", "role": "host"}],
            feed_speaker_cache_priors=[
                {"name": "User Confirmed", "speaker_label": "SPEAKER_00", "occurrence_count": 3}
            ],
        )
        assert [c.source for c in out] == ["feed_speaker_cache", "podcast_person_feed"]

    def test_feed_speaker_cache_dedup_with_podcast_person(self):
        """Same person in both sources — cache wins (listed first)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_podcast_persons=[{"name": "Jane Doe", "role": "host"}],
            feed_speaker_cache_priors=[
                {"name": "jane doe", "speaker_label": "SPEAKER_00", "occurrence_count": 4}
            ],
        )
        assert len(out) == 1
        assert out[0].source == "feed_speaker_cache"

    def test_feed_speaker_cache_multiple_entries_all_emitted_in_order(self):
        """Multiple SPEAKER_00 cache entries (recurring hosts on a cohost
        show, both correctly cached on the host slot) come through in
        provided order. The classifier will sort out which is host vs
        cohost. #703 PR 3: SPEAKER_NN entries are gated separately, so
        this test only covers the SPEAKER_00 case."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Primary Host", "speaker_label": "SPEAKER_00", "occurrence_count": 10},
                {"name": "Second Cohost", "speaker_label": "SPEAKER_00", "occurrence_count": 8},
            ],
        )
        assert [c.name for c in out] == ["Primary Host", "Second Cohost"]
        assert all(c.source == "feed_speaker_cache" for c in out)
        assert all(c.role == "host" for c in out)
        assert all(c.confidence == "HIGH" for c in out)

    def test_feed_speaker_cache_company_name_dropped(self):
        """Cache should never return ORG names, but defensive filter applies."""
        out = extract_metadata_candidates(
            None,
            None,
            None,
            feed_speaker_cache_priors=[
                {"name": "ACME Podcasts LLC", "speaker_label": "SPEAKER_00", "occurrence_count": 5}
            ],
        )
        assert out == []

    def test_feed_speaker_cache_empty_is_noop(self):
        assert extract_metadata_candidates(None, None, None, feed_speaker_cache_priors=[]) == []
        assert extract_metadata_candidates(None, None, None, feed_speaker_cache_priors=None) == []

    def test_feed_speaker_cache_whitespace_names_dropped(self):
        out = extract_metadata_candidates(
            None,
            None,
            None,
            feed_speaker_cache_priors=[
                {"name": "   ", "speaker_label": "SPEAKER_00", "occurrence_count": 3},
                {"name": "", "speaker_label": "SPEAKER_01", "occurrence_count": 3},
            ],
        )
        assert out == []

    def test_feed_speaker_cache_missing_name_key_skipped(self):
        """Malformed entries without 'name' key don't crash."""
        out = extract_metadata_candidates(
            None,
            None,
            None,
            feed_speaker_cache_priors=[
                {"speaker_label": "SPEAKER_00", "occurrence_count": 5},
                {"name": "Valid Host", "speaker_label": "SPEAKER_00", "occurrence_count": 3},
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Valid Host"

    # --- #703 PR 3: SPEAKER_NN cache entries gated on this-episode signal ---

    def test_speaker_nn_cache_skipped_when_no_episode_text(self):
        """Without episode_title or episode_description, SPEAKER_NN cache
        entries can't be corroborated and are dropped (#703 PR 3)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Recurring Guest", "speaker_label": "SPEAKER_01", "occurrence_count": 10},
            ],
        )
        assert out == []

    def test_speaker_nn_cache_emitted_when_mentioned_in_description(self):
        """SPEAKER_NN cache entry is seeded as guest, HIGH when this
        episode's description names them (#703 PR 3)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Dror Poleg", "speaker_label": "SPEAKER_01", "occurrence_count": 12},
            ],
            episode_description="<p>Jacob sits down with author and analyst Dror Poleg to explore AI.</p>",
        )
        assert len(out) == 1
        assert out[0].name == "Dror Poleg"
        assert out[0].source == "feed_speaker_cache"
        assert out[0].role == "guest"
        assert out[0].confidence == "HIGH"

    def test_speaker_nn_cache_emitted_when_mentioned_in_title(self):
        """Episode title alone is enough corroboration."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Marko Papic", "speaker_label": "SPEAKER_01", "occurrence_count": 12},
            ],
            episode_title="The geopolitical outlook with Marko Papic",
        )
        assert len(out) == 1
        assert out[0].name == "Marko Papic"
        assert out[0].role == "guest"

    def test_speaker_nn_cache_emitted_when_named_in_episode_podcast_persons(self):
        """podcast:person tags on the episode itself also corroborate."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Jane Doe", "speaker_label": "SPEAKER_01", "occurrence_count": 7},
            ],
            episode_podcast_persons=[{"name": "Jane Doe", "role": "guest"}],
        )
        # The cache entry is corroborated by the episode podcast_person
        # entry. (Jane Doe is also emitted directly via the podcast_person
        # pathway; dedup keeps only the cache row since it's listed first.)
        cache_rows = [c for c in out if c.source == "feed_speaker_cache"]
        assert len(cache_rows) == 1
        assert cache_rows[0].role == "guest"

    def test_speaker_nn_cache_substring_match_uses_normalized_name(self):
        """Honorifics in the cache name (e.g. 'Dr. Jane Smith') don't
        prevent corroboration when the episode text says 'Jane Smith'."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Dr. Jane Smith", "speaker_label": "SPEAKER_01", "occurrence_count": 5},
            ],
            episode_description="Today's guest is Jane Smith.",
        )
        assert len(out) == 1
        assert out[0].name == "Dr. Jane Smith"

    def test_speaker_nn_cache_unrelated_name_not_corroborated(self):
        """Cache entry for a person not mentioned anywhere stays dropped
        even when other names are in the episode text."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Rob Larity", "speaker_label": "SPEAKER_01", "occurrence_count": 123},
                {"name": "Dror Poleg", "speaker_label": "SPEAKER_01", "occurrence_count": 12},
            ],
            episode_description="<p>Jacob sits down with Dror Poleg.</p>",
        )
        names = [c.name for c in out]
        assert "Dror Poleg" in names
        assert "Rob Larity" not in names

    def test_speaker_00_cache_emitted_without_episode_text(self):
        """Recurring host (SPEAKER_00 cache) is unaffected by the new
        gate — it still seeds as host, HIGH regardless of episode text."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Jacob Shapiro", "speaker_label": "SPEAKER_00", "occurrence_count": 315},
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Jacob Shapiro"
        assert out[0].role == "host"
        assert out[0].confidence == "HIGH"


# --- get_recurring_host_name ---

def _make_recurring_db(
    episode_ids: list[str],
    speaker_rows: list,
):
    """Return a mock db where the first .query() yields episode IDs and the
    second yields (display_name, episode_id) tuples. SQLAlchemy's fluent
    chain (.filter / .order_by / .limit) collapses onto the same mock in
    each call.

    speaker_rows accepts either raw strings (auto-zipped with episode_ids in
    order) or explicit (name, episode_id) tuples for tests that care about
    which episode a given name came from.
    """
    db = MagicMock()

    ep_chain = MagicMock()
    ep_chain.filter.return_value = ep_chain
    ep_chain.order_by.return_value = ep_chain
    ep_chain.limit.return_value = ep_chain
    ep_chain.all.return_value = [(eid,) for eid in episode_ids]

    normalized_rows = []
    for i, row in enumerate(speaker_rows):
        if isinstance(row, tuple):
            normalized_rows.append(row)
        else:
            ep_id = episode_ids[i] if i < len(episode_ids) else f"ep-unknown-{i}"
            normalized_rows.append((row, ep_id))

    sn_chain = MagicMock()
    sn_chain.filter.return_value = sn_chain
    sn_chain.all.return_value = normalized_rows

    db.query.side_effect = [ep_chain, sn_chain]
    return db


class TestGetRecurringHostName:
    def test_fires_when_threshold_met(self):
        db = _make_recurring_db(
            episode_ids=[f"ep{i}" for i in range(10)],
            speaker_rows=["Tim Ferriss"] * 8,  # 8 of 10
        )
        assert get_recurring_host_name(db, "feed-1", "current-ep") == "Tim Ferriss"

    def test_does_not_fire_below_threshold(self):
        db = _make_recurring_db(
            episode_ids=[f"ep{i}" for i in range(10)],
            speaker_rows=["Tim Ferriss"] * 7,  # 7 of 10, below 0.8
        )
        assert get_recurring_host_name(db, "feed-1", "current-ep") is None

    def test_enforces_minimum_count_floor(self):
        """Tiny feed with 2 episodes both labeled same — still below min=3."""
        db = _make_recurring_db(
            episode_ids=["ep1", "ep2"],
            speaker_rows=["Tim Ferriss", "Tim Ferriss"],  # 2 of 2 = 100%, but < min
        )
        # With window=10 and threshold=0.8 the requirement is max(3, 8) = 8.
        # With only 2 matches, rule does not fire.
        assert get_recurring_host_name(db, "feed-1", "current-ep") is None

    def test_normalizes_case_and_whitespace(self):
        """Casing and whitespace variants all tally to one normalized bucket;
        returned display form is the most-recent episode's casing."""
        episode_ids = [f"ep{i}" for i in range(10)]  # ep0 is newest
        speaker_rows = [
            ("Tim Ferriss", "ep0"),
            ("tim ferriss", "ep1"),
            ("  Tim Ferriss  ", "ep2"),
            ("TIM FERRISS", "ep3"),
            ("Tim   Ferriss", "ep4"),
            ("Tim Ferriss", "ep5"),
            ("Tim Ferriss", "ep6"),
            ("Tim Ferriss", "ep7"),
        ]
        db = _make_recurring_db(episode_ids=episode_ids, speaker_rows=speaker_rows)
        assert get_recurring_host_name(db, "feed-1", "current-ep") == "Tim Ferriss"

    def test_no_feed_id_returns_none(self):
        db = MagicMock()
        assert get_recurring_host_name(db, "", "current-ep") is None
        db.query.assert_not_called()

    def test_no_recent_episodes_returns_none(self):
        db = _make_recurring_db(episode_ids=[], speaker_rows=[])
        assert get_recurring_host_name(db, "feed-1", "current-ep") is None

    def test_no_speaker_rows_returns_none(self):
        db = _make_recurring_db(
            episode_ids=[f"ep{i}" for i in range(10)],
            speaker_rows=[],
        )
        assert get_recurring_host_name(db, "feed-1", "current-ep") is None

    def test_empty_display_names_ignored(self):
        db = _make_recurring_db(
            episode_ids=[f"ep{i}" for i in range(10)],
            speaker_rows=["", "  ", None, "Tim Ferriss"] + ["Tim Ferriss"] * 7,
        )
        assert get_recurring_host_name(db, "feed-1", "current-ep") == "Tim Ferriss"

    def test_custom_threshold_and_window(self):
        db = _make_recurring_db(
            episode_ids=[f"ep{i}" for i in range(5)],
            speaker_rows=["Tim Ferriss"] * 4,
        )
        # window=5, threshold=0.8 → required=max(3, 4)=4. Met.
        assert (
            get_recurring_host_name(
                db, "feed-1", "current-ep", window=5, threshold=0.8
            )
            == "Tim Ferriss"
        )

    def test_tiny_window_silently_disabled_by_min_floor(self):
        """window=2, threshold=0.8 → required=max(3, 1)=3, but only 2 episodes
        exist. Rule must not fire — and must not raise."""
        db = _make_recurring_db(
            episode_ids=["ep1", "ep2"],
            speaker_rows=["Same", "Same"],
        )
        assert (
            get_recurring_host_name(
                db, "feed-1", "current-ep", window=2, threshold=0.8
            )
            is None
        )

    def test_mid_feed_host_swap_picks_most_recent_on_tie(self):
        """5 episodes Old Host then 5 episodes New Host. episode_ids come
        newest-first, so New Host rows appear first in rows_sorted. Counts
        tie at 5/5; the tiebreaker prefers the more-recent name."""
        episode_ids = [f"ep-new-{i}" for i in range(5)] + [f"ep-old-{i}" for i in range(5)]
        speaker_rows = (
            [("New Host", f"ep-new-{i}") for i in range(5)]
            + [("Old Host", f"ep-old-{i}") for i in range(5)]
        )
        db = _make_recurring_db(episode_ids=episode_ids, speaker_rows=speaker_rows)
        # window=10, threshold=0.5 → required=max(3, 5)=5. Both names hit 5.
        out = get_recurring_host_name(
            db, "feed-1", "current-ep", window=10, threshold=0.5
        )
        assert out == "New Host"

    def test_plurality_without_threshold_does_not_fire(self):
        """Two distinct names both under the threshold — rule must not fire
        even though one has a plurality."""
        episode_ids = [f"ep{i}" for i in range(10)]
        # 4 Host A, 3 Host B, 3 no-name.
        speaker_rows = ["Host A"] * 4 + ["Host B"] * 3 + ["", "", ""]
        db = _make_recurring_db(episode_ids=episode_ids, speaker_rows=speaker_rows)
        # window=10, threshold=0.8 → required=8. Top is 4.
        assert (
            get_recurring_host_name(db, "feed-1", "current-ep", threshold=0.8) is None
        )

    def test_most_recent_display_form_wins(self):
        """When the same person has multiple casings across episodes, the
        newest episode's casing is returned. Ordering comes from episode_ids
        (newest-first)."""
        episode_ids = [f"ep{i}" for i in range(10)]  # ep0 is newest
        # ep0 is newest — use "Tim Ferriss". Older episodes use lowercase.
        speaker_rows = [("Tim Ferriss", "ep0")] + [
            ("tim ferriss", f"ep{i}") for i in range(1, 8)
        ]
        db = _make_recurring_db(episode_ids=episode_ids, speaker_rows=speaker_rows)
        assert (
            get_recurring_host_name(db, "feed-1", "current-ep") == "Tim Ferriss"
        )


# --- get_feed_speaker_cache_priors (PRD-04 C1/C2) ---


def _make_cache_db(rows: list[tuple]):
    """Mock db where .query(...).filter(...).filter(...).order_by(...).all()
    returns the given rows. Each row is (display_name, speaker_label, count).
    """
    chain = MagicMock()
    chain.filter.return_value = chain
    chain.order_by.return_value = chain
    chain.all.return_value = rows

    db = MagicMock()
    db.query.return_value = chain
    return db


class TestGetFeedSpeakerCachePriors:
    def test_returns_empty_when_no_feed_id(self):
        db = MagicMock()
        assert get_feed_speaker_cache_priors(db, feed_id=None) == []
        assert get_feed_speaker_cache_priors(db, feed_id="") == []
        # No DB query issued when feed_id is falsy
        db.query.assert_not_called()

    def test_returns_empty_when_no_rows(self):
        db = _make_cache_db([])
        assert get_feed_speaker_cache_priors(db, feed_id="feed-1") == []

    def test_returns_rows_as_dicts_in_given_order(self):
        """DB-side ORDER BY produces strongest-first; function preserves that."""
        db = _make_cache_db(
            [
                ("Primary Host", "SPEAKER_00", 10),
                ("Cohost", "SPEAKER_01", 5),
            ]
        )
        out = get_feed_speaker_cache_priors(db, feed_id="feed-1")
        assert out == [
            {"name": "Primary Host", "speaker_label": "SPEAKER_00", "occurrence_count": 10},
            {"name": "Cohost", "speaker_label": "SPEAKER_01", "occurrence_count": 5},
        ]

    def test_min_count_filter_applied_via_query(self):
        """The min_count filter is applied in SQL via .filter() — verify the
        call chain composes it (presence of two filter calls beyond feed_id)."""
        db = _make_cache_db([("Host", "SPEAKER_00", 3)])
        out = get_feed_speaker_cache_priors(db, feed_id="feed-1", min_count=3)
        assert len(out) == 1
        # chain.filter should have been called for feed_id AND occurrence_count
        chain = db.query.return_value
        assert chain.filter.call_count >= 2

    def test_recency_days_adds_third_filter(self):
        """With recency_days>0, a last_seen_at cutoff filter is added."""
        db = _make_cache_db([("Host", "SPEAKER_00", 3)])
        out = get_feed_speaker_cache_priors(
            db, feed_id="feed-1", min_count=2, recency_days=30
        )
        assert len(out) == 1
        chain = db.query.return_value
        # feed_id + occurrence_count + last_seen_at
        assert chain.filter.call_count == 3

    def test_recency_days_zero_disables_cutoff(self):
        """recency_days=0 means no cutoff filter is applied."""
        db = _make_cache_db([("Host", "SPEAKER_00", 3)])
        out = get_feed_speaker_cache_priors(
            db, feed_id="feed-1", min_count=2, recency_days=0
        )
        assert len(out) == 1
        chain = db.query.return_value
        # feed_id + occurrence_count only — no recency filter
        assert chain.filter.call_count == 2


# --- merge_candidates ---

class TestMergeCandidates:
    def test_metadata_list_appears_first(self):
        metadata = [CandidateName(name="Host", source="itunes_author", role="host", confidence="HIGH")]
        ner = [CandidateName(name="Guest", source="episode_description")]
        merged = merge_candidates(metadata, ner)
        assert merged[0].name == "Host"
        assert merged[1].name == "Guest"

    def test_metadata_wins_on_name_collision(self):
        """NER entry with the same name is dropped — metadata carries better info."""
        metadata = [CandidateName(name="Jane Smith", source="itunes_author", role="host", confidence="HIGH")]
        ner = [CandidateName(name="Jane Smith", source="episode_description")]
        merged = merge_candidates(metadata, ner)
        assert len(merged) == 1
        assert merged[0].source == "itunes_author"

    def test_empty_lists(self):
        assert merge_candidates([], []) == []

    def test_promotes_medium_host_when_ner_dupe_in_feed_title(self):
        """Issue #530: metadata MEDIUM host promoted to HIGH when a dropped
        NER dup for the same name appears in feed_title (the canonical HIGH
        host signal). Blocks the confidence-oscillation cycle where a
        recurring_host MEDIUM row shadows a would-be HIGH feed_title match."""
        metadata = [
            CandidateName(
                name="Jane Smith", source="recurring_host", role="host", confidence="MEDIUM"
            )
        ]
        ner = [CandidateName(name="Jane Smith", source="feed_title")]
        merged = merge_candidates(metadata, ner, feed_title="The Jane Smith Show")
        assert len(merged) == 1
        assert merged[0].source == "recurring_host"
        assert merged[0].confidence == "HIGH"

    def test_no_promotion_when_name_absent_from_feed_title(self):
        """Roles agree but feed_title does not corroborate — confidence stays."""
        metadata = [
            CandidateName(
                name="Jane Smith", source="recurring_host", role="host", confidence="MEDIUM"
            )
        ]
        ner = [CandidateName(name="Jane Smith", source="episode_description")]
        merged = merge_candidates(metadata, ner, feed_title="Unrelated Show Name")
        assert merged[0].confidence == "MEDIUM"

    def test_no_promotion_without_feed_title_arg(self):
        """Default call (no feed_title) preserves prior dedup semantics."""
        metadata = [
            CandidateName(
                name="Jane Smith", source="recurring_host", role="host", confidence="MEDIUM"
            )
        ]
        ner = [CandidateName(name="Jane Smith", source="feed_title")]
        merged = merge_candidates(metadata, ner)
        assert merged[0].confidence == "MEDIUM"

    def test_no_promotion_for_guest_role_metadata(self):
        """feed_title match implies host; never promote a metadata guest
        candidate even if its name appears there."""
        metadata = [
            CandidateName(
                name="Jane Smith",
                source="podcast_person_episode",
                role="guest",
                confidence="MEDIUM",
            )
        ]
        ner = [CandidateName(name="Jane Smith", source="feed_title")]
        merged = merge_candidates(metadata, ner, feed_title="The Jane Smith Show")
        assert merged[0].role == "guest"
        assert merged[0].confidence == "MEDIUM"

    def test_promotion_matches_case_insensitively(self):
        """Feed title comparison is case-insensitive (classify_candidates
        lowercases f_title before the `in` check — keep parity here)."""
        metadata = [
            CandidateName(
                name="JANE SMITH", source="recurring_host", role="host", confidence="MEDIUM"
            )
        ]
        ner = [CandidateName(name="JANE SMITH", source="feed_title")]
        merged = merge_candidates(metadata, ner, feed_title="the jane smith show")
        assert merged[0].confidence == "HIGH"

    def test_already_high_metadata_unchanged(self):
        """Promotion is a no-op when the metadata entry is already HIGH —
        covers feed_speaker_cache and podcast:person (both HIGH host)."""
        metadata = [
            CandidateName(
                name="Jane Smith",
                source="feed_speaker_cache",
                role="host",
                confidence="HIGH",
            )
        ]
        ner = [CandidateName(name="Jane Smith", source="feed_title")]
        merged = merge_candidates(metadata, ner, feed_title="The Jane Smith Show")
        assert merged[0].confidence == "HIGH"
        assert merged[0].source == "feed_speaker_cache"


# --- strip_episode_prefix (PRD-04 E2) ---

class TestStripEpisodePrefix:
    def test_strips_ep_number_colon(self):
        assert strip_episode_prefix("Ep 42: Jane Smith on AI") == "Jane Smith on AI"

    def test_strips_episode_word(self):
        assert strip_episode_prefix("Episode 100: The Finale") == "The Finale"

    def test_strips_hash_number(self):
        assert strip_episode_prefix("#42 — Jane Smith") == "Jane Smith"

    def test_strips_bare_number_with_separator(self):
        assert strip_episode_prefix("42: Jane Smith") == "Jane Smith"

    def test_case_insensitive(self):
        assert strip_episode_prefix("EP 42: Jane") == "Jane"

    def test_em_dash_separator(self):
        assert strip_episode_prefix("Ep 42 — Jane Smith") == "Jane Smith"

    def test_does_not_strip_numbers_in_body(self):
        """'1984 Orwell revisited' — no separator, keep as-is."""
        assert strip_episode_prefix("1984 Orwell revisited") == "1984 Orwell revisited"

    def test_handles_empty_and_none(self):
        assert strip_episode_prefix("") == ""
        assert strip_episode_prefix(None) is None


# --- name_after_colon_in_title (PRD-04 E1) ---

class TestNameAfterColonInTitle:
    def test_matches_name_in_title_after_colon(self):
        assert name_after_colon_in_title("Jane Smith", "Ep 42: Jane Smith on AI")

    def test_matches_case_insensitive(self):
        assert name_after_colon_in_title("JANE SMITH", "Ep 42: jane smith")

    def test_no_colon_returns_false(self):
        assert not name_after_colon_in_title("Jane", "Jane Smith talks about AI")

    def test_only_first_line_checked(self):
        """Colon on line 2 must not match — first line only."""
        assert not name_after_colon_in_title("Jane Smith", "No colon here\nBio: Jane Smith")

    def test_empty_text_returns_false(self):
        assert not name_after_colon_in_title("Jane", "")


# --- extract_candidates with episode_title (PRD-04 E1/E2) ---

class TestExtractCandidatesWithTitle:
    def test_title_is_a_source(self):
        """episode_title should be a NER source after strip_episode_prefix."""
        call_count = 0

        def nlp_side_effect(text):
            nonlocal call_count
            doc = MagicMock()
            # episode_description, then episode_title, then feed_title, then feed_description
            names = [
                [],                          # episode_description
                [("Jane Smith", "PERSON")],  # episode_title (after prefix strip)
                [],                          # feed_title
                [],                          # feed_description
            ]
            doc.ents = [_make_spacy_ent(n, l) for n, l in names[call_count]]
            call_count += 1
            return doc

        nlp = MagicMock(side_effect=nlp_side_effect)
        result = extract_candidates(
            nlp,
            "description text",
            "feed title",
            "feed desc",
            episode_title="Ep 42: Jane Smith on AI",
        )
        assert len(result) == 1
        assert result[0].source == "episode_title"
        # The prefix was stripped before NER
        nlp.assert_any_call("Jane Smith on AI")


# --- classify_candidates: metadata short-circuit + title colon rule ---

class TestClassifyWithMetadata:
    def test_metadata_host_honored_without_heuristics(self):
        """itunes_author candidate → host HIGH, regardless of description text."""
        candidates = [
            CandidateName(name="Jane", source="itunes_author", role="host", confidence="HIGH"),
        ]
        result = classify_candidates(
            candidates,
            episode_description="No mention of Jane anywhere useful",
            feed_title="Random Show",
            feed_description="",
        )
        assert result.host is not None
        assert result.host.name == "Jane"
        assert result.host.source == "itunes_author"
        assert result.host.confidence == "HIGH"

    def test_metadata_single_name_not_demoted(self):
        """Single-name reclassification must NOT apply to metadata hosts (ground truth)."""
        candidates = [
            CandidateName(name="Jane", source="itunes_owner", role="host", confidence="HIGH"),
        ]
        result = classify_candidates(candidates, "no guests", "", "")
        # Normally a lone host gets demoted to guest LOW — but metadata is ground truth.
        assert result.host is not None
        assert result.guests == []

    def test_metadata_host_plus_ner_guest(self):
        candidates = [
            CandidateName(name="Host", source="itunes_author", role="host", confidence="HIGH"),
            CandidateName(name="Guest", source="episode_description"),
        ]
        result = classify_candidates(
            candidates,
            "My guest today is Guest",
            "",
            "",
        )
        assert result.host is not None and result.host.name == "Host"
        assert any(g.name == "Guest" for g in result.guests)

    def test_second_metadata_host_becomes_guest(self):
        """If two metadata entries both claim host, the second goes to guest LOW."""
        candidates = [
            CandidateName(name="First", source="itunes_author", role="host", confidence="HIGH"),
            CandidateName(name="Second", source="itunes_owner", role="host", confidence="MEDIUM"),
        ]
        result = classify_candidates(candidates, "", "", "")
        assert result.host is not None and result.host.name == "First"
        assert len(result.guests) == 1
        assert result.guests[0].name == "Second"
        assert result.guests[0].confidence == "LOW"

    def test_second_podcast_person_host_keeps_high_confidence(self):
        """Cohost shows: publisher declared two hosts — keep HIGH, not LOW.
        Different behavior from itunes_owner (which often is a company)."""
        candidates = [
            CandidateName(name="First Host", source="podcast_person_feed", role="host", confidence="HIGH"),
            CandidateName(name="Second Host", source="podcast_person_feed", role="host", confidence="HIGH"),
        ]
        result = classify_candidates(candidates, "", "", "")
        assert result.host is not None and result.host.name == "First Host"
        assert len(result.guests) == 1
        assert result.guests[0].name == "Second Host"
        assert result.guests[0].confidence == "HIGH"

    def test_podcast_person_guest_classified_directly(self):
        """role=guest candidates skip heuristics and land in guests with HIGH."""
        candidates = [
            CandidateName(name="Host", source="podcast_person_feed", role="host", confidence="HIGH"),
            CandidateName(name="Declared Guest", source="podcast_person_episode", role="guest", confidence="HIGH"),
        ]
        result = classify_candidates(candidates, "", "", "")
        assert result.host.name == "Host"
        assert len(result.guests) == 1
        assert result.guests[0].name == "Declared Guest"
        assert result.guests[0].confidence == "HIGH"

    def test_classify_is_idempotent_for_metadata(self):
        """Repeated calls on the same candidate list must produce the same result
        — classify_candidates must not mutate input CandidateName objects."""
        candidates = [
            CandidateName(name="First", source="itunes_author", role="host", confidence="HIGH"),
            CandidateName(name="Second", source="itunes_owner", role="host", confidence="MEDIUM"),
        ]
        first = classify_candidates(candidates, "", "", "")
        second = classify_candidates(candidates, "", "", "")
        assert first.host.name == second.host.name == "First"
        assert first.host.confidence == second.host.confidence == "HIGH"
        # Second candidate's original role/confidence untouched:
        assert candidates[1].role == "host"
        assert candidates[1].confidence == "MEDIUM"

    def test_episode_title_colon_rule(self):
        """E1: guest in episode title (not description) still tagged HIGH."""
        candidates = [CandidateName(name="Elon Musk", source="episode_title")]
        result = classify_candidates(
            candidates,
            episode_description="Body text with no guest cue",
            feed_title="",
            feed_description="",
            episode_title="Ep 42: Elon Musk on AI",
        )
        assert len(result.guests) == 1
        assert result.guests[0].name == "Elon Musk"
        assert result.guests[0].confidence == "HIGH"

    def test_recurring_host_honored_without_heuristics(self):
        """PRD-04 A1: recurring_host candidate → host MEDIUM regardless of text."""
        candidates = [
            CandidateName(
                name="Recurring Host",
                source="recurring_host",
                role="host",
                confidence="MEDIUM",
            )
        ]
        result = classify_candidates(
            candidates,
            episode_description="No mention of the host anywhere",
            feed_title="Unrelated Show",
            feed_description="",
        )
        assert result.host is not None and result.host.name == "Recurring Host"
        assert result.host.confidence == "MEDIUM"

    def test_recurring_host_as_second_metadata_keeps_own_confidence(self):
        """When recurring_host comes after another metadata host, the demoted
        secondary keeps its own MEDIUM confidence (not forced to HIGH or LOW).
        Parallel to podcast:person cohost handling."""
        candidates = [
            CandidateName(
                name="Primary", source="itunes_author", role="host", confidence="HIGH"
            ),
            CandidateName(
                name="Recurring", source="recurring_host", role="host", confidence="MEDIUM"
            ),
        ]
        result = classify_candidates(candidates, "", "", "")
        assert result.host is not None and result.host.name == "Primary"
        assert len(result.guests) == 1
        assert result.guests[0].name == "Recurring"
        assert result.guests[0].confidence == "MEDIUM"

    def test_recurring_host_lone_candidate_not_demoted(self):
        """Single recurring_host candidate — must not hit the single-name
        demotion rule (metadata sources are ground truth)."""
        candidates = [
            CandidateName(
                name="Recurring", source="recurring_host", role="host", confidence="MEDIUM"
            )
        ]
        result = classify_candidates(candidates, "some text", "", "")
        assert result.host is not None
        assert result.guests == []

    def test_feed_speaker_cache_honored_without_heuristics(self):
        """PRD-04 C1/C2: cache candidate → host HIGH regardless of text."""
        candidates = [
            CandidateName(
                name="Cached Host",
                source="feed_speaker_cache",
                role="host",
                confidence="HIGH",
            )
        ]
        result = classify_candidates(
            candidates,
            episode_description="Text never mentions the host",
            feed_title="",
            feed_description="",
        )
        assert result.host is not None and result.host.name == "Cached Host"
        assert result.host.confidence == "HIGH"

    def test_feed_speaker_cache_as_second_metadata_keeps_own_confidence(self):
        """When cache follows another metadata host, the demoted cohost keeps
        HIGH (cache is ground truth; paralleling podcast:person cohost)."""
        candidates = [
            CandidateName(
                name="Publisher Host",
                source="podcast_person_feed",
                role="host",
                confidence="HIGH",
            ),
            CandidateName(
                name="Cached Cohost",
                source="feed_speaker_cache",
                role="host",
                confidence="HIGH",
            ),
        ]
        result = classify_candidates(candidates, "", "", "")
        assert result.host is not None and result.host.name == "Publisher Host"
        assert len(result.guests) == 1
        assert result.guests[0].name == "Cached Cohost"
        assert result.guests[0].confidence == "HIGH"


# --- assign_speaker_slots ---


def _seg(label, start, end):
    return {"speaker_label": label, "start_time": start, "end_time": end}


class TestAssignSpeakerSlots:
    """Slot assignment now folds in the run-based short-speaker
    detection (#703 PR 2). Real labels (those with at least one run
    that satisfies ``run_seconds >= 15 OR run_segments >= 20``) keep
    all their segments together; fully-short labels fragment into
    one new slot per run, each marked as 'other'.
    """

    def test_first_appearance_gets_speaker_00_when_both_real(self):
        """Two long single-segment speakers — both real (each >15s);
        the first to appear takes SPEAKER_00."""
        segments = [
            _seg("SPEAKER_X", 0, 60),    # 60s, real
            _seg("SPEAKER_Y", 60, 100),  # 40s, real
        ]
        a = assign_speaker_slots(None, segments)
        assert a.new_labels == ["SPEAKER_00", "SPEAKER_01"]
        assert a.other_labels == set()
        assert a.label_remap == {"SPEAKER_X": "SPEAKER_00", "SPEAKER_Y": "SPEAKER_01"}

    def test_short_first_speaker_falls_through_to_other(self):
        """Cold-open / skit voice (a single 4s run, fails both
        thresholds) is fragmented as 'other'; the real speakers fill
        SPEAKER_00/01 in their relative appearance order."""
        segments = [
            _seg("SPEAKER_X", 0.5, 4.5),    # 4s, fully-short
            _seg("SPEAKER_Y", 9, 50),       # 41s, real
            _seg("SPEAKER_Z", 50, 200),     # 150s, real
        ]
        a = assign_speaker_slots(None, segments)
        # Real labels SPEAKER_Y and SPEAKER_Z fill the first two slots
        # by appearance order; fully-short SPEAKER_X gets SPEAKER_02.
        assert a.new_labels[1] == "SPEAKER_00"  # SPEAKER_Y → 00
        assert a.new_labels[2] == "SPEAKER_01"  # SPEAKER_Z → 01
        assert a.new_labels[0] == "SPEAKER_02"  # SPEAKER_X (cold open) → 02
        assert a.other_labels == {"SPEAKER_02"}
        assert a.label_remap == {"SPEAKER_Y": "SPEAKER_00", "SPEAKER_Z": "SPEAKER_01"}

    def test_each_short_run_becomes_its_own_other(self):
        """A fully-short pyannote label split across multiple runs
        produces one new SPEAKER_NN per run — so the user can merge
        each one to whichever real speaker it actually belongs to."""
        segments = [
            _seg("SPEAKER_X", 0, 4),        # run 1 of X (4s, short)
            _seg("SPEAKER_Y", 10, 60),      # 50s, real
            _seg("SPEAKER_X", 60, 60.5),    # run 2 of X (0.5s, short)
            _seg("SPEAKER_X", 65, 66),      # run 3 of X (1s, short — broken by 5s gap)
        ]
        a = assign_speaker_slots(None, segments)
        # SPEAKER_Y is the only real label, gets SPEAKER_00.
        assert a.new_labels[1] == "SPEAKER_00"
        # SPEAKER_X has three runs → SPEAKER_01, SPEAKER_02, SPEAKER_03 in run order.
        assert a.new_labels[0] == "SPEAKER_01"
        assert a.new_labels[2] == "SPEAKER_02"
        assert a.new_labels[3] == "SPEAKER_03"
        assert a.other_labels == {"SPEAKER_01", "SPEAKER_02", "SPEAKER_03"}

    def test_real_label_keeps_short_interjections_together(self):
        """Option B: a pyannote label with at least one real run keeps
        all its segments — even brief interjections — together when
        the interjection sits within the isolation-gap window of the
        rest of the label's runs."""
        segments = [
            _seg("SPEAKER_X", 0, 50),       # X: 50s real monologue
            _seg("SPEAKER_Y", 50, 100),     # Y: 50s real monologue
            _seg("SPEAKER_X", 105, 105.5),  # X says "yeah" 55s after run 1 ends
            _seg("SPEAKER_Y", 106, 150),    # Y continues
        ]
        a = assign_speaker_slots(None, segments)
        # SPEAKER_X is real (50s run), short interjection is within the
        # default 60s isolation window → stays with X.
        assert a.new_labels[0] == "SPEAKER_00"
        assert a.new_labels[2] == "SPEAKER_00"  # short "yeah" stays with X
        assert a.new_labels[1] == "SPEAKER_01"
        assert a.new_labels[3] == "SPEAKER_01"
        assert a.other_labels == set()

    def test_isolated_short_run_of_real_label_splits_off_as_other(self):
        """Option C (#703 follow-up): a short run inside an otherwise-
        real pyannote label is split off as Other when its nearest
        same-label neighbour is more than isolation_gap_seconds away.
        Targets the cold-open-mis-clustered case."""
        segments = [
            # SPEAKER_X has a 4s cold open at 0, then doesn't reappear
            # until 200s — pyannote conflated two voices into one
            # label.
            _seg("SPEAKER_X", 0, 4),         # cold open (4s, short run)
            _seg("SPEAKER_Y", 10, 80),       # Y monologue (real)
            _seg("SPEAKER_Y", 81, 199),      # Y continues
            _seg("SPEAKER_X", 200, 280),     # X's real content (80s, real)
            _seg("SPEAKER_X", 281, 360),     # X continues
        ]
        a = assign_speaker_slots(None, segments)
        # X is "real" (has the 200-280 run), Y is real. Real-label
        # assignment by first appearance: Y first (10s) → SPEAKER_00 (no,
        # wait — X appears first at t=0, so X → SPEAKER_00 if it's real).
        # X *is* real because of the 80s run at 200-280. So:
        #   X → SPEAKER_00, Y → SPEAKER_01.
        # But the cold-open at 0-4 is isolated from X's next run by
        # 196s (>60s) → split off as Other.
        assert a.new_labels[0] != a.new_labels[3]  # cold-open ≠ X's real run
        assert a.new_labels[0] in a.other_labels
        assert a.new_labels[3] == "SPEAKER_00"  # X's real run keeps the slot
        assert a.new_labels[4] == "SPEAKER_00"
        # Y is unaffected.
        assert a.new_labels[1] == "SPEAKER_01"
        assert a.new_labels[2] == "SPEAKER_01"

    def test_isolation_threshold_is_configurable(self):
        """Bumping isolation_gap_seconds preserves short runs that
        would otherwise split off."""
        # 113s gap between SPEAKER_X's two runs.
        segments = [
            _seg("SPEAKER_X", 0, 4),         # short run
            _seg("SPEAKER_Y", 10, 100),      # Y real
            _seg("SPEAKER_X", 117, 200),     # X real run (83s away)
        ]
        # Default 60s isolation: split.
        a_default = assign_speaker_slots(None, segments)
        assert a_default.new_labels[0] in a_default.other_labels

        # Relaxed 200s isolation: keep together.
        a_relaxed = assign_speaker_slots(
            None, segments, isolation_gap_seconds=200.0
        )
        assert a_relaxed.other_labels == set()
        assert a_relaxed.new_labels[0] == a_relaxed.new_labels[2]

    def test_real_label_with_mixed_short_runs_splits_only_isolated_ones(self):
        """A real label can have both isolated short runs (split off as
        Other) and adjacent short interjections (stay glued) — they're
        evaluated independently."""
        segments = [
            _seg("SPEAKER_X", 0, 4),         # cold-open: 4s short, isolated from rest
            _seg("SPEAKER_Y", 10, 80),       # Y monologue (real, 70s)
            _seg("SPEAKER_X", 200, 280),     # X real (80s)
            _seg("SPEAKER_Y", 280, 281),     # Y "yeah" (1s, 200s after Y's first run)
            _seg("SPEAKER_Y", 282, 360),     # Y resumes (real, 78s)
            _seg("SPEAKER_X", 365, 365.5),   # X says "right" 85s after X's real run
        ]
        a = assign_speaker_slots(None, segments)
        # Real labels (X has the 200-280 run, Y has 10-80 and 282-360) get
        # the first two SPEAKER_NN slots by first-appearance time:
        #   X first appears at 0s, Y at 10s → X=SPEAKER_00, Y=SPEAKER_01.
        # Y's "yeah" at 280-281 is 200s after Y's run ended at 80s, BUT
        # 1s before Y's next run starts at 282s. min_gap = 1s < 60s → stay
        # with Y.
        assert a.new_labels[3] == "SPEAKER_01"
        # X's cold-open at 0-4 has nearest same-label neighbour 196s away
        # → split off as Other.
        assert a.new_labels[0] in a.other_labels
        # X's "right" at 365-365.5 is 85s after X's real run ended at 280s
        # AND no later X runs → only prev_gap counts, 85s > 60s → split.
        assert a.new_labels[5] in a.other_labels
        # The two split-off slots are distinct.
        assert a.new_labels[0] != a.new_labels[5]
        # The real-label slots are unchanged.
        assert a.new_labels[1] == "SPEAKER_01"
        assert a.new_labels[2] == "SPEAKER_00"
        assert a.new_labels[4] == "SPEAKER_01"

    def test_short_run_at_label_boundary_uses_only_existing_neighbour(self):
        """A short run that's the first run of its label (no
        previous-same-label run) only has to clear the gap to the
        next same-label run, not the missing previous one."""
        segments = [
            # X cold open at 0, X's next run is 10s later (well within
            # the 60s isolation window).
            _seg("SPEAKER_X", 0, 4),         # short run, no prev neighbour
            _seg("SPEAKER_X", 14, 80),       # X's real run, 10s gap
            _seg("SPEAKER_Y", 80, 130),
        ]
        a = assign_speaker_slots(None, segments)
        # Cold open's nearest neighbour is X's run at 14s (10s gap)
        # — under threshold, stay glued to X.
        assert a.other_labels == set()
        assert a.new_labels[0] == a.new_labels[1] == "SPEAKER_00"

    def test_run_extends_across_small_gap(self):
        """Two segments by the same speaker separated by < 2s are one run."""
        segments = [
            _seg("SPEAKER_X", 0, 7),     # 7s
            _seg("SPEAKER_X", 8, 14),    # 6s, gap=1s — same run, total 13s
            _seg("SPEAKER_X", 14.5, 16), # 1.5s, gap=0.5s — same run, total 14.5s
        ]
        # All three segments belong to one run; 14.5s + 3 segments — fails
        # both thresholds (< 15s AND < 20 segs) so SPEAKER_X is fully-short.
        a = assign_speaker_slots(None, segments)
        assert a.other_labels == {"SPEAKER_00"}
        assert a.new_labels == ["SPEAKER_00", "SPEAKER_00", "SPEAKER_00"]

    def test_run_breaks_on_large_gap(self):
        """A > 2s gap of silence breaks the run, even with no other speaker."""
        segments = [
            _seg("SPEAKER_X", 0, 5),      # run 1 (5s)
            _seg("SPEAKER_X", 30, 35),    # run 2 (5s) — 25s gap, breaks run
        ]
        a = assign_speaker_slots(None, segments)
        # Two short runs of the same label → two Other slots.
        assert a.other_labels == {"SPEAKER_00", "SPEAKER_01"}
        assert a.new_labels[0] == "SPEAKER_00"
        assert a.new_labels[1] == "SPEAKER_01"

    def test_segment_count_threshold_alone_makes_real(self):
        """A label with 20+ short segments still counts as real even
        when total seconds are below the seconds threshold."""
        segments = [
            _seg("SPEAKER_X", i * 1.5, i * 1.5 + 0.5) for i in range(20)
        ]
        # 20 segments × 0.5s = 10s total. Fails seconds (10<15) but
        # passes segments (>=20) → real.
        a = assign_speaker_slots(None, segments)
        assert a.other_labels == set()
        assert all(label == "SPEAKER_00" for label in a.new_labels)

    def test_empty_segments(self):
        a = assign_speaker_slots(None, [])
        assert a.new_labels == []
        assert a.other_labels == set()
        assert a.label_remap == {}

    def test_no_speaker_labels(self):
        segments = [_seg(None, 0, 10)]
        a = assign_speaker_slots(None, segments)
        assert a.new_labels == [None]
        assert a.other_labels == set()


# --- write_speaker_names ---


def _mock_db_with_segments(existing_labels: list[str], existing_speaker_name=None) -> MagicMock:
    """Build a MagicMock db that returns `existing_labels` for the
    segments-query in write_speaker_names and `existing_speaker_name`
    (which may be None) for the speaker_names lookups.

    The two queries are dispatched off the SQLAlchemy model class passed
    to `db.query(...)` — Segment for the bound-labels query, SpeakerName
    for the per-slot upsert lookup.
    """
    from app.models import Segment, SpeakerName

    db = MagicMock()

    segments_q = MagicMock()
    segments_q.filter.return_value.filter.return_value.distinct.return_value.all.return_value = [
        (label,) for label in existing_labels
    ]

    speaker_names_q = MagicMock()
    speaker_names_q.filter.return_value.first.return_value = existing_speaker_name

    def _route_query(model):
        if model is SpeakerName:
            return speaker_names_q
        # Otherwise treat as the segments scalar select (Segment.speaker_label).
        return segments_q

    db.query.side_effect = _route_query
    return db


class TestWriteSpeakerNames:
    def test_writes_inferred_host_and_guest(self):
        # Both SPEAKER_00 and SPEAKER_01 exist in the episode's segments.
        db = _mock_db_with_segments(["SPEAKER_00", "SPEAKER_01"])

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        guest = CandidateName(name="Jane Smith", source="episode_description", role="guest", confidence="MEDIUM")
        result = InferenceResult(host=host, guests=[guest])
        label_map = {"SPEAKER_01": "SPEAKER_00", "SPEAKER_00": "SPEAKER_01"}

        write_speaker_names("ep-1", label_map, result, db)

        # Should have added 2 SpeakerName objects
        assert db.add.call_count == 2

    def test_does_not_overwrite_user_confirmed(self):
        """PRD-04 §5.1: don't overwrite confirmed_by_user = true"""
        existing = MagicMock()
        existing.confirmed_by_user = True

        db = _mock_db_with_segments(["SPEAKER_00"], existing_speaker_name=existing)

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        result = InferenceResult(host=host, guests=[])
        label_map = {"SPEAKER_00": "SPEAKER_00"}

        write_speaker_names("ep-1", label_map, result, db)

        # Should NOT have been modified
        assert db.add.call_count == 0
        assert existing.display_name != "Tim Ferriss"  # unchanged (still mock default)

    def test_skips_slots_with_no_segments(self):
        """#703: the classifier can produce far more guest candidates than
        the episode has real speakers. write_speaker_names must not write
        phantom rows for SPEAKER_NN slots that no segment carries."""
        # Episode has only two actual speakers; classifier produced four
        # guest candidates so it tried to fill SPEAKER_01..SPEAKER_04.
        db = _mock_db_with_segments(["SPEAKER_00", "SPEAKER_01"])

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        guests = [
            CandidateName(name="Jane Smith", source="ner", role="guest", confidence="HIGH"),
            CandidateName(name="Carlos Garcia", source="feed_speaker_cache", role="guest", confidence="HIGH"),
            CandidateName(name="Marie Curie", source="feed_speaker_cache", role="guest", confidence="HIGH"),
            CandidateName(name="Ada Lovelace", source="feed_speaker_cache", role="guest", confidence="HIGH"),
        ]
        result = InferenceResult(host=host, guests=guests)
        label_map = {}

        write_speaker_names("ep-1", label_map, result, db)

        # Only SPEAKER_00 (host) and SPEAKER_01 (first guest) should be
        # written; SPEAKER_02..04 had no segments so they're skipped.
        assert db.add.call_count == 2

    def test_skips_host_slot_when_no_segments_match(self):
        """If even SPEAKER_00 has no segments — e.g., diarization failed
        and the table is empty — the host row is also skipped."""
        db = _mock_db_with_segments([])

        host = CandidateName(name="Solo Speaker", source="feed_title", role="host", confidence="HIGH")
        result = InferenceResult(host=host, guests=[])
        label_map = {}

        write_speaker_names("ep-1", label_map, result, db)

        assert db.add.call_count == 0


# --- Soft failure in task ---

class TestInferSpeakersTask:
    def test_soft_failure_sets_inference_error(self):
        """PRD-04 §4.6: inference failure is non-blocking"""
        db = MagicMock()

        episode = MagicMock()
        episode.id = "ep-1"
        episode.has_diarization = True
        episode.feed_id = None  # skip feed lookup
        episode.description = "some text"
        episode.title = None
        episode.episode_author = None
        db.query.return_value.filter.return_value.first.return_value = episode

        with (
            patch("app.tasks.infer.SessionLocal", return_value=db),
            patch("app.services.inference.load_spacy_model", side_effect=RuntimeError("No model")),
            patch("app.tasks.infer.job_queue") as mock_jq,
        ):
            from app.tasks.infer import infer_speakers
            infer_speakers("ep-1")

        # update_episode uses setattr on the episode object
        assert episode.inference_error == "No model"

    def test_skipped_when_no_diarization(self):
        """PRD-04 §4.6: skip inference if has_diarization=false"""
        db = MagicMock()

        episode = MagicMock()
        episode.id = "ep-1"
        episode.has_diarization = False
        db.query.return_value.filter.return_value.first.return_value = episode

        with (
            patch("app.tasks.infer.SessionLocal", return_value=db),
            patch("app.tasks.infer.job_queue") as mock_jq,
        ):
            from app.tasks.infer import infer_speakers
            infer_speakers("ep-1")

        # update_episode uses setattr on the episode object
        assert episode.inference_skipped is True
