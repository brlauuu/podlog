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
        """Multiple cache entries come through in provided order (sorted by count DESC upstream)."""
        out = extract_metadata_candidates(
            itunes_author=None,
            itunes_owner_name=None,
            episode_author=None,
            feed_speaker_cache_priors=[
                {"name": "Primary Host", "speaker_label": "SPEAKER_00", "occurrence_count": 10},
                {"name": "Second Host", "speaker_label": "SPEAKER_01", "occurrence_count": 8},
            ],
        )
        assert [c.name for c in out] == ["Primary Host", "Second Host"]
        assert all(c.source == "feed_speaker_cache" for c in out)
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
                {"name": "Valid Host", "speaker_label": "SPEAKER_01", "occurrence_count": 3},
            ],
        )
        assert len(out) == 1
        assert out[0].name == "Valid Host"


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

class TestAssignSpeakerSlots:
    def test_first_appearance_gets_speaker_00(self):
        """PRD-04 §4.5: first speaker to appear → SPEAKER_00"""
        segments = [
            {"speaker_label": "SPEAKER_01", "start_time": 0, "end_time": 60},   # appears first
            {"speaker_label": "SPEAKER_00", "start_time": 60, "end_time": 100},  # appears second
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map["SPEAKER_01"] == "SPEAKER_00"  # first to appear
        assert label_map["SPEAKER_00"] == "SPEAKER_01"

    def test_all_speakers_ordered_by_first_appearance(self):
        """PRD-04 §4.4: all speakers ordered by first appearance"""
        segments = [
            {"speaker_label": "SPEAKER_02", "start_time": 0, "end_time": 10},    # appears first
            {"speaker_label": "SPEAKER_00", "start_time": 10, "end_time": 100},   # appears second
            {"speaker_label": "SPEAKER_01", "start_time": 100, "end_time": 110},  # appears third
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map["SPEAKER_02"] == "SPEAKER_00"  # first to appear → SPEAKER_00
        assert label_map["SPEAKER_00"] == "SPEAKER_01"  # second to appear
        assert label_map["SPEAKER_01"] == "SPEAKER_02"  # third to appear

    def test_empty_segments(self):
        result = InferenceResult()
        assert assign_speaker_slots(result, []) == {}

    def test_no_speaker_labels(self):
        segments = [
            {"speaker_label": None, "start_time": 0, "end_time": 10},
        ]
        result = InferenceResult()
        assert assign_speaker_slots(result, segments) == {}

    def test_single_speaker(self):
        segments = [
            {"speaker_label": "SPEAKER_00", "start_time": 0, "end_time": 100},
        ]
        result = InferenceResult()
        label_map = assign_speaker_slots(result, segments)
        assert label_map == {"SPEAKER_00": "SPEAKER_00"}


# --- write_speaker_names ---

class TestWriteSpeakerNames:
    def test_writes_inferred_host_and_guest(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None

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

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = existing

        host = CandidateName(name="Tim Ferriss", source="feed_title", role="host", confidence="HIGH")
        result = InferenceResult(host=host, guests=[])
        label_map = {"SPEAKER_00": "SPEAKER_00"}

        write_speaker_names("ep-1", label_map, result, db)

        # Should NOT have been modified
        assert db.add.call_count == 0
        assert existing.display_name != "Tim Ferriss"  # unchanged (still mock default)


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
