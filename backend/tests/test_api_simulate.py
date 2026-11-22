"""POST /simulate and GET /scenarios/demo."""

from typing import Any

from fastapi.testclient import TestClient

from app.demo import load_demo_scenarios
from app.demo.fixtures import DEMO_ORDER


def braking_request() -> dict[str, Any]:
    demo = load_demo_scenarios()[0]
    return {
        "scenario": demo.fixed.model_dump(mode="json"),
        "event": demo.event.model_dump(mode="json"),
    }


def test_simulate_returns_verdict_metrics_and_keyframes(client: TestClient) -> None:
    response = client.post("/simulate", json=braking_request())

    assert response.status_code == 200
    body = response.json()
    assert body["cached"] is False
    assert len(body["scenario_hash"]) == 64
    result = body["result"]
    assert result["verdict"]["status"] == "pass"
    assert [unit["id"] for unit in result["units"]] == ["pallet-1", "pallet-2", "pallet-3"]
    # One strap over each pallet and four diagonal straps from its corners.
    assert len(result["lashings"]) == 15
    assert result["keyframes"]["fps"] == 30
    frame = result["keyframes"]["frames"][0]
    assert len(frame["units"]) == 3 and len(frame["units"][0]["q"]) == 4
    assert len(frame["straps"]) == 15 and "tension_n" in frame["straps"][0]


def test_simulate_stays_within_its_cpu_budget(client: TestClient) -> None:
    """Under 1 s of CPU for a single event; stacked loads (many contacts), round cargo (MuJoCo's
    multi-contact collision for cylinders), long loads of many units (more than six units, e.g.
    eleven pallets on a 13.6 m trailer with 22 straps: 1.7 s on a GitHub Actions runner, 2.3 s on
    a busy desktop and 2.52 s on a loaded runner on 2026-11-22) and full trips (several events) get
    a budget of their own: 4 s, 2 s, 3.5 s and 0.25 s per simulated second.

    The stacked box truck took 1.8 s on a desktop and 2.5 s on a GitHub Actions runner; eight
    drums on a curtain-sider took 1.2 s on a desktop, six drums in one row with thirty lashings
    0.9 s (eight touching drums in one row took 7.9 s: keep round units a little apart)."""
    for demo in load_demo_scenarios():
        for scenario in (demo.as_loaded, demo.fixed):
            payload = {
                "scenario": scenario.model_dump(mode="json"),
                "event": demo.event.model_dump(mode="json"),
            }
            body = client.post("/simulate", json=payload).json()
            stacked = any(unit.position_m[2] > 0 for unit in scenario.units)
            round_cargo = any(unit.shape == "cylinder" for unit in scenario.units)
            many = len(scenario.units) > 6
            budget = 4.0 if stacked else 2.0 if round_cargo else 3.5 if many else 1.0
            if demo.event.kind == "full_trip":
                budget = 0.25 * body["result"]["duration_s"]
            assert body["cpu_time_s"] < budget, (scenario.id, body["cpu_time_s"])


def test_the_second_identical_request_is_served_from_the_cache(client: TestClient) -> None:
    first = client.post("/simulate", json=braking_request()).json()
    second = client.post("/simulate", json=braking_request()).json()

    assert second["cached"] is True
    assert second["scenario_hash"] == first["scenario_hash"]
    assert second["result"] == first["result"]
    assert second["cpu_time_s"] == first["cpu_time_s"]


def test_a_different_event_is_not_served_from_the_cache(client: TestClient) -> None:
    request = braking_request()
    client.post("/simulate", json=request)
    request["event"]["road_surface"] = "wet"

    body = client.post("/simulate", json=request).json()

    assert body["cached"] is False
    assert body["result"]["profile"]["road_surface"] == "wet"


def test_an_invalid_scenario_is_rejected_with_details(client: TestClient) -> None:
    request = braking_request()
    request["scenario"]["units"][0]["mass_kg"] = -5

    response = client.post("/simulate", json=request)

    assert response.status_code == 422
    assert "mass_kg" in str(response.json()["detail"])


def test_unknown_fields_are_rejected(client: TestClient) -> None:
    request = braking_request()
    request["event"]["wind"] = "strong"

    assert client.post("/simulate", json=request).status_code == 422


def test_demo_scenarios_lists_the_gallery_with_both_versions(client: TestClient) -> None:
    response = client.get("/scenarios/demo")

    assert response.status_code == 200
    scenarios = response.json()["scenarios"]
    assert [scenario["id"] for scenario in scenarios] == list(DEMO_ORDER)
    for scenario in scenarios:
        assert scenario["as_loaded"]["schema_version"] == 1
        assert scenario["fixed"]["schema_version"] == 1
        assert scenario["event"]["kind"]
        assert scenario["title"] and scenario["summary"]


def test_a_demo_scenario_can_be_posted_back_to_simulate(client: TestClient) -> None:
    demo = client.get("/scenarios/demo").json()["scenarios"][3]

    body = client.post(
        "/simulate", json={"scenario": demo["as_loaded"], "event": demo["event"]}
    ).json()

    assert body["result"]["verdict"]["status"] == "fail"
