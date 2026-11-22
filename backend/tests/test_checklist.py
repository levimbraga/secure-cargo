"""The checklist themes: dimensions and weights (CONTRAN 882/2021), protection, art. 8."""

from app.explorer import build_draft
from app.explorer.draft import DraftTruck, DraftUnit, LoadDraft
from app.inspection.battery import battery_checks
from rules.checklist import MAX_HEIGHT_M, dimensions, weight


def _load(*units: DraftUnit, truck: DraftTruck | None = None, source: str = "photo") -> LoadDraft:
    return LoadDraft(source=source, truck=truck or DraftTruck(), units=list(units))


def test_height_counts_the_deck_and_the_cargo() -> None:
    low = _load(DraftUnit(id="c", cargo="crate", x_m=2.0, y_m=0, mass_kg=500))
    scenario, _ = build_draft(low)
    height = next(i for i in dimensions(scenario) if i.code == "height")
    assert height.status == "pass"
    assert height.values["height_m"] == scenario.bed.floor_height_m + 1.0
    tall = _load(
        DraftUnit(id="c", cargo="tall_cabinet", x_m=2.0, y_m=0, size_m=(1, 0.8, 3.3), mass_kg=500)
    )
    scenario, _ = build_draft(tall)
    item = next(i for i in dimensions(scenario) if i.code == "height")
    assert item.values["height_m"] > MAX_HEIGHT_M and item.status == "fail"


def test_axle_payload_and_balance_items() -> None:
    heavy = _load(DraftUnit(id="m", cargo="machine", x_m=-2.0, y_m=0.3, mass_kg=9000))
    scenario, _ = build_draft(heavy)
    items = {i.code: i for i in weight(scenario) if i.code != "axle"}
    assert items["payload"].status == "fail"  # 9 t on a toco rated for 8 t
    assert items["lateral_balance"].kind == "advice"
    axles = [i for i in weight(scenario) if i.code == "axle"]
    assert any(a.status == "fail" for a in axles)
    assert all(a.values["tolerance_kg"] > a.values["limit_kg"] for a in axles)


def test_an_unconfirmed_headboard_is_to_confirm_never_a_violation() -> None:
    tall = DraftUnit(id="t", cargo="tall_cabinet", x_m=2.6, y_m=0, mass_kg=400)
    unknown = battery_checks(_load(tall))
    art8 = next(c for c in unknown.contran_945 if c.code == "above_headboard")
    assert art8.status == "to_confirm"
    item = next(i for i in unknown.checklist.protection if i.code == "headboard_height")
    assert item.status == "to_confirm"
    known = battery_checks(_load(tall, truck=DraftTruck(headboard_height_m=1.2)))
    assert next(c for c in known.contran_945 if c.code == "above_headboard").status == "fail"
    taller = battery_checks(_load(tall, truck=DraftTruck(headboard_height_m=2.4)))
    assert next(c for c in taller.contran_945 if c.code == "above_headboard").status == "pass"


def test_a_saved_truck_changes_the_bed() -> None:
    unit = DraftUnit(id="c", cargo="crate", x_m=0.0, y_m=0, mass_kg=500)
    longer, _ = build_draft(_load(unit, truck=DraftTruck(bed_length_m=7.0)))
    assert longer.bed.length_m == 7.0
    style = DraftTruck(body="flatbed", size="three_quarter", style="platform", anchors_per_side=8)
    scenario, _ = build_draft(_load(unit, truck=style))
    assert scenario.bed.length_m == 5.2
    assert len([a for a in scenario.bed.anchor_points if a.id.startswith("L")]) == 8


def _semi(mass_kg: float, x_m: float = 0.0) -> LoadDraft:
    return _load(
        DraftUnit(id="m", cargo="machine", x_m=x_m, y_m=0, mass_kg=mass_kg),
        truck=DraftTruck(body="flatbed", size="semi"),
    )


def test_semi_kingpin_load_is_shared_with_the_tractor_steer_axle() -> None:
    # CONTRAN 882/2021 art. 6, II (steer, 6 t) and V (drive tandem, 17 t): the trailer's load
    # on the kingpin goes partly to the steer axle (rules audit item 5).
    from rules.axle_loads import axle_loads
    from rules.checklist import BR_DRIVE_TARE_KG, BR_STEER_TARE_KG, br_axles

    scenario, _ = build_draft(_semi(20_000))
    model = {a.axle_group_id: a.load_kg for a in axle_loads(scenario)}
    axles = {a.group: a for a in br_axles(scenario)}
    assert list(axles) == ["steer", "tractor", "trailer"]
    assert axles["steer"].limit_kg == 6_000
    # Hand check: kingpin = model front group - drive tare; steer gets 0.30 / 4.0 of it.
    kingpin = model["tractor"] - BR_DRIVE_TARE_KG
    assert abs(axles["steer"].load_kg - (BR_STEER_TARE_KG + kingpin * 0.075)) < 0.2
    assert abs(axles["tractor"].load_kg - (BR_DRIVE_TARE_KG + kingpin * 0.925)) < 0.2
    # The drive tandem carries less than the whole kingpin load it used to.
    assert axles["tractor"].load_kg < model["tractor"]
    items = [i for i in weight(scenario) if i.code == "axle"]
    assert [i.unit_ids[0] for i in items] == ["steer", "tractor", "trailer"]


def test_semi_pbtc_is_checked() -> None:
    # CONTRAN 882/2021 art. 6, I, d: 54.5 t for a tractor + triple-tandem semi above 16 m
    # (12.4 m trailer + 4.0 m of tractor ahead of it = 16.4 m). Gross = tare + cargo.
    scenario, _ = build_draft(_semi(20_000))
    gross = next(i for i in weight(scenario) if i.code == "gross")
    assert gross.values["limit_kg"] == 54_500 and gross.status == "pass"
    assert gross.article == "CONTRAN 882/2021 art. 6, I, d"
    assert gross.values["gross_kg"] == 4_800 + 6_500 + 5_500 + 20_000
    heavy, _ = build_draft(_semi(29_000))  # 45.8 t: under 54.5 t, but axles will be over
    assert next(i for i in weight(heavy) if i.code == "gross").status == "pass"
    # A shorter saved trailer (9.3 m, 13.3 m in all): art. 6, I, c, 45 t.
    short = _load(
        DraftUnit(id="m", cargo="machine", x_m=0.0, y_m=0, mass_kg=29_000),
        truck=DraftTruck(body="flatbed", size="semi", bed_length_m=9.3),
    )
    scenario, _ = build_draft(short)
    item = next(i for i in weight(scenario) if i.code == "gross")
    assert item.values["limit_kg"] == 45_000 and item.status == "fail"


def test_art50_par1_axles_of_vehicles_up_to_50_t_are_weighed_on_the_total_only() -> None:
    # CONTRAN 882/2021 art. 50 §1: regulatory PBT/PBTC <= 50 t (a toco: 6 + 10 = 16 t; a 2S3
    # semi: 6 + 17 + 25.5 = 48.5 t) -> weighed on the total; the axle limit still fails.
    heavy = _load(DraftUnit(id="m", cargo="machine", x_m=-2.0, y_m=0.3, mass_kg=9000))
    scenario, _ = build_draft(heavy)
    rear = next(i for i in weight(scenario) if i.code == "axle" and i.status == "fail")
    assert rear.values["weighed_on_gross_only"] == 1.0
    assert rear.values["regulatory_gross_kg"] == 16_000
    assert rear.article.endswith("art. 50 §1")
    scenario, _ = build_draft(_semi(20_000, x_m=4.0))
    axle = next(i for i in weight(scenario) if i.code == "axle")
    assert axle.values["regulatory_gross_kg"] == 48_500


def test_overhang_cites_art60_xi_and_checks_front_and_sides() -> None:
    # CONTRAN 882/2021 art. 60, XI -> CTB art. 235: cargo past the vehicle's sides, front or rear.
    inside = _load(DraftUnit(id="c", cargo="crate", x_m=0.0, y_m=0, mass_kg=500))
    scenario, _ = build_draft(inside)
    assert next(i for i in dimensions(scenario) if i.code == "overhang").status == "pass"
    # Drafts cannot hang off the bed; a scenario can: move the crate past each edge.
    unit = scenario.units[0]
    half_l, half_w = scenario.bed.length_m / 2, scenario.bed.width_m / 2
    for position, key in (
        ((-half_l, 0.0, 0.0), "rear_m"),
        ((half_l, 0.0, 0.0), "front_m"),
        ((0.0, half_w, 0.0), "side_m"),
    ):
        moved = scenario.model_copy(
            update={"units": [unit.model_copy(update={"position_m": position})]}
        )
        item = next(i for i in dimensions(moved) if i.code == "overhang")
        assert item.status == "fail" and item.values[key] > 0, key
        assert item.article == "CONTRAN 882/2021 art. 60, XI (CTB art. 235)"
