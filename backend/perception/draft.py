"""A photo analysis (Claude vision) -> the load draft the editor shows, on the confirmed truck.

The analysis gives positions as fractions of the bed ("along": 0 at the headboard, 1 at the
rear; "across": 0 at the truck's left edge) and approximate sizes. The confirmed truck's bed
length and width turn the fractions into metres; that is the scale reference of the photo.

The result is always a load the physics engine can build: units are packed from the front,
in the lanes the photo shows, so that none overlaps another or hangs off the bed; straps are
kept within the lashing points along each unit. Whatever had to change is reported as a
warning, so the person reviewing the load knows what to look at.

**Weights never come from the photo.** The analysis has no weight field; the masses of the
draft come only from the user: a total split in proportion to the units' volumes, or one
weight per unit. Without either, every unit's mass is left empty and the load cannot be
confirmed.
"""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer import BuildError, build_draft
from app.explorer.build import CARGO, TRUCKS, strap_room
from app.explorer.config import MAX_STRAPS_PER_UNIT, Cargo, Restraint, Size
from app.explorer.draft import DraftTruck, DraftUnit, LoadDraft
from app.scenario import UnitShape

GRID_M = 0.05
# A violation or an anti-slip mat counts when the model is at least this sure of it.
MIN_CONFIDENCE = 0.5


class _In(BaseModel):
    # The analysis comes from outside: anything not listed (a weight, a price) is ignored.
    model_config = ConfigDict(extra="ignore", frozen=True)


class AnalysisUnit(_In):
    number: int
    cargo: Cargo
    length_m: float = Field(gt=0, le=20)
    width_m: float = Field(gt=0, le=4)
    height_m: float = Field(gt=0, le=5)
    along: float = Field(ge=0, le=1)
    across: float = Field(ge=0, le=1)
    stacked_on: int | None = None
    photo: int = 0
    box: tuple[float, float, float, float] = (0, 0, 0, 0)
    confidence: float = 0.5
    uncertain: str = ""


class AnalysisRestraint(_In):
    kind: Literal["strap", "chain", "rope", "anti_slip_mat", "blocking", "coil_cradle"]
    count: int = Field(ge=0, le=60)
    routing: Literal["top_over", "diagonal", "unknown"] = "unknown"
    units: list[int] = []
    confidence: float = 0.5
    uncertain: str = ""


class AnalysisViolation(_In):
    code: Literal["rope", "above_headboard", "gap_to_headboard", "anchored_on_wood"]
    units: list[int] = []
    confidence: float = 0.5
    note: str = ""


class PhotoAnalysis(_In):
    is_truck_load: bool = True
    units: list[AnalysisUnit] = Field(default=[], max_length=40)
    restraints: list[AnalysisRestraint] = []
    violations: list[AnalysisViolation] = []


class Weight(BaseModel):
    """From the invoice: the total, or one weight per unit number."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    total_kg: float | None = Field(default=None, gt=0, le=80_000)
    per_unit_kg: dict[int, float] | None = None


class UnitLink(BaseModel):
    """Which draft unit a number on the photo became, for the numbered overlays."""

    number: int
    unit_id: str
    photo: int
    box: tuple[float, float, float, float]
    confidence: float
    uncertain: str


Warning = Literal[
    "not_a_load",
    "no_units",
    "unit_dropped",
    "moved_to_fit",
    "resized_to_fit",
    "straps_reduced",
    "stack_dropped",
]


class PerceptionDraft(BaseModel):
    draft: LoadDraft
    links: list[UnitLink]
    warnings: list[Warning]


def _grid(value: float) -> float:
    return round(round(value / GRID_M) * GRID_M, 4) + 0.0


def _size(unit: AnalysisUnit, bed_length: float, bed_width: float) -> tuple[float, float, float]:
    """The unit's size on the plan; cylinders keep the shape the physics engine draws."""
    spec = CARGO[unit.cargo]
    if spec.shape is UnitShape.CYLINDER:
        length, width, height = spec.size_m
        if unit.cargo is Cargo.LONG_PIPES:
            length = unit.length_m  # pipes come in any length; the cross-section stays
        return (min(_grid(length), bed_length), width, height)
    return (
        min(max(_grid(unit.length_m), 0.2), bed_length),
        min(max(_grid(unit.width_m), 0.2), bed_width),
        max(_grid(unit.height_m), 0.1),
    )


def _restraint(analysis: PhotoAnalysis) -> Restraint:
    def seen(kind: str, routing: str | None = None) -> bool:
        return any(
            r.kind == kind and r.count > 0 and (routing is None or r.routing == routing)
            for r in analysis.restraints
        ) or any(
            r.kind == kind
            and kind in ("anti_slip_mat", "blocking", "coil_cradle")
            and r.confidence >= MIN_CONFIDENCE
            for r in analysis.restraints
        )

    if seen("rope"):
        return Restraint.ROPE
    if seen("chain"):
        return Restraint.CHAIN
    if seen("strap", "diagonal"):
        return Restraint.DIRECT
    if seen("coil_cradle"):
        return Restraint.CRADLE
    if seen("anti_slip_mat"):
        return Restraint.MAT
    if seen("strap"):
        return Restraint.TOP_OVER
    if seen("blocking"):
        return Restraint.BLOCKING
    return Restraint.NONE


def _place(
    units: list[AnalysisUnit], size: Size, warnings: list[Warning]
) -> dict[int, tuple[float, float, tuple[float, float, float]]]:
    """Footprint centres of the floor units, packed from the front in their lanes."""
    truck = TRUCKS[size]
    half_l, half_w = truck.length_m / 2, truck.width_m / 2
    placed: dict[int, tuple[float, float, tuple[float, float, float]]] = {}
    boxes: list[tuple[float, float, float, float]] = []  # x_low, x_high, y_low, y_high
    for unit in sorted(units, key=lambda u: (u.along, u.across)):
        size_m = _size(unit, truck.length_m, truck.width_m)
        if size_m[0] < _size(unit, 1e9, 1e9)[0] or size_m[1] < _size(unit, 1e9, 1e9)[1]:
            warnings.append("resized_to_fit")
        length, width, _ = size_m
        y_hint = half_w - unit.across * truck.width_m
        x_hint = half_l - unit.along * truck.length_m
        lanes = [y_hint] + [half_w - width / 2 - step * GRID_M for step in range(0, 200)]
        spot: tuple[float, float] | None = None
        for y in lanes:
            y = _grid(min(max(y, -half_w + width / 2), half_w - width / 2))
            low_y, high_y = y - width / 2, y + width / 2
            x = min(x_hint, half_l - length / 2)
            for x_low, _x_high, other_low, other_high in boxes:
                if other_low < high_y - 0.005 and low_y < other_high - 0.005:
                    x = min(x, x_low - length / 2)
            x = math.floor((x + 1e-9) / GRID_M) * GRID_M
            # The first lane that fits: the photo's own, or the nearest free one.
            if x - length / 2 >= -half_l - 1e-9 and all(
                not (
                    o_low < high_y - 0.005
                    and low_y < o_high - 0.005
                    and x_low < x + length / 2 - 0.005
                    and x - length / 2 < x_high - 0.005
                )
                for x_low, x_high, o_low, o_high in boxes
            ):
                spot = (round(x, 4) + 0.0, y)
                break
        if spot is None:
            warnings.append("unit_dropped")
            continue
        if abs(spot[0] - x_hint) > 0.5 or abs(spot[1] - y_hint) > 0.3:
            warnings.append("moved_to_fit")
        placed[unit.number] = (spot[0], spot[1], size_m)
        boxes.append(
            (spot[0] - length / 2, spot[0] + length / 2, spot[1] - width / 2, spot[1] + width / 2)
        )
    return placed


def _masses(
    units: list[AnalysisUnit], sizes: dict[int, tuple[float, float, float]], weight: Weight | None
) -> dict[int, float | None]:
    """The user's weights on the units: never a guess."""
    if weight is None or (weight.total_kg is None and not weight.per_unit_kg):
        return {u.number: None for u in units}
    if weight.per_unit_kg:
        return {u.number: weight.per_unit_kg.get(u.number) for u in units}
    assert weight.total_kg is not None
    volumes = {n: s[0] * s[1] * s[2] for n, s in sizes.items()}
    total_volume = sum(volumes.values())
    masses = {n: round(weight.total_kg * v / total_volume) for n, v in volumes.items()}
    # Whole kilograms that add up exactly to the total.
    biggest = max(masses, key=lambda n: masses[n])
    masses[biggest] += round(weight.total_kg) - sum(masses.values())
    return {u.number: float(masses[u.number]) for u in units}


def analysis_to_draft(
    analysis: PhotoAnalysis, truck: DraftTruck, weight: Weight | None = None
) -> PerceptionDraft:
    warnings: list[Warning] = []
    if not analysis.is_truck_load:
        warnings.append("not_a_load")
    by_number = {u.number: u for u in analysis.units}
    # Stacks: a unit stands on a floor unit (one level of stacking, as the editor allows).
    floor = [u for u in analysis.units if u.stacked_on is None or u.stacked_on not in by_number]
    stacked = [
        u
        for u in analysis.units
        if u.stacked_on in by_number and by_number[u.stacked_on].stacked_on is None
    ]
    if len(floor) + len(stacked) < len(analysis.units):
        warnings.append("stack_dropped")

    placed = _place(floor, truck.size, warnings)
    sizes: dict[int, tuple[float, float, float]] = {n: p[2] for n, p in placed.items()}
    tops: dict[int, int] = {}
    kept_stacked: list[AnalysisUnit] = []
    for unit in stacked:
        base = unit.stacked_on
        if base is None or base not in placed or base in tops:
            warnings.append("stack_dropped")
            continue
        if (
            CARGO[unit.cargo].shape is UnitShape.CYLINDER
            or CARGO[by_number[base].cargo].shape is UnitShape.CYLINDER
        ):
            warnings.append("stack_dropped")
            continue
        base_size = placed[base][2]
        own = _size(unit, base_size[0], base_size[1])
        sizes[unit.number] = (min(own[0], base_size[0]), min(own[1], base_size[1]), own[2])
        tops[base] = unit.number
        kept_stacked.append(unit)
    kept = [u for u in floor if u.number in placed] + kept_stacked
    if not kept:
        warnings.append("no_units")
        kept_numbers: set[int] = set()
    else:
        kept_numbers = {u.number for u in kept}

    masses = _masses(kept, sizes, weight)
    ident = {u.number: f"unit-{u.number}" for u in kept}
    restraint = _restraint(analysis)

    def unit_of(number: int, straps: int = 0) -> DraftUnit:
        source = by_number[number]
        base = source.stacked_on if number in kept_numbers and source in kept_stacked else None
        x, y, _ = placed[base if base is not None else number]
        return DraftUnit(
            id=ident[number],
            cargo=source.cargo,
            label=f"Unit {number}",
            size_m=sizes[number],
            mass_kg=masses[number],
            x_m=x,
            y_m=y,
            on=ident[base] if base is not None else None,
            straps=straps,
        )

    # The draft lists a unit after the one it stands on.
    order = [u.number for u in kept if u not in kept_stacked] + [u.number for u in kept_stacked]
    anchored_on_wood = any(
        v.code == "anchored_on_wood" and v.confidence >= MIN_CONFIDENCE for v in analysis.violations
    )
    base_draft = LoadDraft(
        source="photo",
        truck=truck,
        restraint=restraint,
        units=[unit_of(n) for n in order] if order else [_placeholder(truck)],
        anchored_on_wood=anchored_on_wood,
    )
    draft = (
        _with_straps(base_draft, analysis, tops, ident, restraint, warnings)
        if order
        else base_draft
    )
    links = [
        UnitLink(
            number=u.number,
            unit_id=ident[u.number],
            photo=u.photo,
            box=u.box,
            confidence=u.confidence,
            uncertain=u.uncertain,
        )
        for u in kept
    ]
    return PerceptionDraft(draft=draft, links=links, warnings=sorted(set(warnings)))


def _placeholder(truck: DraftTruck) -> DraftUnit:
    """An empty analysis still opens the editor: one crate at the headboard, to be edited."""
    spec = CARGO[Cargo.CRATE]
    length = spec.size_m[0]
    return DraftUnit(
        id="unit-1",
        cargo=Cargo.CRATE,
        x_m=_grid(TRUCKS[truck.size].length_m / 2 - length / 2),
        y_m=0.0,
        mass_kg=None,
    )


def _with_straps(
    draft: LoadDraft,
    analysis: PhotoAnalysis,
    tops: dict[int, int],
    ident: dict[int, str],
    restraint: Restraint,
    warnings: list[Warning],
) -> LoadDraft:
    """The straps (or ropes) over each unit, as the photo shows them, within the lashing points."""
    # With ropes the engine models every top-over device as a rope (the worse of the two).
    kind = "rope" if restraint is Restraint.ROPE else "strap"
    top_over = [r for r in analysis.restraints if r.kind == kind and r.routing != "diagonal"]
    # Straps go over the top unit of a stack.
    number_of = {v: k for k, v in ident.items()}
    lashed = [
        ident.get(tops.get(number_of[u.id], number_of[u.id]), u.id)
        for u in draft.units
        if u.on is None
    ]
    straps: dict[str, int] = {uid: 0 for uid in lashed}
    for item in top_over:
        targets = [
            ident.get(tops.get(n, n)) for n in item.units if ident.get(tops.get(n, n)) in straps
        ] or lashed
        targets = [t for t in dict.fromkeys(targets) if t is not None]
        for index in range(item.count):
            uid = targets[index % len(targets)]
            straps[uid] += 1
    scenario, _ = build_draft(draft.model_copy(update={"restraint": Restraint.NONE}))
    units = []
    for unit in draft.units:
        wanted = straps.get(unit.id, 0)
        room = min(strap_room(scenario, unit.id), MAX_STRAPS_PER_UNIT) if wanted else 0
        if wanted > room:
            warnings.append("straps_reduced")
        units.append(unit.model_copy(update={"straps": min(wanted, room)}))
    fixed = draft.model_copy(update={"units": units})
    try:
        build_draft(fixed)
    except BuildError:
        # A body the restraint does not fit (e.g. blocking with no room): keep the straps only.
        fallback = Restraint.TOP_OVER if any(u.straps for u in units) else Restraint.NONE
        fixed = fixed.model_copy(update={"restraint": fallback})
    return fixed
