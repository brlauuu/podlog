"""Unit tests for check_model_available — the Ollama model probe."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


class TestCheckModelAvailable:
    def test_model_found(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [{"name": "qwen2.5:3b"}, {"name": "llama3:8b"}]
        }

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is True

    def test_model_not_found(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "models": [{"name": "llama3:8b"}]
        }

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False

    def test_ollama_unreachable(self):
        from app.services.rag import check_model_available

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.side_effect = Exception("Connection refused")
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False

    def test_ollama_non_200(self):
        from app.services.rag import check_model_available
        mock_resp = MagicMock()
        mock_resp.status_code = 500

        with patch("app.services.rag.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            result = asyncio.run(check_model_available("qwen2.5:3b"))
            assert result is False
