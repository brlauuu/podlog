"""Unit tests for app.services.pyannote_cloud — precision-2 REST client."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import pyannote_cloud as cloud
from app.services.pyannote_cloud import (
    PyannoteCloudError,
    _classify_http_error,
    _compute_cost,
    _extract_segments,
    _normalize_speaker,
    diarize_via_cloud,
    poll_job,
    submit_diarization,
    verify_api_key,
    upload_audio,
)


class TestClassifyHttpError:
    def test_429_is_transient(self):
        err_class, retryable = _classify_http_error(429)
        assert err_class == "TRANSIENT_NETWORK"
        assert retryable is True

    def test_5xx_is_transient(self):
        assert _classify_http_error(503) == ("TRANSIENT_NETWORK", True)
        assert _classify_http_error(500) == ("TRANSIENT_NETWORK", True)

    def test_4xx_is_http_access(self):
        assert _classify_http_error(401) == ("HTTP_ACCESS", True)
        assert _classify_http_error(404) == ("HTTP_ACCESS", True)


class TestNormalizeSpeaker:
    def test_keeps_speaker_prefix(self):
        assert _normalize_speaker("SPEAKER_00") == "SPEAKER_00"

    def test_pads_bare_digit(self):
        assert _normalize_speaker("3") == "SPEAKER_03"

    def test_fuses_speaker_digits(self):
        assert _normalize_speaker("SPEAKER1") == "SPEAKER_01"

    def test_hyphen_becomes_underscore(self):
        assert _normalize_speaker("speaker-00") == "SPEAKER_00"


class TestExtractSegments:
    def test_extracts_diarization_array(self):
        payload = {
            "output": {
                "diarization": [
                    {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
                    {"speaker": "1", "start": 5.0, "end": 10.0},
                ]
            }
        }
        segs = _extract_segments(payload)
        assert segs == [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
            {"speaker": "SPEAKER_01", "start": 5.0, "end": 10.0},
        ]

    def test_handles_missing_fields(self):
        payload = {
            "output": {
                "diarization": [
                    {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0},
                    {"speaker": None, "start": 5.0, "end": 10.0},  # dropped
                    {"start": 10.0, "end": 15.0},  # dropped
                ]
            }
        }
        segs = _extract_segments(payload)
        assert len(segs) == 1

    def test_handles_missing_output(self):
        assert _extract_segments({}) == []
        assert _extract_segments({"output": {}}) == []


class TestComputeCost:
    def test_applies_minimum_charge(self):
        # Short clip (5s span) — billed at 20s minimum.
        segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0}]
        billed, cost = _compute_cost(segs, cost_per_second_usd=0.001)
        assert billed == 20.0
        assert cost == pytest.approx(0.020)

    def test_billing_uses_span(self):
        # 120s span exceeds minimum.
        segs = [
            {"speaker": "SPEAKER_00", "start": 0.0, "end": 60.0},
            {"speaker": "SPEAKER_01", "start": 60.0, "end": 120.0},
        ]
        billed, cost = _compute_cost(segs, cost_per_second_usd=0.001)
        assert billed == 120.0
        assert cost == pytest.approx(0.120)

    def test_zero_rate_returns_zero_cost(self):
        segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 30.0}]
        billed, cost = _compute_cost(segs, cost_per_second_usd=0.0)
        assert billed == 30.0
        assert cost == 0.0

    def test_empty_segments_still_billed_at_minimum(self):
        billed, cost = _compute_cost([], cost_per_second_usd=0.001)
        assert billed == 20.0
        assert cost == pytest.approx(0.020)


class TestVerifyApiKey:
    def test_returns_true_on_2xx(self):
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        resp = MagicMock()
        resp.status_code = 200
        client_cm.get = MagicMock(return_value=resp)

        with patch.object(cloud.httpx, "Client", return_value=client_cm):
            assert verify_api_key("fake-key", "https://api.pyannote.ai/v1") is True

    def test_returns_false_on_401(self):
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        resp = MagicMock()
        resp.status_code = 401
        client_cm.get = MagicMock(return_value=resp)

        with patch.object(cloud.httpx, "Client", return_value=client_cm):
            assert verify_api_key("fake-key", "https://api.pyannote.ai/v1") is False

    def test_returns_false_on_empty_key(self):
        assert verify_api_key("", "https://api.pyannote.ai/v1") is False


class TestSubmitDiarization:
    def _fake_client(self, resp):
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(return_value=resp)
        return client_cm

    def test_happy_path(self):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"jobId": "job-123", "status": "created"})
        with patch.object(cloud.httpx, "Client", return_value=self._fake_client(resp)):
            job_id = submit_diarization(
                "media://key",
                api_key="k",
                base_url="https://api.pyannote.ai/v1",
                model="precision-2",
            )
        assert job_id == "job-123"

    def test_401_is_retryable_http_access(self):
        resp = MagicMock()
        resp.status_code = 401
        err = httpx.HTTPStatusError("401", request=MagicMock(), response=resp)
        resp.raise_for_status = MagicMock(side_effect=err)
        with patch.object(cloud.httpx, "Client", return_value=self._fake_client(resp)):
            with pytest.raises(PyannoteCloudError) as exc_info:
                submit_diarization(
                    "media://key",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    model="precision-2",
                )
        assert exc_info.value.error_class == "HTTP_ACCESS"
        assert exc_info.value.retryable is True

    def test_503_is_retryable_transient(self):
        resp = MagicMock()
        resp.status_code = 503
        err = httpx.HTTPStatusError("503", request=MagicMock(), response=resp)
        resp.raise_for_status = MagicMock(side_effect=err)
        with patch.object(cloud.httpx, "Client", return_value=self._fake_client(resp)):
            with pytest.raises(PyannoteCloudError) as exc_info:
                submit_diarization(
                    "media://key",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    model="precision-2",
                )
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"

    def test_network_error(self):
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(side_effect=httpx.ConnectError("boom"))
        with patch.object(cloud.httpx, "Client", return_value=client_cm):
            with pytest.raises(PyannoteCloudError) as exc_info:
                submit_diarization(
                    "media://key",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    model="precision-2",
                )
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"

    def test_missing_job_id(self):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={})
        with patch.object(cloud.httpx, "Client", return_value=self._fake_client(resp)):
            with pytest.raises(PyannoteCloudError, match="no jobId"):
                submit_diarization(
                    "media://key",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    model="precision-2",
                )


class TestPollJob:
    def _make_client(self, responses):
        """Return a factory that yields a client whose GET returns responses in order."""
        iterator = iter(responses)

        def client_factory(*args, **kwargs):
            client_cm = MagicMock()
            client_cm.__enter__ = MagicMock(return_value=client_cm)
            client_cm.__exit__ = MagicMock(return_value=False)

            def get(*a, **kw):
                return next(iterator)

            client_cm.get = MagicMock(side_effect=get)
            return client_cm

        return client_factory

    def _resp(self, status_code=200, payload=None):
        resp = MagicMock()
        resp.status_code = status_code
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value=payload or {})
        return resp

    def test_returns_on_success(self):
        success = self._resp(payload={"status": "succeeded", "output": {"diarization": []}})
        with patch.object(cloud.httpx, "Client", side_effect=self._make_client([success])):
            result = poll_job(
                "job-1",
                api_key="k",
                base_url="https://api.pyannote.ai/v1",
                sleep=lambda _: None,
            )
        assert result["status"] == "succeeded"

    def test_polls_through_running_then_succeeds(self):
        running = self._resp(payload={"status": "running"})
        success = self._resp(payload={"status": "succeeded", "output": {"diarization": []}})
        with patch.object(cloud.httpx, "Client", side_effect=self._make_client([running, success])):
            result = poll_job(
                "job-1",
                api_key="k",
                base_url="https://api.pyannote.ai/v1",
                sleep=lambda _: None,
            )
        assert result["status"] == "succeeded"

    def test_raises_on_failed(self):
        failed = self._resp(payload={"status": "failed", "error": "bad audio"})
        with patch.object(cloud.httpx, "Client", side_effect=self._make_client([failed])):
            with pytest.raises(PyannoteCloudError, match="status=failed"):
                poll_job(
                    "job-1",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    sleep=lambda _: None,
                )

    def test_raises_on_canceled(self):
        canceled = self._resp(payload={"status": "canceled"})
        with patch.object(cloud.httpx, "Client", side_effect=self._make_client([canceled])):
            with pytest.raises(PyannoteCloudError, match="status=canceled"):
                poll_job(
                    "job-1",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    sleep=lambda _: None,
                )

    def test_timeout_raises_transient(self):
        # Simulate a running job that never completes — monkey-patch time.monotonic
        # to push past the deadline after one poll.
        running = self._resp(payload={"status": "running"})
        with patch.object(cloud.httpx, "Client", side_effect=self._make_client([running])):
            with pytest.raises(PyannoteCloudError, match="polling timeout") as exc_info:
                poll_job(
                    "job-1",
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                    timeout_secs=0.0,  # already expired
                    sleep=lambda _: None,
                )
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"


class TestUploadAudio:
    def test_missing_file_raises(self, tmp_path):
        with pytest.raises(RuntimeError, match="missing"):
            upload_audio(
                str(tmp_path / "nope.mp3"),
                api_key="k",
                base_url="https://api.pyannote.ai/v1",
            )

    def test_missing_presigned_url_raises(self, tmp_path):
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-mp3-bytes")

        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={})
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(return_value=resp)

        with patch.object(cloud.httpx, "Client", return_value=client_cm):
            with pytest.raises(PyannoteCloudError, match="no presigned URL"):
                upload_audio(
                    str(audio),
                    api_key="k",
                    base_url="https://api.pyannote.ai/v1",
                )


class TestDiarizeViaCloud:
    def test_empty_api_key_raises(self):
        with pytest.raises(PyannoteCloudError, match="not set"):
            diarize_via_cloud(
                "/tmp/a.mp3",
                api_key="",
                base_url="https://api.pyannote.ai/v1",
                model="precision-2",
                cost_per_second_usd=0.001,
            )

    def test_returns_false_on_http_error(self):
        # httpx.HTTPError (e.g. connect timeout) → False, not exception.
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.get = MagicMock(side_effect=httpx.ConnectError("dns"))
        with patch.object(cloud.httpx, "Client", return_value=client_cm):
            assert verify_api_key("k", "https://api.pyannote.ai/v1") is False


class TestUploadAudioErrorPaths:
    def _audio(self, tmp_path):
        audio = tmp_path / "test.mp3"
        audio.write_bytes(b"fake-mp3-bytes")
        return audio

    def _declare_ok_client(self, presigned: str = "https://upload.example/presigned"):
        """Client that returns a valid /media/input declaration."""
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(return_value={"url": presigned})
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(return_value=resp)
        return client_cm

    def test_happy_path_returns_media_url(self, tmp_path):
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        put_resp = MagicMock()
        put_resp.raise_for_status = MagicMock()
        put_cm = MagicMock()
        put_cm.__enter__ = MagicMock(return_value=put_cm)
        put_cm.__exit__ = MagicMock(return_value=False)
        put_cm.put = MagicMock(return_value=put_resp)
        # Two Client() calls: declare then PUT.
        with patch.object(cloud.httpx, "Client", side_effect=[declare, put_cm]):
            result = upload_audio(
                str(audio), api_key="k", base_url="https://api.pyannote.ai/v1",
            )
        assert result.startswith("media://podlog/")
        assert result.endswith(".mp3")
        put_cm.put.assert_called_once()

    def test_declare_timeout_wraps_transient(self, tmp_path):
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        declare.post = MagicMock(side_effect=httpx.ConnectTimeout("slow"))
        with patch.object(cloud.httpx, "Client", return_value=declare):
            with pytest.raises(PyannoteCloudError) as exc_info:
                upload_audio(str(audio), api_key="k",
                              base_url="https://api.pyannote.ai/v1")
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"

    def test_declare_network_error_wraps_transient(self, tmp_path):
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        declare.post = MagicMock(side_effect=httpx.NetworkError("nope"))
        with patch.object(cloud.httpx, "Client", return_value=declare):
            with pytest.raises(PyannoteCloudError) as exc_info:
                upload_audio(str(audio), api_key="k",
                              base_url="https://api.pyannote.ai/v1")
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"

    def test_declare_http_status_error_wraps_http_access(self, tmp_path):
        audio = self._audio(tmp_path)
        bad_resp = MagicMock()
        bad_resp.status_code = 401
        http_err = httpx.HTTPStatusError("401", request=MagicMock(), response=bad_resp)
        declare = self._declare_ok_client()
        declare.post = MagicMock(side_effect=http_err)
        with patch.object(cloud.httpx, "Client", return_value=declare):
            with pytest.raises(PyannoteCloudError) as exc_info:
                upload_audio(str(audio), api_key="k",
                              base_url="https://api.pyannote.ai/v1")
        assert exc_info.value.error_class == "HTTP_ACCESS"

    def test_put_timeout_wraps_transient(self, tmp_path):
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        put_cm = MagicMock()
        put_cm.__enter__ = MagicMock(return_value=put_cm)
        put_cm.__exit__ = MagicMock(return_value=False)
        put_cm.put = MagicMock(side_effect=httpx.ConnectTimeout("slow"))
        with patch.object(cloud.httpx, "Client", side_effect=[declare, put_cm]):
            with pytest.raises(PyannoteCloudError) as exc_info:
                upload_audio(str(audio), api_key="k",
                              base_url="https://api.pyannote.ai/v1")
        assert exc_info.value.error_class == "TRANSIENT_NETWORK"

    def test_put_http_status_error_wraps_http_access(self, tmp_path):
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        bad_resp = MagicMock()
        bad_resp.status_code = 403
        http_err = httpx.HTTPStatusError("403", request=MagicMock(), response=bad_resp)
        put_cm = MagicMock()
        put_cm.__enter__ = MagicMock(return_value=put_cm)
        put_cm.__exit__ = MagicMock(return_value=False)
        put_cm.put = MagicMock(side_effect=http_err)
        with patch.object(cloud.httpx, "Client", side_effect=[declare, put_cm]):
            with pytest.raises(PyannoteCloudError) as exc_info:
                upload_audio(str(audio), api_key="k",
                              base_url="https://api.pyannote.ai/v1")
        assert exc_info.value.error_class == "HTTP_ACCESS"

    def test_accepts_presigned_url_alias_keys(self, tmp_path):
        # The endpoint might return "presignedUrl" or "uploadUrl" instead of "url".
        audio = self._audio(tmp_path)
        declare = self._declare_ok_client()
        declare.post.return_value.json = MagicMock(
            return_value={"presignedUrl": "https://upload.example/x"}
        )
        put_resp = MagicMock()
        put_resp.raise_for_status = MagicMock()
        put_cm = MagicMock()
        put_cm.__enter__ = MagicMock(return_value=put_cm)
        put_cm.__exit__ = MagicMock(return_value=False)
        put_cm.put = MagicMock(return_value=put_resp)
        with patch.object(cloud.httpx, "Client", side_effect=[declare, put_cm]):
            result = upload_audio(str(audio), api_key="k",
                                   base_url="https://api.pyannote.ai/v1")
        assert result.startswith("media://podlog/")


class TestDiarizeViaCloudOrchestration:
    def test_happy_path_orchestrates_upload_submit_poll(self):
        with (
            patch.object(cloud, "upload_audio", return_value="media://podlog/abc.mp3"),
            patch.object(cloud, "submit_diarization", return_value="job-123"),
            patch.object(
                cloud, "poll_job",
                return_value={"output": {"diarization": [
                    {"speaker": "speaker_0", "start": 0.0, "end": 5.0},
                    {"speaker": "speaker_1", "start": 5.0, "end": 10.0},
                ]}},
            ),
        ):
            segments, billed, cost = diarize_via_cloud(
                "/tmp/a.mp3",
                api_key="real-key",
                base_url="https://api.pyannote.ai/v1",
                model="precision-2",
                cost_per_second_usd=0.001,
            )
        assert len(segments) == 2
        # _normalize_speaker passes "SPEAKER_0"/"SPEAKER_1" through unchanged
        # because they already start with the "SPEAKER_" prefix.
        assert {s["speaker"] for s in segments} == {"SPEAKER_0", "SPEAKER_1"}
        # Span = 10s, but the minimum-billing floor is 20s → billed=20, cost=20×0.001
        assert billed == pytest.approx(20.0)
        assert cost == pytest.approx(0.02)


class TestNormalizeSpeakerEdgeCases:
    def test_non_numeric_uppercase_token_gets_speaker_prefix(self):
        # Covers line 357 — final return branch for arbitrary uppercase tokens.
        assert _normalize_speaker("alpha") == "SPEAKER_ALPHA"
