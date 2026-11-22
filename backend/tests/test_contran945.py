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
    # The gallery's braking example leaves 0.5 m to the headboard and 0.4 m between pallets:
    # top-over straps alone fail, its fixed version (diagonal straps added) passes.
    assert _status(_draft("emergency-braking.as_loaded"), "diagonals_for_gaps") == "fail"
    assert _status(_draft("emergency-braking.fixed"), "diagonals_for_gaps") == "pass"
    assert _status(_draft("dirt-road.fixed"), "diagonals_for_gaps") == "pass"  # diagonals
    assert _status(_pallets_against_headboard(straps=2), "diagonals_for_gaps") == "pass"


def test_cargo_above_the_headboard_must_not_be_able_to_slide_forward() -> None:
    # 2.2 m cabinets over a 1.2 m flatbed headboard, held only by top-over straps.
    cabinets = _draft("sharp-curve.fixed").model_copy(update={"restraint": "top_over"})
    assert _status(cabinets, "above_headboard") == "fail"
    assert _status(_pallets_against_headboard(straps=2), "above_headboard") == "pass"
    # The gallery's fixed version adds diagonal straps.
    assert _status(_draft("sharp-curve.fixed"), "above_headboard") == "pass"


@pytest.mark.parametrize("name", ["box-truck.fixed", "steel-coil.fixed"])
def test_loads_held_by_walls_or_blocks_are_not_judged_on_lashings(name: str) -> None:
    assert _status(_draft(name), "safety_factor") == "not_applicable"


def test_art7_sole_paragraph_open_body_needs_diagonals_even_without_a_gap() -> None:
    # CONTRAN 945/2022 art. 7 sole paragraph: vehicles without containment panels need diagonal
    # devices whatever the gap. Pallets touching the headboard with top-over straps only: fail.
    flush = _pallets_against_headboard(straps=2)
    assert _status(flush, "diagonals_for_gaps") == "pass"
    assert _status(flush, "diagonals_open_body") == "fail"
    assert _status(_pallets_against_headboard(2, "direct"), "diagonals_open_body") == "pass"
    assert _status(_pallets_against_headboard(2, "blocking"), "diagonals_open_body") == "pass"
    # A box body's walls contain the load: the paragraph does not apply.
    assert _status(_draft("box-truck.fixed"), "diagonals_open_body") == "not_applicable"


def test_art7_sole_paragraph_is_a_rule_not_physics() -> None:
    # Missing diagonals make the load "holds, but out of compliance", never "does not arrive".
    from app.inspection.verdict import verdict_of
    from rules.country import rule_set

    draft = _pallets_against_headboard(straps=2)
    scenario, _ = build_draft(draft)
    rules = rule_set(scenario, draft, draft.country).model_dump()
    held = {"id": "emergency_braking", "findings": [], "severity": 0.0}
    battery = {"situations": [held], "country": "BR", "rules": {"BR": rules}}
    verdict = verdict_of(battery)
    assert verdict.state == "holds_noncompliant"
    assert verdict.main_problem is not None
    assert verdict.main_problem.article == "CONTRAN 945/2022, Art. 7 sole paragraph"


def test_art5_four_terminals_apply_to_a_single_unit_too() -> None:
    # CONTRAN 945/2022 art. 5: "each unit" on an open body, a lone machine as well.
    one = LoadDraft(units=[DraftUnit(id="m", cargo="machine", x_m=1.0, y_m=0, straps=1)])
    assert _status(one, "four_terminals") == "fail"
    two = LoadDraft(units=[DraftUnit(id="m", cargo="machine", x_m=1.0, y_m=0, straps=2)])
    assert _status(two, "four_terminals") == "pass"
    # Blocking is not an exemption either: a coil in a cradle with no lashing has 0 terminals.
    cradle = LoadDraft(
        restraint="cradle", units=[DraftUnit(id="c", cargo="steel_coil", x_m=1.0, y_m=0)]
    )
    assert _status(cradle, "four_terminals") == "fail"


def test_art8_headboard_strength_is_asked_when_cargo_leans_on_it() -> None:
    # CONTRAN 945/2022 art. 8 caput: a front panel used as a stop must be strong enough. The
    # text has no figure, so an unrated flatbed headboard is "to confirm", never a failure.
    flush = _pallets_against_headboard(straps=2)
    scenario, _ = build_draft(flush)
    check = next(c for c in check_contran_945(scenario) if c.code == "headboard_strength")
    assert check.status == "to_confirm"
    assert set(check.unit_ids) == {"p1", "p2", "p3"}  # the whole row leans on it
    # Demand: (0.8 - mu) m g of the row (EN 12195-1 forward value, our choice for Brazil).
    assert check.values["demand_n"] > 0
    # Diagonals hold the row: the headboard is not used as a stop.
    assert _status(_pallets_against_headboard(2, "direct"), "headboard_strength") == (
        "not_applicable"
    )
    # A body with an EN 12642 code: its rating is compared with the demand.
    rated = flush.model_copy(update={"truck": flush.truck.model_copy(update={"body_code": "XL"})})
    assert _status(rated, "headboard_strength") in ("pass", "fail")
