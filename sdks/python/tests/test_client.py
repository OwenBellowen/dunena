"""Tests for the Dunena Python SDK."""

import pytest
from dunena import Dunena, DunenaError, NotFoundError


class TestDunenaClient:
    def test_init_default(self):
        client = Dunena()
        assert client._client.base_url == "http://localhost:3000"
        client.close()

    def test_init_with_token(self):
        client = Dunena(token="secret")
        assert client._client.headers["authorization"] == "Bearer secret"
        client.close()

    def test_context_manager(self):
        with Dunena() as client:
            assert client is not None

    def test_db_namespace(self):
        with Dunena() as client:
            assert hasattr(client, "db")
            assert hasattr(client.db, "get")
            assert hasattr(client.db, "set")

    def test_public_api(self):
        with Dunena() as client:
            for m in ["get", "set", "delete", "mget", "mset", "keys", "stats", "flush", "health", "info"]:
                assert hasattr(client, m)


class TestExceptions:
    def test_base_error(self):
        err = DunenaError("test", 500)
        assert err.status_code == 500

    def test_not_found(self):
        err = NotFoundError("missing", 404)
        assert isinstance(err, DunenaError)
