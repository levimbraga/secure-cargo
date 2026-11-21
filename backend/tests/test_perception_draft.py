"""Photo analysis -> load draft: scale from the confirmed truck, packing, straps, and weights."""

import pytest
from fastapi.testclient import TestClient

from app.explorer import build_draft
from app.explorer.build import TRUCKS
from app.explorer.config import Size
from app.explorer.draft import DraftTruck
from perception.draft import PhotoAnalysis, Weight, analysis_to_draft


def _unit(number: int, along: float, across: float = 0.5, **extra: object) -> dict[str, object]:
    return {
        "number": number,
        "cargo": "wood_pallet",
        "length_m": 1.2,
        "width_m": 1.0,
        "height_m": 1.1,
        "along": along,
        "across": across,
        "stacked_on": None,
        "photo": 0,
        "box": [0.1, 0.1, 0.3, 0.6],
        "confidence": 0.8,
        "uncertain": "",
        **extra,
    }


def _analysis(
    units: list[dict[str, object]], restraints: list[dict[str, object]] | None = None
) -> PhotoAnalysis:
    return PhotoAnalysis.model_validate(
        {"is_truck_load": True, "units": units, "restraints": restraints or [], "violations": []}
    )


TOCO = DraftTruck(body="flatbed", size="toco")


def test_positions_use_the_confirmed_bed_as_scale() -> None:
    # "along" 0.5 is mid-bed: on a toco (6.2 m) that is x = 0; on a semi (12.4 m) too, but a
    # unit at along 0.1 lands 0.62 m vs 1.24 m behind the headboard line.
    analysis = _analysis([_unit(1, along=0.1)])
    toco = analysis_to_draft(analysis, TOCO).draft.units[0]
    semi = analysis_to_draft(analysis, DraftTruck(body="flatbed", size="semi")).draft.units[0]
    assert toco.x_m == pytest.approx(TRUCKS[Size.TOCO].length_m / 2 - 0.62, abs=0.6)
    assert semi.x_m == pytest.approx(TRUCKS[Size.SEMI].length_m / 2 - 1.24, abs=0.6)
    assert semi.x_m > toco.x_m


def test_overlapping_guesses_are_packed_into_a_load_that_builds() -> None:
    # The model put three pallets almost on the same spot.
    analysis = _analysis([_unit(1, 0.2), _unit(2, 0.22), _unit(3, 0.25)])
    result = analysis_to_draft(analysis, TOCO)
    scenario, _ = build_draft(result.draft)  # would raise on an overlap
    assert len(scenario.units) == 3
    assert {link.number for link in result.links} == {1, 2, 3}


def test_units_that_cannot_fit_are_dropped_with_a_warning() -> None:
    analysis = _analysis([_unit(n, min(0.05 * n, 1.0)) for n in range(1, 20)])
    result = analysis_to_draft(analysis, DraftTruck(body="flatbed", size="vuc"))
    assert "unit_dropped" in result.warnings
    build_draft(result.draft)


def test_straps_follow_the_photo_within_the_lashing_points() -> None:
    analysis = _analysis(
        [_unit(1, 0.1), _unit(2, 0.4)],
        [{"kind": "strap", "count": 3, "routing": "top_over", "units": [1, 2]}],
    )
    draft = analysis_to_draft(analysis, TOCO).draft
    assert draft.restraint == "top_over"
    assert sorted(u.straps for u in draft.units) == [1, 2]
    too_many = _analysis([_unit(1, 0.1)], [{"kind": "strap", "count": 9, "units": [1]}])
    result = analysis_to_draft(too_many, TOCO)
    assert "straps_reduced" in result.warnings
    build_draft(result.draft)


def test_ropes_and_wooden_anchoring_are_carried_into_the_rule_checks() -> None:
    analysis = PhotoAnalysis.model_validate(
        {
            "units": [_unit(1, 0.1)],
            "restraints": [{"kind": "rope", "count": 2, "routing": "top_over", "units": [1]}],
            "violations": [{"code": "anchored_on_wood", "units": [1], "confidence": 0.8}],
        }
    )
    draft = analysis_to_draft(analysis, TOCO).draft
    assert draft.restraint == "rope"
    assert draft.anchored_on_wood


def test_a_stacked_unit_stands_on_its_base() -> None:
    analysis = _analysis([_unit(1, 0.1), _unit(2, 0.1, stacked_on=1)])
    draft = analysis_to_draft(analysis, TOCO).draft
    top = next(u for u in draft.units if u.on)
    assert top.on == "u1"
    scenario, _ = build_draft(draft)
    assert max(u.position_m[2] for u in scenario.units) == pytest.approx(1.1)


# --- weights ------------------------------------------------------------------------------


def test_without_the_users_weight_no_unit_gets_one() -> None:
    # The model "saw" weights; they are not part of the analysis and must not appear.
    analysis = _analysis([_unit(1, 0.1, mass_kg=900, weight=1000), _unit(2, 0.4)])
    draft = analysis_to_draft(analysis, TOCO).draft
    assert all(u.mass_kg is None for u in draft.units)


def test_the_total_is_split_by_volume_and_adds_up_exactly() -> None:
    analysis = _analysis([_unit(1, 0.1), _unit(2, 0.4, height_m=2.2)])
    draft = analysis_to_draft(analysis, TOCO, Weight(total_kg=1501)).draft
    masses = {u.id: u.mass_kg for u in draft.units}
    assert sum(m or 0 for m in masses.values()) == 1501
    assert masses["u2"] == pytest.approx(2 * (masses["u1"] or 0), abs=1)


def test_weights_per_unit_are_taken_as_given() -> None:
    analysis = _analysis([_unit(1, 0.1), _unit(2, 0.4)])
    draft = analysis_to_draft(analysis, TOCO, Weight(per_unit_kg={1: 700, 2: 450})).draft
    assert [u.mass_kg for u in draft.units] == [700, 450]


def test_endpoint(client: TestClient) -> None:
    body = {
        "analysis": {"units": [_unit(1, 0.1)], "restraints": [], "violations": []},
        "truck": {"body": "flatbed", "size": "toco"},
        "weight": {"total_kg": 900},
    }
    response = client.post("/perception/draft", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["draft"]["units"][0]["mass_kg"] == 900
    assert data["links"][0]["unit_id"] == "u1"
