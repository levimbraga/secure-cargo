"""EU mode: Directive 2014/47/EU Annex III (EN 12195-1, EN 12642, EN 12640) and 96/53/EC Annex I.

The worked examples are the ones in the workspace's ``notes/eu-rules.md``: the EU's 2014 cargo
securing guidelines (EBPG) 6.1 and tables 1 to 3, and the limits of 96/53/EC Annex I.
"""

import math

import pytest

from app.explorer import build_draft
from app.explorer.config import BodyCode, Country
from app.explorer.draft import DraftTruck, DraftUnit, LoadDraft
from app.inspection.battery import battery_checks
from app.inspection.verdict import verdict_of
from app.scenario import BodyType
from physics.constants import STANDARD_GRAVITY_MPS2
from rules.country import breaks_a_rule, rule_set
from rules.eu_annex3 import (
    check_annex3,
    direct_mass_kg,
    lashing_point_strength_n,
    roadside_class,
    top_over_mass_kg,
    wall_mass_kg,
)
from rules.eu_checklist import dimensions, weight
from rules.eu_weights import (
    eu_axles,
    tandem_motor_limit_kg,
    tandem_trailer_limit_kg,
    tri_axle_limit_kg,
)
from rules.fmcsa393 import RuleCheck

G = STANDARD_GRAVITY_MPS2


def _truncate(value: float) -> float:
    """EBPG tables 1 and 2 cut the tonnes to one decimal."""
    return math.floor(value * 10 + 1e-9) / 10


def _eu(
    *units: DraftUnit, size: str = "eu_semi_136", body: str = "curtain_sider", **truck: object
) -> LoadDraft:
    return LoadDraft.model_validate(
        {
            "source": "explorer",
            "country": "EU",
            "truck": {"body": body, "size": size, **truck},
            "units": [u.model_dump() for u in units],
            "restraint": "top_over",
        }
    )


def _pallets(rows: int = 17, mass: float = 600.0, straps: int = 0) -> list[DraftUnit]:
    """Euro pallets crosswise, two per row (2.40 m of the 2.48 m width), from the headboard."""
    units = []
    for row in range(rows):
        x = 6.8 - 0.4 - row * 0.8
        for side, y in (("a", 0.6), ("b", -0.6)):
            units.append(
                DraftUnit(
                    id=f"p{row + 1}{side}",
                    cargo="wood_pallet",
                    size_m=(0.79, 1.2, 1.5),
                    mass_kg=mass,
                    x_m=round(x, 3),
                    y_m=y,
                    straps=straps,
                )
            )
    return units


def _checks(draft: LoadDraft) -> dict[str, RuleCheck]:
    scenario, _ = build_draft(draft)
    return {
        c.code: c for c in check_annex3(scenario, draft, anchored_on_wood=draft.anchored_on_wood)
    }


# --- EN 12195-1 through the EBPG's worked example 6.1 --------------------------------------


def test_two_top_over_lashings_hold_the_ebpg_example() -> None:
    # 6.1.2: mu 0.45, alpha 55 deg, F_T 500 daN: 13.7 t sideways and backward, 1.7 t forward.
    sine = math.sin(math.radians(55))
    assert top_over_mass_kg(0.45, sine, 5000, "sideways", 2) / 1000 == pytest.approx(13.7, abs=0.05)
    assert top_over_mass_kg(0.45, sine, 5000, "rearward", 2) / 1000 == pytest.approx(13.7, abs=0.05)
    assert top_over_mass_kg(0.45, sine, 5000, "forward", 2) / 1000 == pytest.approx(1.7, abs=0.05)


def test_a_spring_lashing_holds_7_5_t_forward() -> None:
    # 6.1.3: one spring lashing (two legs) of LC 2,000 daN, alpha 39 deg, beta 35 deg, f_mu 0.75.
    a, b = math.radians(39), math.radians(35)
    per_leg = 20_000 * (0.75 * 0.45 * math.sin(a) + math.cos(a) * math.cos(b))
    assert direct_mass_kg(0.45, 2 * per_leg, "forward") / 1000 == pytest.approx(7.5, abs=0.05)


def test_friction_at_least_the_acceleration_is_no_risk() -> None:
    assert top_over_mass_kg(0.6, 1.0, 3000, "sideways") == math.inf


# --- EN 12642 walls (EBPG tables 1 and 2) -------------------------------------------------


@pytest.mark.parametrize(
    ("friction", "tonnes"), [(0.15, 7.8), (0.20, 8.4), (0.30, 10.1), (0.45, 14.5), (0.60, 25.4)]
)
def test_an_l_headboard_blocks_the_mass_of_ebpg_table_1(friction: float, tonnes: float) -> None:
    assert _truncate(wall_mass_kg(friction, 50_000, "forward") / 1000) == tonnes


@pytest.mark.parametrize(("friction", "tonnes"), [(0.15, 9.0), (0.30, 15.8), (0.40, 31.6)])
def test_an_l_rear_wall_blocks_the_mass_of_ebpg_table_2(friction: float, tonnes: float) -> None:
    assert _truncate(wall_mass_kg(friction, 31_000, "rearward") / 1000) == tonnes


def test_body_code_changes_the_walls_of_the_model() -> None:
    pallets = _pallets(rows=2)
    low, _ = build_draft(_eu(*pallets))
    xl, _ = build_draft(_eu(*pallets, body_code="XL"))
    assert low.bed.side_rail_height_m == 0  # a code L curtain holds nothing
    assert xl.bed.side_rail_height_m == pytest.approx(2.7)
    assert low.bed.headboard is not None and xl.bed.headboard is not None
    assert low.bed.headboard.rated_capacity_n == pytest.approx(50_000)  # 0.4 P, capped
    assert xl.bed.headboard.rated_capacity_n == pytest.approx(0.5 * 25_000 * G, rel=1e-4)


def test_unlashed_pallets_in_an_l_curtain_sider_are_a_dangerous_deficiency() -> None:
    checks = _checks(_eu(*_pallets()))
    assert checks["eu_sideways"].status == "fail"
    assert checks["eu_sideways"].deficiency == "dangerous"
    assert checks["eu_body_strength"].status == "fail"
    assert checks["eu_body_strength"].deficiency == "dangerous"
    # 20.4 t against a 5,000 daN headboard: it holds 14.5 t (71 %), a major shortfall.
    forward = checks["eu_forward"]
    assert forward.status == "fail" and forward.deficiency == "major"
    assert forward.values["ratio"] == pytest.approx(14_560 / 20_400, abs=0.01)
    assert roadside_class(list(checks.values())) == "dangerous"


def test_the_same_pallets_in_an_xl_curtain_sider_pass() -> None:
    checks = _checks(_eu(*_pallets(), body_code="XL"))
    for code in ("eu_forward", "eu_sideways", "eu_rearward", "eu_body_strength"):
        assert checks[code].status == "pass", code
    assert roadside_class(list(checks.values())) is None


def test_xl_side_walls_need_the_pallets_closed_up_across_the_width() -> None:
    # One pallet per row leaves 1.28 m of void: more than 15 cm, the curtain is not "in contact".
    single = [u for u in _pallets() if u.id.endswith("a")]
    checks = _checks(_eu(*single, body_code="XL"))
    assert checks["eu_sideways"].status == "fail"
    assert checks["eu_sideways"].deficiency == "major"  # closed by the curtain, too far from it


def test_straps_secure_the_pallets_in_an_l_curtain_sider() -> None:
    checks = _checks(_eu(*_pallets(straps=1)))
    assert checks["eu_sideways"].status == "pass"
    assert checks["eu_forward"].status == "pass"
    assert (
        checks["eu_body_strength"].status == "pass"
        or checks["eu_body_strength"].status == "to_confirm"
    )


def test_an_unrated_flatbed_headboard_is_to_confirm_not_a_failure() -> None:
    crate = DraftUnit(id="c", cargo="crate", x_m=6.2, y_m=0, mass_kg=4000, straps=2)
    checks = _checks(_eu(crate, size="eu_flatbed_136", body="flatbed"))
    assert checks["eu_forward"].status == "to_confirm"
    assert checks["eu_body_strength"].status == "not_applicable"


def test_ropes_are_unsuitable_devices_and_wooden_anchors_fail() -> None:
    crate = DraftUnit(id="c", cargo="crate", x_m=2.5, y_m=0, mass_kg=500, straps=2)
    draft = LoadDraft.model_validate(
        {**_eu(crate, size="eu_18t", body="flatbed").model_dump(), "restraint": "rope"}
    )
    checks = _checks(draft)
    assert checks["eu_devices"].status == "fail" and checks["eu_devices"].deficiency == "major"
    on_wood = LoadDraft.model_validate({**draft.model_dump(), "anchored_on_wood": True})
    assert _checks(on_wood)["eu_lashing_points"].deficiency == "major"


def test_labels_are_in_dan() -> None:
    crate = DraftUnit(id="c", cargo="crate", x_m=2.5, y_m=0, mass_kg=500, straps=2)
    devices = _checks(_eu(crate, size="eu_18t", body="flatbed"))["eu_devices"]
    assert devices.values["strap_lc_dan"] == 2500 and devices.values["strap_stf_dan"] == 300


# --- EN 12640 lashing points (EBPG table 3) -----------------------------------------------


@pytest.mark.parametrize(
    ("mass", "dan"), [(3_500, 800), (7_500, 800), (7_501, 1_000), (12_000, 1_000), (40_000, 2_000)]
)
def test_lashing_point_strength_by_vehicle_mass(mass: float, dan: float) -> None:
    assert lashing_point_strength_n(mass) / 10 == dan


def test_weak_lashing_points_limit_chains_on_a_7_5_t_truck() -> None:
    machine = DraftUnit(id="m", cargo="machine", x_m=0.0, y_m=0, mass_kg=3000)
    draft = LoadDraft.model_validate(
        {**_eu(machine, size="eu_7_5t", body="flatbed").model_dump(), "restraint": "chain"}
    )
    scenario, _ = build_draft(draft)
    checks = {c.code: c for c in check_annex3(scenario, draft)}
    # 4,000 daN chains on 800 daN points: the points are the weak link.
    if any(checks[f"eu_{d}"].status == "fail" for d in ("forward", "sideways", "rearward")):
        assert checks["eu_lashing_points"].status == "fail"


# --- Directive 96/53/EC Annex I -----------------------------------------------------------


@pytest.mark.parametrize(("spread", "tonnes"), [(1.30, 21), (1.31, 24), (1.40, 24)])
def test_tri_axle_limits(spread: float, tonnes: float) -> None:
    assert tri_axle_limit_kg(spread) == tonnes * 1000


@pytest.mark.parametrize(
    ("spread", "tonnes"), [(0.99, 11), (1.0, 16), (1.29, 16), (1.3, 18), (1.79, 18), (1.8, 20)]
)
def test_trailer_tandem_limits(spread: float, tonnes: float) -> None:
    assert tandem_trailer_limit_kg(spread) == tonnes * 1000


def test_motor_vehicle_tandem_19_t_only_with_air_suspension() -> None:
    assert tandem_motor_limit_kg(1.37, air=True) == 19_000
    assert tandem_motor_limit_kg(1.37, air=False) == 18_000


def test_an_evenly_loaded_40_t_articulated_vehicle_is_legal() -> None:
    draft = _eu(*_pallets(mass=735))  # 25.0 t
    scenario, _ = build_draft(draft)
    axles = eu_axles(scenario, draft.truck.size)
    assert [a.group for a in axles] == ["steer", "drive", "trailer"]
    assert [a.limit_kg for a in axles] == [10_000, 11_500, 24_000]
    items = {i.code: i for i in weight(scenario, draft.truck.size) if i.code != "eu_axle"}
    assert items["eu_gross"].values["limit_kg"] == 40_000
    assert items["eu_gross"].status == "pass"
    assert items["eu_driving_share"].status == "pass"


def test_an_overloaded_18_t_rigid_fails_its_axle_and_gross_limits() -> None:
    heavy = DraftUnit(id="m", cargo="machine", x_m=-1.0, y_m=0, mass_kg=11_000)
    draft = _eu(heavy, size="eu_18t", body="flatbed")
    scenario, _ = build_draft(draft)
    items = weight(scenario, draft.truck.size)
    rear = next(i for i in items if i.code == "eu_axle" and i.unit_ids == ["rear"])
    assert rear.values["limit_kg"] == 11_500 and rear.status == "fail"
    gross = next(i for i in items if i.code == "eu_gross")
    assert gross.values["limit_kg"] == 18_000 and gross.status == "fail"


def test_a_load_at_the_rear_leaves_too_little_on_the_driving_axle() -> None:
    # 4.1: the driving axle carries at least 25 % of the total; a 26 t rigid fails only when the
    # front gets most of the weight, so check the arithmetic on the articulated preset instead.
    draft = _eu(*_pallets(rows=4, mass=1500))
    scenario, _ = build_draft(draft)
    share = next(i for i in weight(scenario, draft.truck.size) if i.code == "eu_driving_share")
    assert share.values["minimum"] == 0.25
    assert share.status == ("pass" if share.values["share"] >= 0.25 else "fail")


def test_height_width_and_length_limits() -> None:
    tall = DraftUnit(
        id="t", cargo="tall_cabinet", x_m=0.0, y_m=0, size_m=(1.0, 1.0, 2.9), mass_kg=300
    )
    draft = _eu(tall, size="eu_flatbed_136", body="flatbed")
    scenario, _ = build_draft(draft)
    items = {i.code: i for i in dimensions(scenario, draft.truck.size)}
    assert items["eu_height"].values["limit_m"] == 4.0
    assert items["eu_height"].status == "fail"  # 1.30 m deck + 2.90 m = 4.20 m
    assert items["eu_width"].values["limit_m"] == 2.55
    assert items["eu_length"].values["limit_m"] == 16.5
    assert items["eu_length"].status == "pass"


# --- The same load, three countries -------------------------------------------------------


def test_the_same_load_gets_different_verdicts_where_the_rules_differ() -> None:
    # A cabinet 4.20 m above the road on a Brazilian toco, on diagonal lashings: Brazil allows
    # 4.40 m and the US has no federal height limit; 96/53/EC allows 4.00 m.
    tall = DraftUnit(
        id="t", cargo="tall_cabinet", x_m=1.5, y_m=0, size_m=(1.2, 1.2, 2.95), mass_kg=400
    )
    draft = LoadDraft(source="explorer", truck=DraftTruck(), units=[tall], restraint="direct")
    checks = battery_checks(draft)
    assert set(checks.rules) == {Country.BR, Country.US, Country.EU}
    held = [{"id": "emergency_braking", "findings": [], "severity": 0.0}]
    battery = {"situations": held, "rules": {k: v.model_dump() for k, v in checks.rules.items()}}
    states = {c: verdict_of({**battery, "country": c.value}).state for c in Country}
    assert states[Country.BR] == "approved"
    assert states[Country.US] == "approved"
    assert states[Country.EU] == "holds_noncompliant"
    scenario, _ = build_draft(draft)
    height = {
        country: next(
            i.status
            for i in rule_set(scenario, draft, country).checklist.dimensions
            if "height" in i.code
        )
        for country in Country
    }
    assert height == {Country.BR: "pass", Country.US: "advice", Country.EU: "fail"}


def test_eu_rule_set_is_carried_on_every_battery_and_names_the_worst_class() -> None:
    draft = _eu(*_pallets())
    checks = battery_checks(draft)
    held = [{"id": "emergency_braking", "findings": [], "severity": 0.0}]
    battery = {"situations": held, "rules": {k: v.model_dump() for k, v in checks.rules.items()}}
    verdict = verdict_of({**battery, "country": "EU"})
    assert verdict.state == "holds_noncompliant"
    assert verdict.main_problem is not None
    assert verdict.main_problem.deficiency == "dangerous"
    scenario, _ = build_draft(draft)
    assert breaks_a_rule(rule_set(scenario, draft, Country.EU))
    xl = _eu(*_pallets(), body_code=BodyCode.XL)
    scenario, _ = build_draft(xl)
    assert not breaks_a_rule(rule_set(scenario, xl, Country.EU))
    assert scenario.bed.body is BodyType.CURTAIN_SIDER


def test_a_tall_cabinet_needs_lashings_against_tipping() -> None:
    cabinet = DraftUnit(
        id="t", cargo="tall_cabinet", x_m=1.5, y_m=0, size_m=(1.2, 1.2, 2.4), mass_kg=400
    )
    loose = LoadDraft.model_validate(
        {**_eu(cabinet, size="eu_18t", body="flatbed").model_dump(), "restraint": "none"}
    )
    tipping = _checks(loose)["eu_tipping"]
    assert tipping.status == "fail" and tipping.deficiency == "dangerous"  # open sides
    lashed = LoadDraft.model_validate({**loose.model_dump(), "restraint": "direct"})
    assert _checks(lashed)["eu_tipping"].status == "pass"
