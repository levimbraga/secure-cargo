"""The inspection battery and the planner: the seven situations, and a fix proven in simulation."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.explorer import build_draft
from app.explorer.config import Restraint
from app.explorer.draft import DraftUnit, LoadDraft
from app.inspection.battery import SITUATION_IDS, SITUATIONS, run_battery
from app.storage import create_storage
from planner.plan import _candidates, plan, recommend

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
    # Ropes (art. 4 §3) become straps. The crates stand taller than the headboard, so pushing
    # them against it breaks art. 8: diagonals alone close art. 7, without moving anything.
    draft = _draft("rope-lashing.as_loaded")
    fixed, changes = recommend(draft)
    codes = [c.code for c in changes]
    assert codes[0] == "replace_rope"
    assert "close_gaps" not in codes
    assert fixed.restraint == "direct"
    assert [u.x_m for u in fixed.units] == [u.x_m for u in draft.units]


def test_a_load_with_room_against_the_headboard_is_pushed_not_rerouted() -> None:
    # Pallets with a gap: pushing them forward (effort 1) is cheaper than diagonals (effort 4).
    fixed, changes = recommend(_draft("emergency-braking.as_loaded"))
    codes = [c.code for c in changes]
    assert "close_gaps" in codes
    assert fixed.restraint != "direct"


@pytest.mark.parametrize("name", [p.name.split(".")[0] for p in EXPLORER.glob("*.as_loaded.json")])
def test_moving_and_switching_to_diagonals_are_never_both_the_first_try(name: str) -> None:
    candidates = _candidates(_draft(f"{name}.as_loaded"))
    efforts = [c.effort for c in candidates]
    assert efforts == sorted(efforts), "candidates are tried in order of effort"
    names = [c.name for c in candidates]
    for combined in ("move+direct", "move+chain"):
        if combined in names:
            assert names.index(combined.split("+")[1]) < names.index(combined)


def test_a_step_that_is_not_needed_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    import planner.plan as planner

    draft = _draft("emergency-braking.as_loaded")
    moved, _ = planner._placement(draft, build_draft(draft)[0])
    both = planner._Candidate(
        "move+direct", planner._with_straps(moved, {}, Restraint.DIRECT), steps=("move", "direct")
    )
    alone = planner._Candidate(
        "direct", planner._with_straps(draft, {}, Restraint.DIRECT), steps=("direct",)
    )
    # Listed in the wrong order on purpose: the search must still end with the smaller set.
    monkeypatch.setattr(planner, "_candidates", lambda _: [both, alone])
    monkeypatch.setattr(planner, "_on_paper", lambda _: True)
    monkeypatch.setattr(planner, "_holds", lambda *_: True)
    result = planner.plan(create_storage("memory://"), draft)
    assert result.draft == alone.draft
    assert "close_gaps" not in [c.code for c in result.changes]


def test_edge_protectors_are_advised_under_straps_over_fragile_cargo() -> None:
    _, changes = recommend(_draft("dirt-road.as_loaded"))
    assert "edge_protectors" in [c.code for c in changes]
    _, coil = recommend(_draft("steel-coil.as_loaded"))
    assert "edge_protectors" not in [c.code for c in coil]


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
    assert result.battery.verdict.state == "approved"
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


def test_an_overweight_load_is_not_simulated_in_vain() -> None:
    heavy = LoadDraft(
        truck={"body": "flatbed", "size": "toco"},
        units=[DraftUnit(id="m", cargo="machine", x_m=0.0, y_m=0, mass_kg=12_000)],
    )
    result = plan(create_storage("memory://"), heavy)
    assert not result.verified
    assert [c.code for c in result.changes] == ["overweight"]
    assert result.rounds == 0


def test_the_parallel_pieces_add_up_to_the_battery(client: TestClient) -> None:
    draft = _draft("emergency-braking.as_loaded").model_dump(mode="json")
    whole = client.post("/battery", json={"draft": draft}).json()
    one = client.post(
        "/battery/situation", json={"draft": draft, "situation": "emergency_braking"}
    ).json()
    assert one["situation"] == next(
        s for s in whole["situations"] if s["id"] == "emergency_braking"
    )
    assert one["result"]["keyframes"]["frames"]
    checks = client.post("/battery/checks", json={"draft": draft}).json()
    assert checks["contran_945"] == whole["contran_945"]
    assert checks["axle_loads"] == whole["axle_loads"]
    assert checks["recommendation"] == whole["recommendation"]
    options = client.post("/plan/candidates", json={"draft": draft}).json()
    assert options["infeasible"] is None
    assert 1 <= len(options["candidates"]) <= 5
    assert options["candidates"][0]["changes"]


SAMPLES = Path(__file__).parents[2] / "frontend" / "public" / "demo" / "samples"


def _heavy_pipes() -> LoadDraft:
    """The steel pipes sample: one 18 t bundle on a semi-trailer, as the photo was read."""
    sample = json.loads((SAMPLES / "steel-pipes.json").read_text())
    return LoadDraft.model_validate(sample["battery"]["draft"])


def test_each_set_of_diagonals_adds_four_lashings() -> None:
    draft = LoadDraft(
        restraint=Restraint.CHAIN,
        units=[DraftUnit(id="m1", cargo="machine", x_m=1.0, y_m=0, diagonal_sets=2)],
    )
    scenario, _ = build_draft(draft)
    chains = [lashing for lashing in scenario.lashings if lashing.unit_id == "m1"]
    assert len(chains) == 8
    assert len({lashing.id for lashing in chains}) == 8


def test_a_heavy_unit_gets_chains_until_twice_its_weight_is_held() -> None:
    from rules.contran945 import check_contran_945

    draft = _heavy_pipes()
    candidates = {c.name: c for c in _candidates(draft)}
    chained = candidates["chain"].draft
    assert chained.units[0].diagonal_sets > 1
    scenario, _ = build_draft(chained)
    factor = next(c for c in check_contran_945(scenario) if c.code == "safety_factor")
    assert factor.status == "pass"
    codes = [change.code for change in candidates["chain"].changes]
    assert "diagonal_sets" in codes


def test_light_loads_keep_one_set_of_diagonals() -> None:
    for candidate in _candidates(_draft("emergency-braking.as_loaded")):
        assert all(unit.diagonal_sets == 1 for unit in candidate.draft.units)


def test_the_heavy_pipes_are_fixed_and_comply() -> None:
    result = plan(create_storage("memory://"), _heavy_pipes())
    assert result.verified
    assert result.battery is not None
    assert result.battery.verdict.state == "approved"
