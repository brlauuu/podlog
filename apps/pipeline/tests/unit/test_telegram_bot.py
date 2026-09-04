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
        body = json.loads(request.content or b"{}")
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
        assert await bot.poll_once() is False
        assert fake.requests == []
        assert sleeps == [tb.IDLE_RECHECK_SECS]
        assert "no bot token configured" in caplog.text

    async def test_empty_allowlist_means_no_network_calls(self, sleeps, caplog):
        caplog.set_level(logging.INFO)
        fake = _Telegram()
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": ""}, sleeps)
        assert await bot.poll_once() is False
        assert await bot.poll_once() is False
        assert fake.requests == []
        # Idle reason is logged once, not once per iteration.
        assert caplog.text.count("telegram_bot_idle") == 1
        assert "allowlist is empty" in caplog.text

    async def test_polls_and_replies_and_advances_offset(self, sleeps, monkeypatch):
        monkeypatch.setattr(tb, "queue_snapshot", lambda _db: _empty_snapshot(done_count=1))
        fake = _Telegram([[_msg("/queue", update_id=7), _msg("/help", user_id=9, update_id=8)]])
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)

        assert await bot.poll_once() is True
        assert await bot.poll_once() is True

        gets = fake.calls("getUpdates")
        assert "offset" not in gets[0]
        assert gets[0]["timeout"] == tb.POLL_TIMEOUT_SECS
        assert gets[0]["allowed_updates"] == ["message"]
        assert gets[1]["offset"] == 9
        sends = fake.calls("sendMessage")
        assert sends[0] == {"chat_id": 1, "text": "Queue is empty. 1 episodes done."}
        assert sends[1] == {"chat_id": 9, "text": REFUSAL_TEXT}
        assert "parse_mode" not in sends[0]
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
        await bot.poll_once()
        assert client_calls == [f"{tb.API_BASE}/bot{TOKEN}/getUpdates"]

    async def test_409_conflict_backs_off_and_keeps_going(self, sleeps, caplog):
        fake = _Telegram(status_for_get_updates=409)
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once()
        await bot.poll_once()
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
            await bot.poll_once()
        assert "telegram_bot_poll_failed" in caplog.text
        assert max(sleeps) == tb.BACKOFF_MAX_SECS
        assert sleeps[0] == tb.BACKOFF_INITIAL_SECS

    async def test_backoff_resets_after_success(self, sleeps):
        fake = _Telegram(status_for_get_updates=500)
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once()
        fake.status = 200
        await bot.poll_once()
        fake.status = 500
        await bot.poll_once()
        assert sleeps == [tb.BACKOFF_INITIAL_SECS, tb.BACKOFF_INITIAL_SECS]

    async def test_command_exception_is_reported_not_raised(self, sleeps, monkeypatch, caplog):
        def broken(_db):
            raise RuntimeError("db down")

        monkeypatch.setattr(tb, "queue_snapshot", broken)
        fake = _Telegram([[_msg("/queue")]])
        bot = _bot(fake, {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}, sleeps)
        await bot.poll_once()
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
        await bot.poll_once()
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
        await bot.poll_once()  # send fails
        fake.status = 500
        await bot.poll_once()  # poll fails
        fake.status = 409
        await bot.poll_once()  # conflict
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
        await bot.poll_once()
        assert '"status": 502' in caplog.text
        assert sleeps == [tb.BACKOFF_INITIAL_SECS]

    async def test_settings_change_takes_effect_without_restart(self, sleeps):
        fake = _Telegram([[_msg("/help", user_id=2)], [_msg("/help", user_id=2)]])
        settings = {"telegram_bot_token": TOKEN, "telegram_allowed_user_ids": "1"}
        bot = _bot(fake, settings, sleeps)
        await bot.poll_once()
        settings["telegram_allowed_user_ids"] = "1, 2"
        await bot.poll_once()
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
        await bot.poll_once()

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
        await bot.poll_once()
        assert tg.calls("sendMessage")[0]["text"] == SEARCH_UNAVAILABLE
        assert '"status": 500' in caplog.text
        assert bot.offset == 11

    async def test_web_unreachable_gives_short_reply(self, sleeps, caplog):
        tg = _Telegram([[_msg("/search x")]])

        class Down:
            def handler(self, _request):
                raise httpx.ConnectError("no route to host")

        bot = _bot_with_web(tg, Down(), sleeps)
        await bot.poll_once()
        assert tg.calls("sendMessage")[0]["text"] == SEARCH_UNAVAILABLE
        assert "telegram_bot_search_failed" in caplog.text

    async def test_help_mentions_search(self):
        assert "/search" in HELP_TEXT
