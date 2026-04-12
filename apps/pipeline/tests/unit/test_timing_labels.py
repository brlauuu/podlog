from app.services.timing_labels import humanize_timing_key


def test_humanize_alignment_io_key():
    assert humanize_timing_key("alignment_io_secs") == "Alignment I/O"


def test_humanize_provider_diarization_key():
    assert humanize_timing_key("provider_diarization_secs") == "Provider diarization"


def test_humanize_speaker_assignment_key():
    assert humanize_timing_key("speaker_assignment_secs") == "Speaker assignment"


def test_humanize_empty_key_returns_input():
    assert humanize_timing_key("") == ""
