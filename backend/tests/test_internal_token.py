"""The container answers only the Worker: with a token configured, requests without it are refused.

Cloudflare gives a container no public address (it is reached through its Durable Object), so
this is defence in depth: even a request that somehow reached the port would be turned away.
"""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import INTERNAL_HEADER, create_app


def _client(token: str) -> TestClient:
    return TestClient(create_app(Settings(storage_url="memory://", internal_token=token)))


def test_requests_without_the_token_are_refused() -> None:
    with _client("s3cret-token") as client:
        for method, path in (("get", "/health"), ("get", "/scenarios/demo"), ("post", "/simulate")):
            response = getattr(client, method)(path)
            assert response.status_code == 403, path
            assert response.json()["detail"]["code"] == "forbidden"


def test_a_wrong_token_is_refused() -> None:
    with _client("s3cret-token") as client:
        response = client.get("/health", headers={INTERNAL_HEADER: "guess"})
        assert response.status_code == 403


def test_the_worker_token_is_accepted() -> None:
    with _client("s3cret-token") as client:
        response = client.get("/health", headers={INTERNAL_HEADER: "s3cret-token"})
        assert response.status_code == 200


def test_without_a_configured_token_the_api_is_open_for_local_use() -> None:
    with _client("") as client:
        assert client.get("/health").status_code == 200
