"""CONTRAN Resolution 945/2022: every check, with a passing and a failing load."""

import json
from pathlib import Path

import pytest

from app.explorer import build_draft
from app.explorer.draft import DraftUnit, LoadDraft
from rules.contran945 import check_contran_945

EXPLORER = Path(__file__).parents[2] / "frontend" / "public" / "demo" / "explorer"


def _draft(name: str) -> LoadDraft:
    return LoadDraft.model_validate(json.loads((EXPLORER / f"{name}.json").read_text())["draft"])


def _status(draft: LoadDraft, code: str, **options: bool) -> str:
    scenario, _ = build_draft(draft)
    checks = {str(check.code): check for check in check_contran_945(scenario, **options)}
    return checks[code].status


def _pallets_against_headboard(straps: int, restraint: str = "top_over") -> LoadDraft:
    # Three 1.2 m pallets on a toco (6.2 m), front one touching the headboard, no gaps.
    units = [
        DraftUnit(id=f"p{n + 1}", cargo="wood_pallet", x_m=2.5 - 1.2 * n, y_m=0, straps=straps)
        for n in range(3)
    ]
    return LoadDraft(restraint=restraint, units=units)


def test_ropes_are_prohibited() -> None:
    assert _status(_draft("rope-lashing.as_loaded"), "devices_allowed") == "fail"
    assert _status(_draft("rope-lashing.fixed"), "devices_allowed") == "pass"


def test_lashings_rated_for_twice_the_weight() -> None:
    # A 6000 kg machine needs 12,000 daN of working capacity: 4 chains of 4000 daN pass...
    assert _status(_draft("weigh-station.fixed"), "safety_factor") == "pass"
    # ...one 2500 daN strap over a 6000 kg machine does not.
    one_strap = LoadDraft(units=[DraftUnit(id="m", cargo="machine", x_m=1.0, y_m=0, straps=1)])
    assert _status(one_strap, "safety_factor") == "fail"


def test_split_cargo_needs_four_terminals_per_unit() -> None:
    assert _status(_pallets_against_headboard(straps=1), "four_terminals") == "fail"
    assert _status(_pallets_against_headboard(straps=2), "four_terminals") == "pass"


def test_anchoring_on_the_wooden_floor_fails() -> None:
    draft = _pallets_against_headboard(straps=2)
    assert _status(draft, "anchoring") == "pass"
    assert _status(draft, "anchoring", anchored_on_wood=True) == "fail"


def test_a_load_with_room_to_travel_needs_diagonals() -> None:
    # The gallery's braking example leaves 0.5 m to the headboard and 0.4 m between pallets.
    assert _status(_draft("emergency-braking.fixed"), "diagonals_for_gaps") == "fail"
    assert _status(_draft("dirt-road.fixed"), "diagonals_for_gaps") == "pass"  # diagonals
    assert _status(_pallets_against_headboard(straps=2), "diagonals_for_gaps") == "pass"


def test_cargo_above_the_headboard_must_not_be_able_to_slide_forward() -> None:
    # 2.2 m cabinets over a 1.2 m flatbed headboard, held only by top-over straps.
    assert _status(_draft("sharp-curve.fixed"), "above_headboard") == "fail"
    assert _status(_pallets_against_headboard(straps=2), "above_headboard") == "pass"
    cabinets = _draft("sharp-curve.fixed").model_copy(update={"restraint": "direct"})
    assert _status(cabinets, "above_headboard") == "pass"


@pytest.mark.parametrize("name", ["box-truck.fixed", "steel-coil.fixed"])
def test_loads_held_by_walls_or_blocks_are_not_judged_on_lashings(name: str) -> None:
    assert _status(_draft(name), "safety_factor") == "not_applicable"
