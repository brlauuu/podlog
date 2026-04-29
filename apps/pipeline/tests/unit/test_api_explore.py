"""Tests for the explore status endpoint (#607 PR 2)."""
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.api.explore import get_explore_status


class _FakeResp:
    def __init__(self, status_code: int):
        self.status_code = status_code


@pytest.mark.asyncio
async def test_returns_running_true_when_probe_succeeds():
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=_FakeResp(200))
    fake_client.__aenter__.return_value = fake_client
    fake_client.__aexit__.return_value = False

    with patch("app.api.explore.httpx.AsyncClient", return_value=fake_client):
        result = await get_explore_status()

    assert result["running"] is True
    assert result["url"] == "http://localhost:8888/lab"
    assert result["error"] is None


@pytest.mark.asyncio
async def test_returns_running_false_on_connect_error():
    """The most common case: container not running, DNS for `explore` fails."""
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectError("DNS failure"))
    fake_client.__aenter__.return_value = fake_client
    fake_client.__aexit__.return_value = False

    with patch("app.api.explore.httpx.AsyncClient", return_value=fake_client):
        result = await get_explore_status()

    assert result["running"] is False
    assert result["url"] is None
    # The underlying error is intentionally not surfaced — UI doesn't need it.
    assert result["error"] is None


@pytest.mark.asyncio
async def test_returns_running_false_on_timeout():
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectTimeout("timeout"))
    fake_client.__aenter__.return_value = fake_client
    fake_client.__aexit__.return_value = False

    with patch("app.api.explore.httpx.AsyncClient", return_value=fake_client):
        result = await get_explore_status()

    assert result["running"] is False


@pytest.mark.asyncio
async def test_treats_5xx_as_running_to_avoid_false_negatives():
    """A 5xx means the service is reachable but in a bad state. We still
    surface a link so the user can investigate directly rather than seeing
    'not running' and being misled."""
    fake_client = AsyncMock()
    fake_client.get = AsyncMock(return_value=_FakeResp(503))
    fake_client.__aenter__.return_value = fake_client
    fake_client.__aexit__.return_value = False

    with patch("app.api.explore.httpx.AsyncClient", return_value=fake_client):
        result = await get_explore_status()

    assert result["running"] is True
    assert result["url"] == "http://localhost:8888/lab"
