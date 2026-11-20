import mujoco
from fastapi.testclient import TestClient

from app import __version__


def test_health_reports_status_and_versions(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": __version__,
        "mujoco_version": mujoco.__version__,
    }


def test_health_allows_the_local_frontend_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "http://localhost:3000"})

    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"


def test_health_does_not_allow_unknown_origins(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://example.com"})

    assert "access-control-allow-origin" not in response.headers
