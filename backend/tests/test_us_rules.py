"""US mode: 49 CFR 393 subpart I, 23 CFR 658.17 and the bridge formula, with worked examples.

The examples are the ones in the workspace's ``notes/us-rules.md``: the FHWA Bridge Table
(FHWA-HOP-06-105), the tiedown table of 393.110 and the arithmetic of 393.106(d) and 393.114(c).
"""

import pytest

from app.explorer import build_draft
from app.explorer.config import Country
from app.explorer.draft import DraftTruck, DraftUnit, LoadDraft
from app.inspection.battery import battery_checks
from app.inspection.verdict import verdict_of
from app.scenario import Lashing, LashingKind, LashingRouting
from rules.fmcsa393 import RuleCheck, _aggregate_wll_n, check_fmcsa_393, required_tiedowns
from rules.us_checklist import dimensions, weight
from rules.us_weights import (
    FOOT_M,
    Axle,
    bridge_groups,
    bridge_limit_lb,
    kg,
    us_axles,
)

LBF_N = 4.4482216152605


def _us(
    *units: DraftUnit, size: str = "us_flatbed_48", body: str = "flatbed", **truck: float
) -> LoadDraft:
    return LoadDraft(
        source="explorer",
        country="US",
        truck=DraftTruck(body=body, size=size, **truck),
        units=list(units),
    )


def _with(draft: LoadDraft, **update: object) -> LoadDraft:
    """A validated copy (``model_copy`` would keep plain strings instead of enums)."""
    return LoadDraft.model_validate({**draft.model_dump(), **update})


def _check(draft: LoadDraft, code: str) -> RuleCheck:
    scenario, _ = build_draft(draft)
    checks = check_fmcsa_393(scenario, draft, anchored_on_wood=draft.anchored_on_wood)
    return next(c for c in checks if c.code == code)


# --- Bridge formula (23 U.S.C. 127(a), 23 CFR 658.17(e)) -----------------------------------


@pytest.mark.parametrize(
    ("length_ft", "axles", "pounds"),
    [
        (20, 3, 51_000),  # the pamphlet's own worked example
        (9, 3, 42_500),  # 42,750 lb: exactly halfway, FHWA rounds down
        (23, 4, 57_500),  # 57,333 lb, to the nearest 500 lb
        (10, 2, 40_000),
        (51, 4, 76_000),
        (51, 5, 80_000),  # 79,875 lb
        (36, 4, 66_000),  # the formula; two tandems may still carry 68,000 lb (below)
        (8.5, 2, 38_000),  # "more than 8 and less than 9 ft"
        (8.5, 3, 42_000),
        (4, 2, 34_000),  # a tandem: within 96 in
        (8, 3, 34_000),
    ],
)
def test_bridge_formula_matches_the_fhwa_bridge_table(
    length_ft: float, axles: int, pounds: int
) -> None:
    assert bridge_limit_lb(length_ft, axles) == pounds


def test_two_consecutive_tandems_36_ft_apart_may_carry_68000_lb() -> None:
    def axles(first_to_last_ft: float) -> list[Axle]:
        far = first_to_last_ft * FOOT_M
        spread = 4 * FOOT_M
        return [
            Axle("tractor", far, 0),
            Axle("tractor", far - spread, 0),
            Axle("trailer", spread, 0),
            Axle("trailer", 0.0, 0),
        ]

    whole = next(g for g in bridge_groups(axles(36), {"tractor", "trailer"}) if g.axles == 4)
    assert whole.limit_lb == 68_000
    short = next(g for g in bridge_groups(axles(35), {"tractor", "trailer"}) if g.axles == 4)
    assert short.limit_lb == bridge_limit_lb(35, 4) == 65_500


# --- Axle and gross limits (23 CFR 658.17(b)-(d)) -----------------------------------------


def test_a_tractor_semitrailer_has_five_axles_and_shares_the_kingpin_load() -> None:
    draft = _us(DraftUnit(id="c", cargo="crate", x_m=0.0, y_m=0, mass_kg=10_000))
    scenario, _ = build_draft(draft)
    axles = us_axles(scenario, draft.truck.size)
    assert [a.group for a in axles] == ["steer", "tractor", "tractor", "trailer", "trailer"]
    gross = sum(a.load_kg for a in axles)
    tare = kg(11_000 + 8_000 + 10_000)  # tractor and trailer of the preset (notes/us-rules.md)
    assert gross == pytest.approx(tare + 10_000, abs=1)


def test_drive_tandem_over_34000_lb_fails_and_the_bridge_formula_is_reported() -> None:
    front_heavy = _us(
        DraftUnit(id="c1", cargo="steel_coil", x_m=5.5, y_m=0, mass_kg=9_000, straps=2),
        DraftUnit(id="c2", cargo="steel_coil", x_m=3.5, y_m=0, mass_kg=9_000, straps=2),
    )
    scenario, _ = build_draft(front_heavy)
    items = weight(scenario, front_heavy.truck.size)
    drive = next(i for i in items if i.code == "us_axle" and i.unit_ids == ["tractor"])
    assert drive.status == "fail" and drive.values["limit_lb"] == 34_000
    steer = next(i for i in items if i.code == "us_axle" and i.unit_ids == ["steer"])
    assert steer.values["limit_lb"] == 20_000
    assert next(i for i in items if i.code == "us_gross").values["limit_lb"] == 80_000
    assert next(i for i in items if i.code == "bridge").article == "23 CFR 658.17(e)"


def test_gross_weight_over_80000_lb_fails() -> None:
    heavy = _us(
        *[
            DraftUnit(id=f"c{i}", cargo="crate", x_m=6.0 - 2.2 * i, y_m=0, mass_kg=4_200, straps=2)
            for i in range(6)
        ]
    )
    scenario, _ = build_draft(heavy)
    gross = next(i for i in weight(scenario, heavy.truck.size) if i.code == "us_gross")
    assert gross.values["gross_lb"] > 80_000 and gross.status == "fail"


# --- 393.106(d): aggregate working load limit ----------------------------------------------


def _lashing(routing: LashingRouting, wll_lb: float, n: int) -> list[Lashing]:
    return [
        Lashing(
            id=f"x{i}",
            kind=LashingKind.STRAP,
            routing=routing,
            unit_id="crate",
            anchor_ids=["a", "b"] if routing is LashingRouting.TOP_OVER else ["a"],
            attachment_point_m=None if routing is LashingRouting.TOP_OVER else (0.5, 0.5, 0.2),
            pretension_n=100,
            lashing_capacity_n=wll_lb * LBF_N,
        )
        for i in range(n)
    ]


def test_aggregate_wll_counts_indirect_fully_and_direct_by_half() -> None:
    required = 0.5 * 4_000 * LBF_N  # a 4,000 lb crate: at least 2,000 lb
    assert _aggregate_wll_n(_lashing(LashingRouting.TOP_OVER, 3_335, 2)) == pytest.approx(
        6_670 * LBF_N
    )
    assert _aggregate_wll_n(_lashing(LashingRouting.DIRECT, 1_000, 4)) == pytest.approx(required)
    assert _aggregate_wll_n(_lashing(LashingRouting.DIRECT, 1_000, 3)) < required


def test_aggregate_wll_on_a_load() -> None:
    light = _us(DraftUnit(id="p", cargo="wood_pallet", x_m=6.7, y_m=0, mass_kg=900, straps=2))
    check = _check(light, "aggregate_wll")
    assert check.status == "pass" and check.values["indirect"] == 2
    bare = _us(DraftUnit(id="m", cargo="machine", x_m=6.3, y_m=0, mass_kg=6_000, straps=0))
    assert _check(bare, "aggregate_wll").status == "fail"


# --- 393.110: minimum number of tiedowns ---------------------------------------------------


@pytest.mark.parametrize(
    ("length_ft", "pounds", "blocked", "count"),
    [
        (4, 800, False, 1),
        (4, 1_500, False, 2),
        (8, 500, False, 2),
        (10, 500, False, 2),
        (20, 5_000, False, 3),
        (25, 5_000, False, 4),
        (20, 5_000, True, 2),
        (8, 5_000, True, 1),
    ],
)
def test_minimum_tiedowns_table(length_ft: float, pounds: float, blocked: bool, count: int) -> None:
    assert required_tiedowns(length_ft * FOOT_M, kg(pounds), blocked) == count


def test_a_long_pipe_needs_three_tiedowns_unless_it_is_blocked() -> None:
    # A 6 m (19.7 ft) pipe with two straps, off the headboard: 393.110(b)(3) asks for 3.
    pipe = DraftUnit(id="p", cargo="long_pipes", x_m=0.0, y_m=0, mass_kg=720, straps=2)
    check = _check(_us(pipe), "min_tiedowns")
    assert check.status == "fail" and check.values["required"] == 3
    against = pipe.model_copy(update={"x_m": 14.63 / 2 - 3.0})  # touching a 4 ft headboard
    assert _check(_us(against), "min_tiedowns").status == "pass"


# --- 393.114: front end structure ------------------------------------------------------------


def test_front_end_structure_height_and_strength() -> None:
    front = 14.63 / 2 - 0.6
    crate = DraftUnit(id="c", cargo="crate", x_m=front, y_m=0, mass_kg=13_608, straps=2)
    low = _check(_us(crate, headboard_height_m=0.6), "front_end_structure")
    assert low.status == "fail" and low.values["required_height_m"] == pytest.approx(1.0)
    cabinet = DraftUnit(
        id="t", cargo="tall_cabinet", x_m=14.63 / 2 - 0.5, y_m=0, mass_kg=700, straps=2
    )
    tall = _check(_us(cabinet, headboard_height_m=1.22), "front_end_structure")
    # 4 ft is enough for a 2.2 m cabinet; the headboard's rating is unknown: to confirm.
    assert tall.values["required_height_m"] == pytest.approx(4 * FOOT_M, abs=1e-3)
    assert tall.status == "to_confirm"
    # 30,000 lb against a 4 ft headboard: 15,000 lb; against a 6 ft one: 12,000 lb.
    heavy = crate.model_copy(update={"mass_kg": kg(30_000)})
    four = _check(_us(heavy, headboard_height_m=1.22), "front_end_structure")
    assert four.values["share"] == 0.5
    assert four.values["demand_kg"] == pytest.approx(kg(15_000), abs=0.5)
    six = _check(_us(heavy, headboard_height_m=1.83), "front_end_structure")
    assert six.values["demand_kg"] == pytest.approx(kg(12_000), abs=0.5)
    # From a photo, nobody gave the headboard's height: to confirm, never failed.
    photo = _with(_us(crate), source="photo")
    unknown = battery_checks(photo).rules[Country.US].securing
    assert next(c for c in unknown if c.code == "front_end_structure").status == "to_confirm"


# --- Commodity rules ---------------------------------------------------------------------


def test_metal_coils_need_a_cradle_and_chains_forward_and_rearward() -> None:
    coil = DraftUnit(id="c", cargo="steel_coil", x_m=2.0, y_m=0, mass_kg=9_000, straps=2)
    assert _check(_us(coil), "metal_coils").status == "fail"
    chained = _us(coil.model_copy(update={"straps": 0}))
    chained = _with(chained, restraint="cradle_chain")
    assert _check(chained, "metal_coils").status == "pass"
    cradle_only = _with(chained, restraint="cradle")
    assert _check(cradle_only, "metal_coils").status == "fail"
    light = coil.model_copy(update={"mass_kg": 2_000})  # under 5,000 lb: 393.100-393.114
    assert _check(_us(light), "metal_coils").status == "not_applicable"
    assert _check(_us(light), "rolling_articles").status == "fail"


def test_heavy_machinery_needs_four_tiedowns() -> None:
    machine = DraftUnit(id="m", cargo="machine", x_m=0.0, y_m=0, mass_kg=6_000, straps=2)
    assert _check(_us(machine), "machinery").status == "fail"
    direct = _with(_us(machine), restraint="chain")
    assert _check(direct, "machinery").status == "pass"
    small = machine.model_copy(update={"mass_kg": 4_000})  # under 10,000 lb
    assert _check(_us(small), "machinery").status == "not_applicable"


def test_rolling_pipes_need_chocks() -> None:
    pipe = DraftUnit(id="p", cargo="long_pipes", x_m=0.0, y_m=0, mass_kg=720, straps=3)
    assert _check(_us(pipe), "rolling_articles").status == "fail"
    blocked = _with(_us(pipe), restraint="blocking")
    assert _check(blocked, "rolling_articles").status == "pass"


def test_ropes_are_to_confirm_and_wooden_anchors_fail() -> None:
    crate = DraftUnit(id="c", cargo="crate", x_m=0.0, y_m=0, mass_kg=500, straps=2)
    roped = _with(_us(crate), restraint="rope")
    assert _check(roped, "rope_tiedowns").status == "to_confirm"
    wood = _with(_us(crate), anchored_on_wood=True)
    assert _check(wood, "anchor_points").status == "fail"


def test_cargo_in_a_van_must_touch_the_wall_or_the_cargo_ahead() -> None:
    half = 16.0 / 2
    loose = DraftUnit(id="p", cargo="wood_pallet", x_m=half - 2.0, y_m=0, mass_kg=900)
    van = _us(loose, size="us_dry_van_53", body="box")
    assert _check(van, "van_contained").status == "fail"
    snug = loose.model_copy(update={"x_m": half - 0.6})
    assert _check(_us(snug, size="us_dry_van_53", body="box"), "van_contained").status == "pass"
    assert _check(_us(snug, size="us_dry_van_53", body="box"), "aggregate_wll").status == (
        "not_applicable"
    )


# --- Dimensions --------------------------------------------------------------------------


def test_width_height_and_rear_projection() -> None:
    crate = DraftUnit(id="c", cargo="crate", x_m=0.0, y_m=0, mass_kg=500, straps=2)
    scenario, _ = build_draft(_us(crate))
    items = {i.code: i for i in dimensions(scenario)}
    assert items["width"].values["limit_m"] == pytest.approx(102 * 0.0254)
    assert items["width"].status == "pass"
    assert items["us_height"].kind == "advice" and items["us_height"].status == "pass"
    assert items["rear_projection"].status == "pass"


# --- The same load, two countries ---------------------------------------------------------


def test_one_battery_carries_both_rule_sets_and_the_verdict_follows_the_country() -> None:
    # Ropes: prohibited in Brazil (out of compliance), "to confirm" in the US.
    crate = DraftUnit(id="c", cargo="crate", x_m=2.5, y_m=0, mass_kg=500, straps=2)
    draft = LoadDraft(source="explorer", truck=DraftTruck(), units=[crate], restraint="rope")
    checks = battery_checks(draft)
    assert set(checks.rules) == {"BR", "US"}
    assert checks.country == "BR"
    held = [{"id": "emergency_braking", "findings": [], "severity": 0.0}]
    battery = {"situations": held, "rules": {k: v.model_dump() for k, v in checks.rules.items()}}
    br = verdict_of({**battery, "country": "BR"})
    us = verdict_of({**battery, "country": "US"})
    assert br.state == "holds_noncompliant"
    assert br.main_problem is not None and br.main_problem.code == "devices_allowed"
    assert us.main_problem is None or us.main_problem.code != "devices_allowed"
    assert {c.code for c in checks.rules[Country.US].securing} >= {
        "aggregate_wll",
        "min_tiedowns",
        "front_end_structure",
    }
