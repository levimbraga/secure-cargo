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
