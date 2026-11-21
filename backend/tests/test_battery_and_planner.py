"""The inspection battery and the planner: the seven situations, and a fix proven in simulation."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.explorer.draft import DraftUnit, LoadDraft
from app.inspection.battery import SITUATION_IDS, SITUATIONS, run_battery
from app.storage import create_storage
from planner.plan import plan, recommend

EXPLORER = Path(__file__).parents[2] / "frontend" / "public" / "demo" / "explorer"


def _draft(name: str) -> LoadDraft:
    return LoadDraft.model_validate(json.loads((EXPLORER / f"{name}.json").read_text())["draft"])


def test_the_battery_has_the_seven_standard_situations() -> None:
    assert SITUATION_IDS == (
        "emergency_braking",
        "lane_change",
        "sharp_curve",
        "pothole",
        "speed_bump",
        "mountain_descent",
        "long_vibration",
    )
    trips = {s.id: s.trip for s in SITUATIONS}
    assert (
        trips["emergency_braking"].speed_kmh == 80 and trips["emergency_braking"].weather == "dry"
    )
    assert trips["lane_change"].speed_kmh == 80
    assert trips["sharp_curve"].speed_kmh == 60
    assert trips["mountain_descent"].weather == "heavy_rain"
    assert trips["long_vibration"].road == "dirt"


def test_one_strap_per_pallet_fails_and_braking_is_the_worst_case() -> None:
    result = run_battery(create_storage("memory://"), _draft("emergency-braking.as_loaded"))
    assert result.total == 7
    assert result.passed < result.total
    assert result.status == "fail"
    worst = next(s for s in result.situations if s.id == result.worst)
    assert worst.status == "fail"
    assert result.worst_result.keyframes.frames, "the worst case comes with its replay"
    assert {c.code: c.status for c in result.contran_945}["four_terminals"] == "fail"
    assert len(result.axle_loads) == 2


def test_the_battery_is_cached_by_input() -> None:
    storage = create_storage("memory://")
    first = run_battery(storage, _draft("default"))
    again = run_battery(storage, _draft("default"))
    assert [s.scenario_hash for s in first.situations] == [
        s.scenario_hash for s in again.situations
    ]
    assert again.cpu_time_s < first.cpu_time_s


def test_the_recommendation_follows_the_rules_without_simulating() -> None:
    # Ropes (art. 4 §3) become straps; a load with gaps is pushed against the headboard (art. 7).
    fixed, changes = recommend(_draft("rope-lashing.as_loaded"))
    codes = [c.code for c in changes]
    assert codes[:2] == ["replace_rope", "close_gaps"]
    assert fixed.restraint != "rope"
    front = max(u.x_m for u in fixed.units)
    assert front == pytest.approx(6.2 / 2 - 1.2 / 2)  # touching the headboard


def test_an_overloaded_axle_moves_the_load() -> None:
    fixed, changes = recommend(_draft("weigh-station.as_loaded"))
    assert changes[0].code == "balance_axles"
    assert fixed.units[0].x_m > _draft("weigh-station.as_loaded").units[0].x_m


def test_the_planner_never_removes_straps() -> None:
    draft = LoadDraft(
        units=[DraftUnit(id="p1", cargo="wood_pallet", x_m=2.5, y_m=0, straps=3)],
    )
    fixed, _ = recommend(draft)
    assert fixed.units[0].straps >= 3


@pytest.mark.parametrize("name", ["emergency-braking.as_loaded", "steel-coil.as_loaded"])
def test_the_fix_is_proven_through_the_whole_battery(name: str) -> None:
    result = plan(create_storage("memory://"), _draft(name))
    assert result.verified
    assert result.battery is not None
    assert result.battery.passed == result.battery.total == 7
    assert all(c.status != "fail" for c in result.battery.contran_945)
    assert result.changes, "a failing load needs at least one change"


def test_a_load_that_passes_needs_no_change() -> None:
    storage = create_storage("memory://")
    fixed = plan(storage, _draft("emergency-braking.as_loaded")).draft
    again = plan(storage, fixed)
    assert again.verified and again.changes == [] and again.rounds == 0


def test_battery_and_plan_endpoints(client: TestClient) -> None:
    draft = _draft("emergency-braking.as_loaded").model_dump(mode="json")
    battery = client.post("/battery", json={"draft": draft})
    assert battery.status_code == 200
    body = battery.json()
    assert body["total"] == 7 and body["passed"] < 7
    assert body["recommendation"]["changes"]
    assert "keyframes" in body["worst_result"]
    fixed = client.post("/plan", json={"draft": draft})
    assert fixed.status_code == 200
    assert fixed.json()["verified"] is True
    unloadable = {**draft, "units": [{**draft["units"][0], "x_m": 9.0}]}
    assert client.post("/battery", json={"draft": unloadable}).status_code == 422
