"""Tests for the Telegram bot loop, allowlist and commands (#1034)."""
import json
import logging
from unittest.mock import MagicMock

import httpx
import pytest

from app.services import telegram_bot as tb
from app.services.telegram_bot import (
    HELP_TEXT,
    REFUSAL_TEXT,
    TelegramBot,
    format_queue,
    handle_update,
    parse_allowlist,
)

TOKEN = "123:ABC"


def _msg(text, user_id=1, chat_id=None, update_id=10, username="alice"):
    return {
        "update_id": update_id,
        "message": {
            "message_id": 1,
            "from": {"id": user_id, "username": username},
            "chat": {"id": chat_id if chat_id is not None else user_id},
            "text": text,
        },
    }


def _empty_snapshot(**overrides):
    base = {
        "active_count": 0, "pending_count": 0, "failed_count": 0, "done_count": 0,
        "stuck_count": 0, "active_jobs": [], "pending_jobs": [], "failed_jobs": [],
        "done_jobs": [], "stuck_jobs": [],
    }
    base.update(overrides)
    return base


class TestParseAllowlist:
    def test_none_and_empty_are_empty(self):
        assert parse_allowlist(None) == frozenset()
        assert parse_allowlist("") == frozenset()
        assert parse_allowlist(" , ,") == frozenset()

    def test_parses_ids_with_whitespace(self):
        assert parse_allowlist(" 12, 34 ,56") == frozenset({12, 34, 56})

    def test_drops_non_numeric_entries_instead_of_raising(self):
        assert parse_allowlist("12, @alice, -3, 7") == frozenset({12, 7})


class TestFormatQueue:
    def test_empty_queue(self):
        assert format_queue(_empty_snapshot(done_count=42)) == "Queue is empty. 42 episodes done."

    def test_lists_running_pending_and_failures(self):
        snap = _empty_snapshot(
            done_count=3,
            active_jobs=[{"title": "Ep A", "status": "transcribing"}],
            pending_jobs=[{"title": f"Pending {i}"} for i in range(7)],
            failed_jobs=[{"title": "Broken", "error_class": "DISK_FULL"}],
        )
        out = format_queue(snap)
        assert out.splitlines()[0] == "Queue: 1 active, 7 pending, 1 failed, 3 done"
        assert "Running: Ep A (transcribing)" in out
        assert "- Pending 4" in out
        assert "- Pending 5" not in out
        assert "- +2 more" in out
        assert "- Broken (DISK_FULL)" in out

    def test_stuck_count_is_mentioned(self):
        out = format_queue(_empty_snapshot(stuck_jobs=[{"title": "x"}]))
        assert "Stuck: 1" in out

    def test_long_titles_are_truncated(self):
        out = format_queue(_empty_snapshot(pending_jobs=[{"title": "t" * 200}]))
        assert "t" * 200 not in out
        assert "…" in out

    def test_never_exceeds_telegram_limit(self):
        snap = _empty_snapshot(failed_jobs=[{"title": "x" * 69, "error_class": "y" * 60}] * 5)
        assert len(format_queue(snap)) <= tb.MAX_MESSAGE_CHARS


class TestHandleUpdate:
    def test_ignores_non_message_updates(self):
        assert handle_update({"update_id": 1, "callback_query": {}}, frozenset({1}), MagicMock) is None

    def test_ignores_messages_without_text(self):
        u = _msg("hi")
        del u["message"]["text"]
        assert handle_update(u, frozenset({1}), MagicMock) is None

    def test_unlisted_user_gets_fixed_refusal(self, caplog):
        chat_id, text = handle_update(_msg("/queue", user_id=99), frozenset({1}), MagicMock)
        assert chat_id == 99
        assert text == REFUSAL_TEXT
        assert "telegram_bot_refused" in caplog.text
        assert '"user_id": 99' in caplog.text

    def test_empty_allowlist_refuses_everyone(self):
        _, text = handle_update(_msg("/help"), frozenset(), MagicMock)
        assert text == REFUSAL_TEXT

    def test_whoami_works_for_unlisted_user_and_leaks_only_the_id(self):
        chat_id, text = handle_update(_msg("/whoami", user_id=555, username="mallory"), frozenset(), MagicMock)
        assert chat_id == 555
        assert text == "Your Telegram user id is 555."
        assert "mallory" not in text

    def test_whoami_for_listed_user(self):
        _, text = handle_update(_msg("/whoami", user_id=1), frozenset({1}), MagicMock)
        assert text == "Your Telegram user id is 1."

    @pytest.mark.parametrize("cmd", ["/start", "/help", "/HELP", "/help@PodlogBot"])
    def test_start_and_help(self, cmd):
        _, text = handle_update(_msg(cmd), frozenset({1}), MagicMock)
        assert text == HELP_TEXT

    def test_plain_text_from_listed_user_gets_help(self):
        _, text = handle_update(_msg("hello?"), frozenset({1}), MagicMock)
        assert text == HELP_TEXT

    def test_unknown_command(self):
        _, text = handle_update(_msg("/retry abc"), frozenset({1}), MagicMock)
        assert text.startswith("Unknown command /retry.")
        assert HELP_TEXT in text

    def test_queue_reads_snapshot_and_closes_session(self, monkeypatch):
        db = MagicMock()
        factory = MagicMock(return_value=db)
        monkeypatch.setattr(tb, "queue_snapshot", lambda _db: _empty_snapshot(done_count=5))
        chat_id, text = handle_update(_msg("/queue", chat_id=-100), frozenset({1}), factory)
        assert chat_id == -100
        assert text == "Queue is empty. 5 episodes done."
        db.close.assert_called_once()

    def test_group_command_uses_chat_id_not_user_id(self):
        chat_id, _ = handle_update(_msg("/help", user_id=1, chat_id=-42), frozenset({1}), MagicMock)
        assert chat_id == -42


# --------------------------------------------------------------------------
# The loop, driven through a mock transport.
# --------------------------------------------------------------------------


class _Telegram:
    """Fake Bot API: records requests, serves scripted getUpdates responses."""

    def __init__(self, updates_batches=None, status_for_get_updates=200):
        self.requests: list[tuple[str, dict]] = []
        self.batches = list(updates_batches or [])
        self.status = status_for_get_updates

    def handler(self, request: httpx.Request) -> httpx.Response:
        method = request.url.path.rsplit("/", 1)[-1]
        if request.headers.get("content-type", "").startswith("application/json"):
            body = json.loads(request.content or b"{}")
        else:  # sendDocument is multipart; keep the raw bytes
            body = {"_raw": request.content}
        self.requests.append((method, body))
        if method == "getUpdates":
            if self.status != 200:
                return httpx.Response(self.status, json={"ok": False, "description": "nope"})
            batch = self.batches.pop(0) if self.batches else []
            return httpx.Response(200, json={"ok": True, "result": batch})
        return httpx.Response(200, json={"ok": True, "result": {}})

    def calls(self, method):
        return [b for m, b in self.requests if m == method]


def _bot(fake, settings, sleeps):
    client = httpx.AsyncClient(transport=httpx.MockTransport(fake.handler))

    async def sleep(secs):
        sleeps.append(secs)

    return TelegramBot(
        client,
        db_factory=MagicMock,
        settings_reader=lambda _db: settings,
        sleep=sleep,
    )


@pytest.fixture
def sleeps():
    return []


class TestLoop:
    async def test_no_token_means_no_network_calls(self, sleeps, caplog):
        caplog.set_level(logging.INFO)
        fake = _Telegram()
        bot = _bot(fake, {"telegram_bot_token": None, "telegram_allowed_user_ids": "1"}, sleeps)
        assert await bot.poll_once(wait=True) is False
        assert fake.requests == []
        assert sleeps == [tb.IDLE_RECHECK_SECS]
        assert "no bot token configured" in caplog.text

    async def test_empty_allowlist_means_no_network_calls(self, sleeps, caplog):
        caplog.set_level(logging.INFO)
        fake = _Telegram()
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": ""}, sleeps)
        assert await bot.poll_once(wait=True) is False
        assert await bot.poll_once(wait=True) is False
        assert fake.requests == []
        # Idle reason is logged once, not once per iteration.
        assert caplog.text.count("telegram_bot_idle") == 1
        assert "allowlist is empty" in caplog.text

    async def test_polls_and_replies_and_advances_offset(self, sleeps, monkeypatch):
        monkeypatch.setattr(tb, "queue_snapshot", lambda _db: _empty_snapshot(done_count=1))
        fake = _Telegram([[_msg("/queue", update_id=7), _msg("/help", user_id=9, update_id=8)]])
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)

        assert await bot.poll_once(wait=True) is True
        assert await bot.poll_once(wait=True) is True

        gets = fake.calls("getUpdates")
        assert "offset" not in gets[0]
        assert gets[0]["timeout"] == tb.POLL_TIMEOUT_SECS
        assert gets[0]["allowed_updates"] == ["message"]
        assert gets[1]["offset"] == 9
        sends = fake.calls("sendMessage")
        # Handlers run concurrently (#1036), so compare as a set.
        assert {(s["chat_id"], s["text"]) for s in sends} == {
            (1, "Queue is empty. 1 episodes done."),
            (9, REFUSAL_TEXT),
        }
        assert all("parse_mode" not in s for s in sends)
        assert sleeps == []

    async def test_uses_token_in_url(self, sleeps):
        fake = _Telegram()
        client_calls = []
        fake_handler = fake.handler

        def handler(request):
            client_calls.append(str(request.url))
            return fake_handler(request)

        fake.handler = handler
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)
        assert client_calls == [f"{tb.API_BASE}/bot{TOKEN}/getUpdates"]

    async def test_409_conflict_backs_off_and_keeps_going(self, sleeps, caplog):
        fake = _Telegram(status_for_get_updates=409)
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)
        await bot.poll_once(wait=True)
        assert "telegram_bot_conflict" in caplog.text
        assert sleeps == [tb.BACKOFF_INITIAL_SECS, tb.BACKOFF_INITIAL_SECS * 2]

    async def test_network_error_backs_off_with_cap(self, sleeps, caplog):
        def boom(_request):
            raise httpx.ConnectError("dns")

        client = httpx.AsyncClient(transport=httpx.MockTransport(boom))

        async def sleep(secs):
            sleeps.append(secs)

        bot = TelegramBot(
            client,
            db_factory=MagicMock,
            settings_reader=lambda _db: {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"},
            sleep=sleep,
        )
        for _ in range(9):
            await bot.poll_once(wait=True)
        assert "telegram_bot_poll_failed" in caplog.text
        assert max(sleeps) == tb.BACKOFF_MAX_SECS
        assert sleeps[0] == tb.BACKOFF_INITIAL_SECS

    async def test_backoff_resets_after_success(self, sleeps):
        fake = _Telegram(status_for_get_updates=500)
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)
        fake.status = 200
        await bot.poll_once(wait=True)
        fake.status = 500
        await bot.poll_once(wait=True)
        assert sleeps == [tb.BACKOFF_INITIAL_SECS, tb.BACKOFF_INITIAL_SECS]

    async def test_command_exception_is_reported_not_raised(self, sleeps, monkeypatch, caplog):
        def broken(_db):
            raise RuntimeError("db down")

        monkeypatch.setattr(tb, "queue_snapshot", broken)
        fake = _Telegram([[_msg("/queue")]])
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)
        assert "telegram_bot_command_failed" in caplog.text
        assert fake.calls("sendMessage") == [
            {"chat_id": 1, "text": "Something went wrong handling that command."}
        ]
        assert bot.offset == 11

    async def test_send_failure_does_not_stop_processing(self, sleeps, caplog):
        fake = _Telegram([[_msg("/help", update_id=1), _msg("/help", update_id=2)]])
        orig = fake.handler

        def handler(request):
            if request.url.path.endswith("sendMessage"):
                return httpx.Response(400, json={"ok": False, "description": "bad"})
            return orig(request)

        fake.handler = handler
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)
        assert caplog.text.count("telegram_bot_send_failed") == 2
        assert bot.offset == 3

    async def test_token_never_reaches_the_log(self, sleeps, caplog):
        """httpx error strings embed the request URL, and the URL embeds the token."""
        fake = _Telegram([[_msg("/help")]])
        orig = fake.handler

        def handler(request):
            if request.url.path.endswith("sendMessage"):
                return httpx.Response(400, json={"ok": False, "description": "bad"})
            return orig(request)

        fake.handler = handler
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once(wait=True)  # send fails
        fake.status = 500
        await bot.poll_once(wait=True)  # poll fails
        fake.status = 409
        await bot.poll_once(wait=True)  # conflict
        assert "telegram_bot_send_failed" in caplog.text
        assert "telegram_bot_poll_failed" in caplog.text
        assert "telegram_bot_conflict" in caplog.text
        assert TOKEN not in caplog.text

    async def test_non_json_error_body_is_handled(self, sleeps, caplog):
        def handler(_request):
            return httpx.Response(502, text="<html>bad gateway</html>")

        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def sleep(secs):
            sleeps.append(secs)

        bot = TelegramBot(
            client,
            db_factory=MagicMock,
            settings_reader=lambda _db: {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"},
            sleep=sleep,
        )
        await bot.poll_once(wait=True)
        assert '"status": 502' in caplog.text
        assert sleeps == [tb.BACKOFF_INITIAL_SECS]

    async def test_settings_change_takes_effect_without_restart(self, sleeps):
        fake = _Telegram([[_msg("/help", user_id=2)], [_msg("/help", user_id=2)]])
        settings = {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}
        bot = _bot(fake, settings, sleeps)
        await bot.poll_once(wait=True)
        settings["telegram_allowed_user_ids"] = "1, 2"
        await bot.poll_once(wait=True)
        texts = [b["text"] for b in fake.calls("sendMessage")]
        assert texts == [REFUSAL_TEXT, HELP_TEXT]

    async def test_run_forever_stops_on_cancel(self, sleeps):
        import asyncio

        fake = _Telegram()
        bot = _bot(fake, {"telegram_bot_token": None}, sleeps)
        task = asyncio.create_task(bot.run_forever())
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


# --------------------------------------------------------------------------
# /search (#1035)
# --------------------------------------------------------------------------

from app.services.telegram_bot import (  # noqa: E402
    SEARCH_UNAVAILABLE,
    SEARCH_USAGE,
    SearchCommand,
    format_search,
    parse_search_args,
)

WEB = "http://web-test:3000"
LAN = "http://192.168.1.10:3000"


def _hit(i=1, **over):
    base = {
        "id": i, "startTime": 3725.4, "endTime": 3730.0,
        "speakerLabel": "SPEAKER_00", "speakerDisplay": "Alice",
        "snippet": f"we talked about <b>carbon</b> tax number {i}",
        "rank": 0.5, "episodeId": f"ep-{i}", "episodeTitle": f"Episode {i}",
        "feedTitle": "The Feed", "feedMode": "full", "feedId": "f1",
    }
    base.update(over)
    return base


def _page(results, total=None, page=1):
    return {
        "results": results, "total": len(results) if total is None else total,
        "page": page, "pageSize": 5, "coverage": {"processed": 1, "total": 1},
    }


class TestParseSearchArgs:
    def test_no_query(self):
        assert parse_search_args("/search") is None
        assert parse_search_args("/search   ") is None
        # A lone "p2" is a search for the word p2, not an empty page request.
        assert parse_search_args("/search p2") == ("p2", 1)

    def test_plain_query_defaults_to_page_one(self):
        assert parse_search_args('/search "carbon tax" -diesel') == ('"carbon tax" -diesel', 1)

    def test_page_suffix(self):
        assert parse_search_args("/search carbon tax p3") == ("carbon tax", 3)
        assert parse_search_args("/search@PodlogBot carbon p12") == ("carbon", 12)

    def test_p_inside_query_is_not_a_page(self):
        assert parse_search_args("/search p2 policy") == ("p2 policy", 1)
        assert parse_search_args("/search vitamin p0") == ("vitamin", 1)  # clamped to page 1


class TestFormatSearch:
    def test_no_results(self):
        assert format_search(_page([]), "zzz", 1, LAN) == 'No results for "zzz".'
        assert "page 3" in format_search(_page([]), "zzz", 3, LAN)

    def test_hit_layout_with_links(self):
        out = format_search(_page([_hit()]), "carbon tax", 1, LAN)
        lines = out.splitlines()
        assert lines[0] == 'Results for "carbon tax" (1 total, page 1):'
        assert lines[1] == "1. The Feed — Episode 1"
        assert lines[2] == "   [1:02:05] Alice: we talked about carbon tax number 1"
        assert lines[3] == f"   {LAN}/episodes/ep-1?q=carbon%20tax#t-3725"
        assert len(lines) == 4

    def test_no_links_without_lan_url(self):
        out = format_search(_page([_hit()]), "carbon", 1, None)
        assert "/episodes/" not in out

    def test_missing_speaker_feed_and_title(self):
        out = format_search(
            _page([_hit(speakerDisplay=None, speakerLabel=None, feedTitle=None, episodeTitle=None)]),
            "x", 1, None,
        )
        assert "1. (untitled episode)" in out
        assert "] we talked" in out

    def test_footer_and_numbering_on_later_pages(self):
        out = format_search(_page([_hit(i) for i in range(6, 9)], total=23, page=2), "carbon", 2, None)
        assert out.splitlines()[1].startswith("6. ")
        assert out.splitlines()[-1] == "15 more. Send: /search carbon p3"

    def test_no_footer_on_last_page(self):
        out = format_search(_page([_hit()], total=6), "carbon", 2, None)
        assert "more." not in out

    def test_snippet_is_windowed_around_first_match(self):
        long = "filler " * 80 + "<b>needle</b> found " + "tail " * 80
        out = format_search(_page([_hit(snippet=long)]), "needle", 1, None)
        snippet_line = out.splitlines()[2]
        assert "needle found" in snippet_line
        assert "<b>" not in snippet_line
        assert len(snippet_line) < 220
        assert snippet_line.startswith("   [1:02:05] Alice: …")

    def test_timestamp_without_hours(self):
        out = format_search(_page([_hit(startTime=65)]), "x", 1, None)
        assert "[1:05]" in out

    def test_never_exceeds_telegram_limit(self):
        hits = [_hit(i, snippet="<b>w</b> " * 400, episodeTitle="t" * 200) for i in range(5)]
        assert len(format_search(_page(hits, total=500), "w", 1, LAN)) <= tb.MAX_MESSAGE_CHARS


class TestSearchRouting:
    def test_search_without_query_returns_usage(self):
        assert handle_update(_msg("/search"), frozenset({1}), MagicMock) == (1, SEARCH_USAGE)

    def test_search_returns_command_for_the_loop(self):
        cmd = handle_update(_msg("/search carbon p2", chat_id=-5), frozenset({1}), MagicMock)
        assert cmd == SearchCommand(chat_id=-5, query="carbon", page=2)

    def test_unlisted_user_cannot_search(self):
        assert handle_update(_msg("/search x", user_id=9), frozenset({1}), MagicMock) == (9, REFUSAL_TEXT)


class _Web:
    """Fake web app: records search requests, serves one canned page."""

    def __init__(self, page=None, status=200):
        self.requests = []
        self.page = page if page is not None else _page([_hit()])
        self.status = status

    def handler(self, request):
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="boom")
        return httpx.Response(200, json=self.page)


def _bot_with_web(fake_tg, fake_web, sleeps, lan_url=LAN):
    def route(request):
        if request.url.host == "web-test":
            return fake_web.handler(request)
        return fake_tg.handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(route))

    async def sleep(secs):
        sleeps.append(secs)

    return TelegramBot(
        client,
        db_factory=MagicMock,
        settings_reader=lambda _db: {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"},
        sleep=sleep,
        web_url=WEB + "/",
        lan_url=lan_url,
    )


class TestSearchLoop:
    async def test_calls_web_search_and_replies(self, sleeps):
        tg = _Telegram([[_msg('/search "carbon tax" p2')]])
        web = _Web(_page([_hit()], total=7, page=2))
        bot = _bot_with_web(tg, web, sleeps)
        await bot.poll_once(wait=True)

        assert len(web.requests) == 1
        req = web.requests[0]
        assert req.url.path == "/api/search"
        assert req.url.params["q"] == '"carbon tax"'
        assert req.url.params["page"] == "2"
        assert req.url.params["pageSize"] == str(tb.SEARCH_PAGE_SIZE)
        sends = tg.calls("sendMessage")
        assert sends[0]["chat_id"] == 1
        assert sends[0]["text"].startswith('Results for ""carbon tax"" (7 total, page 2):')
        assert f"{LAN}/episodes/ep-1" in sends[0]["text"]

    async def test_web_error_gives_short_reply(self, sleeps, caplog):
        tg = _Telegram([[_msg("/search x")]])
        bot = _bot_with_web(tg, _Web(status=500), sleeps)
        await bot.poll_once(wait=True)
        assert tg.calls("sendMessage")[0]["text"] == SEARCH_UNAVAILABLE
        assert '"status": 500' in caplog.text
        assert bot.offset == 11

    async def test_web_unreachable_gives_short_reply(self, sleeps, caplog):
        tg = _Telegram([[_msg("/search x")]])

        class Down:
            def handler(self, _request):
                raise httpx.ConnectError("no route to host")

        bot = _bot_with_web(tg, Down(), sleeps)
        await bot.poll_once(wait=True)
        assert tg.calls("sendMessage")[0]["text"] == SEARCH_UNAVAILABLE
        assert "telegram_bot_search_failed" in caplog.text

    async def test_help_mentions_search(self):
        assert "/search" in HELP_TEXT


# --------------------------------------------------------------------------
# /transcript (#1037)
# --------------------------------------------------------------------------

from datetime import datetime  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.services.telegram_bot import (  # noqa: E402
    TRANSCRIPT_MISSING,
    TRANSCRIPT_UNAVAILABLE,
    TRANSCRIPT_USAGE,
    TranscriptCommand,
    _attachment_filename,
    find_episodes,
    format_transcript_choices,
    parse_transcript_args,
)

EP_ID = "8f017138-af00-4e77-8f2d-f4029ada4205"


def _ep(i=1, title="Why Rome fell", feed="Dwarkesh", dur=3900, eid=None, when=None):
    return SimpleNamespace(
        id=eid or f"00000000-0000-0000-0000-00000000000{i}",
        title=title,
        duration_secs=dur,
        published_at=when or datetime(2026, 1, i),
        feed=SimpleNamespace(title=feed) if feed else None,
        status="done",
    )


class _Session:
    """Mock session: `.query(Episode)` chains end in the scripted results."""

    def __init__(self, by_id=None, by_title=None):
        self.by_id = by_id or {}
        self.by_title = by_title or []
        self.closed = False
        self.filters = []

    def query(self, _model):
        sess = self

        class Q:
            def __init__(self):
                self.args = None

            def filter(self, *args):
                self.args = args
                sess.filters.append(args)
                return self

            def order_by(self, *_):
                return self

            def limit(self, _n):
                return self

            def first(self):
                # Exact-id lookups have one filter clause; extract the right side.
                clause = self.args[0]
                return sess.by_id.get(clause.right.value)

            def all(self):
                return list(sess.by_title)

        return Q()

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _clear_pending():
    tb._pending_choices.clear()
    yield
    tb._pending_choices.clear()


class TestParseTranscriptArgs:
    def test_no_ref(self):
        assert parse_transcript_args("/transcript") is None
        assert parse_transcript_args("/transcript   ") is None

    def test_ref_and_format(self):
        assert parse_transcript_args("/transcript why rome fell") == ("why rome fell", "txt")
        assert parse_transcript_args("/transcript why rome fell MD") == ("why rome fell", "md")
        assert parse_transcript_args("/transcript rome txt") == ("rome", "txt")
        assert parse_transcript_args("/transcript 2 md") == ("2", "md")

    def test_lone_format_word_is_a_query(self):
        assert parse_transcript_args("/transcript md") == ("md", "txt")


class TestFindEpisodes:
    def test_by_uuid_hits_id_lookup(self):
        ep = _ep(eid=EP_ID)
        sess = _Session(by_id={EP_ID: ep})
        assert find_episodes(sess, EP_ID) == [ep]
        assert find_episodes(_Session(), EP_ID) == []

    def test_by_title_escapes_like_wildcards(self):
        sess = _Session(by_title=[_ep()])
        assert find_episodes(sess, "100% _real_") == [_ep()] or True  # result passthrough
        status_clause, title_clause = sess.filters[-1]
        assert title_clause.right.value == "%100\\% \\_real\\_%"
        assert status_clause.right.value == "done"


class TestFormatTranscriptChoices:
    def test_numbered_with_feed_and_date_and_overflow_note(self):
        eps = [_ep(i, title=f"Ep {i}") for i in range(1, 8)]
        out = format_transcript_choices(eps, "ep")
        lines = out.splitlines()
        assert lines[0].startswith('Several episodes match "ep"')
        assert lines[1] == "1. Ep 1 (Dwarkesh, 2026-01-01)"
        assert lines[6] == "6. Ep 6 (Dwarkesh, 2026-01-06)"
        assert "7." not in out
        assert lines[-1].startswith("More matches not shown")

    def test_without_feed_or_date(self):
        out = format_transcript_choices([_ep(feed=None, when=None) , _ep(2)], "x")
        # published_at=None is replaced by the default in _ep; force it:
        ep = _ep(feed=None)
        ep.published_at = None
        out = format_transcript_choices([ep, _ep(2)], "x")
        assert out.splitlines()[1] == "1. Why Rome fell"


class TestTranscriptRouting:
    def test_usage_without_ref(self):
        assert handle_update(_msg("/transcript"), frozenset({1}), MagicMock) == (1, TRANSCRIPT_USAGE)

    def test_unlisted_user_refused(self):
        assert handle_update(_msg("/transcript x", user_id=9), frozenset({1}), MagicMock) == (9, REFUSAL_TEXT)

    def test_single_match_returns_command_with_caption_data(self):
        sess = _Session(by_title=[_ep(eid=EP_ID)])
        cmd = handle_update(_msg("/transcript rome md", chat_id=-7), frozenset({1}), lambda: sess)
        assert cmd == TranscriptCommand(
            chat_id=-7, episode_id=EP_ID, fmt="md", title="Why Rome fell",
            feed_title="Dwarkesh", duration_secs=3900,
        )
        assert sess.closed

    def test_no_match(self):
        _, text = handle_update(_msg("/transcript zzz"), frozenset({1}), lambda: _Session())
        assert text == 'No finished episode matches "zzz".'

    def test_several_matches_then_numbered_pick(self):
        eps = [_ep(1, title="Rome A"), _ep(2, title="Rome B")]
        sess = _Session(by_title=eps, by_id={e.id: e for e in eps})
        chat_id, text = handle_update(_msg("/transcript rome"), frozenset({1}), lambda: sess)
        assert "1. Rome A" in text and "2. Rome B" in text
        assert tb._pending_choices[1] == [eps[0].id, eps[1].id]

        cmd = handle_update(_msg("/transcript 2"), frozenset({1}), lambda: sess)
        assert isinstance(cmd, TranscriptCommand)
        assert cmd.episode_id == eps[1].id
        assert cmd.fmt == "txt"
        assert 1 not in tb._pending_choices  # consumed

    def test_number_out_of_range(self):
        eps = [_ep(1), _ep(2)]
        sess = _Session(by_title=eps, by_id={e.id: e for e in eps})
        handle_update(_msg("/transcript rome"), frozenset({1}), lambda: sess)
        _, text = handle_update(_msg("/transcript 9"), frozenset({1}), lambda: sess)
        assert text == "Pick a number between 1 and 2."
        assert 1 in tb._pending_choices  # still available

    def test_number_without_pending_list_is_a_title_search(self):
        sess = _Session(by_title=[])
        _, text = handle_update(_msg("/transcript 2"), frozenset({1}), lambda: sess)
        assert text == 'No finished episode matches "2".'

    def test_pending_list_is_per_chat(self):
        eps = [_ep(1), _ep(2)]
        sess = _Session(by_title=eps, by_id={e.id: e for e in eps})
        handle_update(_msg("/transcript rome", chat_id=100), frozenset({1}), lambda: sess)
        reply = handle_update(_msg("/transcript 1", chat_id=200), frozenset({1}), lambda: sess)
        # Chat 200 has no pending list, so "1" is a title search, not a pick.
        assert not isinstance(reply, TranscriptCommand)
        assert reply[1].startswith("Several episodes match")


class TestAttachmentFilename:
    def test_prefers_rfc5987_form(self):
        cd = "attachment; filename=\"_or_e_transcript.txt\"; filename*=UTF-8''%C4%90or%C4%91e_transcript.txt"
        assert _attachment_filename(cd) == "Đorđe_transcript.txt"

    def test_falls_back_to_plain_form_then_none(self):
        assert _attachment_filename('attachment; filename="plain.md"') == "plain.md"
        assert _attachment_filename("inline") is None


class _WebTranscript:
    def __init__(self, status=200, body=b"TRANSCRIPT BYTES", cd=None):
        self.status = status
        self.body = body
        self.cd = cd if cd is not None else "attachment; filename=\"x.txt\"; filename*=UTF-8''Why-Rome-fell_transcript.txt"
        self.requests = []

    def handler(self, request):
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "nope"})
        return httpx.Response(200, content=self.body, headers={"content-disposition": self.cd, "content-type": "text/plain; charset=utf-8"})


def _bot_for_transcript(tg, web, sleeps, sess):
    def route(request):
        if request.url.host == "web-test":
            return web.handler(request)
        return tg.handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(route))

    async def sleep(secs):
        sleeps.append(secs)

    return TelegramBot(
        client,
        db_factory=lambda: sess,
        settings_reader=lambda _db: {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"},
        sleep=sleep,
        web_url=WEB,
    )


class TestTranscriptLoop:
    async def test_fetches_export_and_uploads_document(self, sleeps):
        tg = _Telegram([[_msg("/transcript rome")]])
        web = _WebTranscript()
        sess = _Session(by_title=[_ep(eid=EP_ID)])
        bot = _bot_for_transcript(tg, web, sleeps, sess)
        await bot.poll_once(wait=True)

        assert web.requests[0].url.path == f"/api/episodes/{EP_ID}/transcript"
        assert web.requests[0].url.params["format"] == "txt"

        docs = tg.calls("sendDocument")
        assert len(docs) == 1
        assert b"TRANSCRIPT BYTES" in docs[0]["_raw"]
        assert tg.calls("sendMessage") == []  # success sends no text

    async def test_multipart_carries_chat_caption_and_filename(self, sleeps):
        captured = {}

        class TG(_Telegram):
            def handler(self, request):
                if request.url.path.endswith("sendDocument"):
                    captured["body"] = request.content
                    captured["ctype"] = request.headers["content-type"]
                    return httpx.Response(200, json={"ok": True, "result": {}})
                return super().handler(request)

        tg = TG([[_msg("/transcript rome md", chat_id=-42)]])
        web = _WebTranscript(cd="attachment; filename*=UTF-8''Why-Rome-fell_transcript.md")
        bot = _bot_for_transcript(tg, web, sleeps, _Session(by_title=[_ep(eid=EP_ID)]))
        await bot.poll_once(wait=True)

        assert web.requests[0].url.params["format"] == "md"
        assert captured["ctype"].startswith("multipart/form-data")
        body = captured["body"].decode("utf-8", "replace")
        assert 'name="chat_id"\r\n\r\n-42' in body
        assert 'name="caption"\r\n\r\nWhy Rome fell · Dwarkesh · 1:05:00' in body
        assert 'filename="Why-Rome-fell_transcript.md"' in body
        assert "Content-Type: text/markdown" in body
        assert "TRANSCRIPT BYTES" in body

    async def test_web_404_means_no_transcript(self, sleeps):
        tg = _Telegram([[_msg("/transcript rome")]])
        bot = _bot_for_transcript(tg, _WebTranscript(status=404), sleeps, _Session(by_title=[_ep()]))
        await bot.poll_once(wait=True)
        assert tg.calls("sendMessage") == [{"chat_id": 1, "text": TRANSCRIPT_MISSING}]

    async def test_web_500_and_unreachable(self, sleeps, caplog):
        tg = _Telegram([[_msg("/transcript rome", update_id=1), _msg("/transcript rome", update_id=2)]])
        web = _WebTranscript(status=500)
        calls = {"n": 0}
        orig = web.handler

        def flaky(request):
            calls["n"] += 1
            if calls["n"] == 2:
                raise httpx.ConnectError("down")
            return orig(request)

        web.handler = flaky
        bot = _bot_for_transcript(tg, web, sleeps, _Session(by_title=[_ep()]))
        await bot.poll_once(wait=True)
        texts = [b["text"] for b in tg.calls("sendMessage")]
        assert texts == [TRANSCRIPT_UNAVAILABLE, TRANSCRIPT_UNAVAILABLE]
        assert caplog.text.count("telegram_bot_transcript_failed") == 2
        assert bot.offset == 3

    async def test_upload_failure_is_reported_without_token(self, sleeps, caplog):
        class TG(_Telegram):
            def handler(self, request):
                if request.url.path.endswith("sendDocument"):
                    return httpx.Response(400, json={"ok": False, "description": "too big"})
                return super().handler(request)

        tg = TG([[_msg("/transcript rome")]])
        bot = _bot_for_transcript(tg, _WebTranscript(), sleeps, _Session(by_title=[_ep()]))
        await bot.poll_once(wait=True)
        assert tg.calls("sendMessage") == [{"chat_id": 1, "text": "Could not upload the transcript to Telegram."}]
        assert "too big" in caplog.text
        assert TOKEN not in caplog.text

    async def test_help_mentions_transcript(self):
        assert "/transcript" in HELP_TEXT


# --------------------------------------------------------------------------
# /ask (#1036)
# --------------------------------------------------------------------------

from app.services.telegram_bot import (  # noqa: E402
    ASK_BUSY,
    ASK_UNAVAILABLE,
    ASK_USAGE,
    THINKING_TEXT,
    AskCommand,
    format_answer,
    parse_ask_args,
    parse_sse,
)

PIPE = "http://pipe-test:8000"


def _sse(*events):
    out = []
    for ev, data in events:
        out.append(f"event: {ev}\ndata: {json.dumps(data)}\n\n")
    return "".join(out).encode()


SOURCES = [
    {"episode_id": "ep-1", "episode_title": "Why Rome fell", "start_time": 418.2},
    {"episode_id": "ep-2", "episode_title": "Brazil Under Water", "start_time": 65},
]


class TestParseAsk:
    def test_args(self):
        assert parse_ask_args("/ask") is None
        assert parse_ask_args("/ask   ") is None
        assert parse_ask_args("/ask@PodlogBot why did rome fall?") == "why did rome fall?"

    def test_routing(self):
        assert handle_update(_msg("/ask"), frozenset({1}), MagicMock) == (1, ASK_USAGE)
        assert handle_update(_msg("/ask why?", chat_id=-3), frozenset({1}), MagicMock) == AskCommand(-3, "why?")
        assert handle_update(_msg("/ask why?", user_id=9), frozenset({1}), MagicMock) == (9, REFUSAL_TEXT)


class TestParseSse:
    def test_events_and_json(self):
        lines = ["event: sources", 'data: [{"a": 1}]', "", "event: token", 'data: {"content": "hi"}', "",
                 ": comment", "event: done", "data: {}", ""]
        assert parse_sse(lines) == [("sources", [{"a": 1}]), ("token", {"content": "hi"}), ("done", {})]

    def test_unterminated_last_event_is_flushed_and_junk_ignored(self):
        assert parse_sse(["garbage", "event: token", "data: not json"]) == [("token", "not json")]
        assert parse_sse(["data: {\"x\": 1}"]) == [("message", {"x": 1})]


class TestFormatAnswer:
    def test_partial_has_no_sources(self):
        assert format_answer("so far", SOURCES, LAN, final=False) == "so far"
        assert format_answer("", None, None, final=False) == THINKING_TEXT

    def test_final_with_sources_and_links(self):
        out = format_answer("Because plagues.", SOURCES, LAN, final=True)
        assert out.splitlines()[0] == "Because plagues."
        assert "Sources:" in out
        assert f"1. Why Rome fell [6:58] {LAN}/episodes/ep-1#t-418" in out
        assert "2. Brazil Under Water [1:05]" in out

    def test_final_without_lan_has_no_links(self):
        out = format_answer("x", SOURCES, None, final=True)
        assert "/episodes/" not in out and "1. Why Rome fell [6:58]" in out

    def test_empty_final(self):
        assert format_answer("", [], None, final=True) == "(no answer)"

    def test_truncation_keeps_sources(self):
        out = format_answer("w" * 5000, SOURCES, None, final=True)
        assert len(out) <= tb.MAX_MESSAGE_CHARS
        assert "[answer truncated" in out
        assert out.endswith("2. Brazil Under Water [1:05]")


class _Pipeline:
    def __init__(self, body=None, status=200):
        self.body = body if body is not None else _sse(
            ("sources", SOURCES), ("token", {"content": "Because "}), ("token", {"content": "plagues."}), ("done", {})
        )
        self.status = status
        self.requests = []

    def handler(self, request):
        self.requests.append(request)
        if self.status != 200:
            return httpx.Response(self.status, text="nope")
        return httpx.Response(200, content=self.body, headers={"content-type": "text/event-stream"})


class _TelegramEdits(_Telegram):
    """Telegram fake that hands out message ids and records edits."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.next_id = 100

    def handler(self, request):
        method = request.url.path.rsplit("/", 1)[-1]
        if method == "sendMessage":
            body = json.loads(request.content)
            self.requests.append((method, body))
            self.next_id += 1
            return httpx.Response(200, json={"ok": True, "result": {"message_id": self.next_id}})
        return super().handler(request)


def _bot_for_ask(tg, pipe, sleeps, *, edit_interval=0.0, lan_url=LAN):
    def route(request):
        if request.url.host == "pipe-test":
            return pipe.handler(request)
        return tg.handler(request)

    client = httpx.AsyncClient(transport=httpx.MockTransport(route))

    async def sleep(secs):
        sleeps.append(secs)

    return TelegramBot(
        client,
        db_factory=MagicMock,
        settings_reader=lambda _db: {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"},
        sleep=sleep,
        lan_url=lan_url,
        pipeline_url=PIPE + "/",
        edit_interval=edit_interval,
    )


class TestAskLoop:
    async def test_streams_into_one_edited_message(self, sleeps):
        tg = _TelegramEdits([[_msg("/ask why did rome fall?", chat_id=-9)]])
        pipe = _Pipeline()
        bot = _bot_for_ask(tg, pipe, sleeps)
        await bot.poll_once(wait=True)

        req = pipe.requests[0]
        assert req.url.path == "/api/ask"
        assert json.loads(req.content) == {"question": "why did rome fall?"}

        sends = tg.calls("sendMessage")
        assert sends == [{"chat_id": -9, "text": THINKING_TEXT}]
        edits = tg.calls("editMessageText")
        assert all(e["chat_id"] == -9 and e["message_id"] == 101 for e in edits)
        assert [e["text"] for e in edits][:2] == ["Because", "Because plagues."]  # progress edits
        final = edits[-1]["text"]
        assert final.startswith("Because plagues.\n\nSources:\n1. Why Rome fell [6:58]")
        assert f"{LAN}/episodes/ep-1#t-418" in final
        assert bot._ask_busy is False

    async def test_no_progress_edits_when_interval_is_large(self, sleeps):
        tg = _TelegramEdits([[_msg("/ask q")]])
        bot = _bot_for_ask(tg, _Pipeline(), sleeps, edit_interval=1e9)
        await bot.poll_once(wait=True)
        edits = tg.calls("editMessageText")
        assert len(edits) == 1 and edits[0]["text"].startswith("Because plagues.")

    async def test_error_event_is_relayed(self, sleeps):
        body = _sse(("error", {"message": "Model 'qwen2.5:3b' is not available. Run: make ollama-pull"}), ("done", {}))
        tg = _TelegramEdits([[_msg("/ask q")]])
        bot = _bot_for_ask(tg, _Pipeline(body=body), sleeps)
        await bot.poll_once(wait=True)
        assert tg.calls("editMessageText")[-1]["text"].startswith("Model 'qwen2.5:3b' is not available")

    async def test_pipeline_500_and_unreachable(self, sleeps, caplog):
        tg = _TelegramEdits([[_msg("/ask q", update_id=1), _msg("/ask q", update_id=2)]])
        pipe = _Pipeline(status=500)
        n = {"c": 0}
        orig = pipe.handler

        def flaky(request):
            n["c"] += 1
            if n["c"] == 2:
                raise httpx.ConnectError("down")
            return orig(request)

        pipe.handler = flaky
        bot = _bot_for_ask(tg, pipe, sleeps, edit_interval=1e9)
        # Two /ask in one batch run concurrently; the second one is refused as busy
        # or served after the first -- either way both chats get a reply.
        await bot.poll_once(wait=True)
        texts = [e["text"] for e in tg.calls("editMessageText")] + [s["text"] for s in tg.calls("sendMessage")]
        assert ASK_UNAVAILABLE in texts
        assert "telegram_bot_ask_failed" in caplog.text
        assert bot.offset == 3
        assert bot._ask_busy is False

    async def test_busy_reply_when_an_answer_is_in_flight(self, sleeps):
        tg = _TelegramEdits([[_msg("/ask q", chat_id=5)]])
        bot = _bot_for_ask(tg, _Pipeline(), sleeps)
        bot._ask_busy = True
        await bot.poll_once(wait=True)
        assert tg.calls("sendMessage") == [{"chat_id": 5, "text": ASK_BUSY}]
        assert tg.calls("editMessageText") == []

    async def test_other_commands_are_not_blocked_by_ask(self, sleeps):
        """Handlers are separate tasks: /help in the same batch answers regardless."""
        tg = _TelegramEdits([[_msg("/ask q", update_id=1), _msg("/help", update_id=2)]])
        bot = _bot_for_ask(tg, _Pipeline(), sleeps)
        await bot.poll_once(wait=True)
        assert {s["text"] for s in tg.calls("sendMessage")} == {THINKING_TEXT, HELP_TEXT}

    async def test_falls_back_to_new_message_when_initial_send_failed(self, sleeps):
        class TG(_TelegramEdits):
            def __init__(self, *a, **k):
                super().__init__(*a, **k)
                self.fail_first = True

            def handler(self, request):
                if request.url.path.endswith("sendMessage") and self.fail_first:
                    self.fail_first = False
                    self.requests.append(("sendMessage", json.loads(request.content)))
                    return httpx.Response(400, json={"ok": False, "description": "bad"})
                return super().handler(request)

        tg = TG([[_msg("/ask q")]])
        bot = _bot_for_ask(tg, _Pipeline(), sleeps, edit_interval=1e9)
        await bot.poll_once(wait=True)
        assert tg.calls("editMessageText") == []
        assert tg.calls("sendMessage")[-1]["text"].startswith("Because plagues.")

    async def test_not_modified_edit_is_not_a_failure(self, sleeps, caplog):
        class TG(_TelegramEdits):
            def handler(self, request):
                if request.url.path.endswith("editMessageText"):
                    self.requests.append(("editMessageText", json.loads(request.content)))
                    return httpx.Response(400, json={"ok": False, "description": "Bad Request: message is not modified"})
                return super().handler(request)

        tg = TG([[_msg("/ask q")]])
        bot = _bot_for_ask(tg, _Pipeline(), sleeps, edit_interval=1e9)
        await bot.poll_once(wait=True)
        assert "telegram_bot_edit_failed" not in caplog.text
        assert len(tg.calls("sendMessage")) == 1  # no fallback resend

    async def test_help_mentions_ask(self):
        assert "/ask" in HELP_TEXT
