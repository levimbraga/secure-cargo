"""Explorer configuration -> scenario and trip event.

Every number here is either the same as in the demo fixtures or an illustrative value for a
typical Brazilian truck; the list with sources and assumptions is in the workspace's
``notes/physics-sources.md`` ("Explorer presets"). None of it describes a specific model.
"""

import math
from dataclasses import dataclass

from pydantic import ValidationError

from app.explorer.config import Cargo, ExplorerConfig, Position, Restraint, Road, Size, Weather
from app.explorer.draft import DraftTrip, DraftTruck, DraftUnit, LoadDraft
from app.scenario import (
    AnchorPoint,
    AxleGroup,
    AxleGroupKind,
    Block,
    BlockKind,
    BodyType,
    CargoMaterial,
    CargoUnit,
    CylinderAxis,
    EventKind,
    FloorMaterial,
    Headboard,
    Lashing,
    LashingKind,
    LashingRouting,
    RoadSurface,
    Scenario,
    TripEvent,
    TruckBed,
    UnitShape,
    Vehicle,
)
from app.scenario.presets import side_anchor_points
from physics.constants import STANDARD_GRAVITY_MPS2

ANCHOR_SPACING_M = 0.4


class BuildError(ValueError):
    """The configuration cannot be loaded on the truck. ``code`` is translated by the UI."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class Built:
    config: ExplorerConfig
    draft: LoadDraft
    scenario: Scenario
    event: TripEvent


# --- Trucks ----------------------------------------------------------------------------


@dataclass(frozen=True)
class TruckSpec:
    length_m: float
    width_m: float
    floor_height_m: float
    wall_height_m: float  # box and curtain-sider bodies
    front: AxleGroup
    rear: AxleGroup
    payload_kg: float


TRUCKS: dict[Size, TruckSpec] = {
    Size.VUC: TruckSpec(
        length_m=4.2,
        width_m=2.2,
        floor_height_m=1.0,
        wall_height_m=2.2,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=3.0, tare_load_kg=1900
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.6, tare_load_kg=1600
        ),
        payload_kg=4000,
    ),
    # The truck of the four original demos.
    Size.TOCO: TruckSpec(
        length_m=6.2,
        width_m=2.4,
        floor_height_m=1.25,
        wall_height_m=2.4,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.0, tare_load_kg=3400
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.8, tare_load_kg=2600
        ),
        payload_kg=8000,
    ),
    Size.TRUCK: TruckSpec(
        length_m=8.0,
        width_m=2.4,
        floor_height_m=1.3,
        wall_height_m=2.4,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=5.0, tare_load_kg=3800
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.TANDEM_2_AXLES, position_x_m=-1.2, tare_load_kg=4700
        ),
        payload_kg=14000,
    ),
    # The semi-trailer rests on the tractor's drive tandem (at the kingpin) and on its own
    # triple axle; the tractor's steer axle is not modelled.
    Size.SEMI: TruckSpec(
        length_m=12.4,
        width_m=2.4,
        floor_height_m=1.4,
        wall_height_m=2.6,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=5.4,
            tare_load_kg=6500,
        ),
        rear=AxleGroup(
            id="trailer", kind=AxleGroupKind.TANDEM_3_AXLES, position_x_m=-4.6, tare_load_kg=5500
        ),
        payload_kg=28000,
    ),
}
FLATBED_HEADBOARD_M = 1.2
# EN 12642 code L: the front wall of a box or curtain-sider body holds 0.4 P (P = payload),
# at most 5,000 daN.
FRONT_WALL_SHARE_OF_PAYLOAD = 0.4
FRONT_WALL_MAX_N = 50_000.0


# --- Cargo -----------------------------------------------------------------------------


@dataclass(frozen=True)
class CargoSpec:
    unit_id: str  # units are "<unit_id>-1", "<unit_id>-2", ...
    label: str
    size_m: tuple[float, float, float]
    mass_kg: float
    material: CargoMaterial
    count: int
    per_row: int = 1
    spacing_m: float = 0.4  # between rows when the cargo is not pushed together
    shape: UnitShape = UnitShape.BOX
    axis: CylinderAxis | None = None
    inner_diameter_m: float | None = None


CARGO: dict[Cargo, CargoSpec] = {
    Cargo.WOOD_PALLET: CargoSpec(
        "pallet", "Palletised cargo", (1.2, 1.0, 1.1), 900, CargoMaterial.SAWN_WOOD, 3
    ),
    Cargo.PLASTIC_PALLET: CargoSpec(
        "stack",
        "Crates on a plastic pallet",
        (1.2, 1.0, 1.3),
        800,
        CargoMaterial.PLASTIC_PALLET,
        3,
    ),
    Cargo.CRATE: CargoSpec(
        "crate", "Crate of parts", (1.2, 1.0, 1.0), 1500, CargoMaterial.SAWN_WOOD, 2
    ),
    # A 200 L steel drum, full: 0.585 m across, 0.88 m tall, about 250 kg.
    Cargo.DRUM: CargoSpec(
        "drum",
        "200 L drum",
        (0.6, 0.6, 0.9),
        250,
        CargoMaterial.STEEL_CRATE,
        8,
        per_row=2,
        spacing_m=0.2,
        shape=UnitShape.CYLINDER,
        axis=CylinderAxis.Z,
    ),
    # A hot-rolled steel coil "eye to the side": 1.6 m across, 1.2 m wide, 610 mm eye.
    Cargo.STEEL_COIL: CargoSpec(
        "coil",
        "Steel coil",
        (1.6, 1.2, 1.6),
        10_000,
        CargoMaterial.STEEL_CRATE,
        1,
        shape=UnitShape.CYLINDER,
        axis=CylinderAxis.Y,
        inner_diameter_m=0.61,
    ),
    Cargo.MACHINE: CargoSpec(
        "machine", "Machine on a steel skid", (2.0, 1.6, 1.2), 6000, CargoMaterial.STEEL_CRATE, 1
    ),
    Cargo.TALL_CABINET: CargoSpec(
        "cabinet", "Tall cabinet", (1.0, 0.8, 2.2), 700, CargoMaterial.SAWN_WOOD, 2
    ),
    # Forty 25 kg sacks on a wooden pallet.
    Cargo.SACKS: CargoSpec(
        "sacks", "Pallet of sacks", (1.2, 1.0, 1.0), 1000, CargoMaterial.SAWN_WOOD, 3
    ),
    # Steel pipes, 6 m long and 0.5 m across, lying along the truck.
    Cargo.LONG_PIPES: CargoSpec(
        "pipe",
        "Steel pipe",
        (6.0, 0.5, 0.5),
        720,
        CargoMaterial.STEEL_CRATE,
        3,
        per_row=3,
        shape=UnitShape.CYLINDER,
        axis=CylinderAxis.X,
    ),
    Cargo.STACKED_BOXES: CargoSpec(
        "carton",
        "Carton",
        (0.8, 0.6, 0.6),
        80,
        CargoMaterial.CARDBOARD,
        6,
        per_row=3,
        spacing_m=0.2,
    ),
}

GAP_TO_HEADBOARD_M = 0.5
SIDE_CLEARANCE_M = 0.0

# --- Lashings: the same devices as the demo fixtures ---------------------------------------

# A 50 mm ratchet strap: LC 2500 daN, standard tension force 300 daN.
STRAP: dict[str, object] = {"pretension_n": 3000.0, "lashing_capacity_n": 25000.0}
# 10 mm polypropylene rope (see scripts/build_demo_fixtures.py).
ROPE: dict[str, object] = {
    "kind": LashingKind.ROPE,
    "pretension_n": 300.0,
    "lashing_capacity_n": 1000.0,
    "breaking_strength_n": 10150.0,
}
# 8 mm grade 80 lashing chain, LC 4000 daN, tightened by a load binder.
CHAIN: dict[str, object] = {"pretension_n": 2500.0, "lashing_capacity_n": 40000.0}
DIAGONAL_REACH_M = 0.9
BLOCK_LENGTH_M = 0.1
# A coil cradle's chocks are an eighth of the coil's diameter high: for a 1.6 m coil 20 cm,
# which holds up to 0.88 g (physics/analytical.py, roll_over_chock_acceleration).
CRADLE_HEIGHT_SHARE = 1 / 8

DEFAULT_TOP_OVER = {Restraint.TOP_OVER: 2, Restraint.ROPE: 2, Restraint.MAT: 2}


# --- Roads and weather -------------------------------------------------------------------

CURVE_RADIUS_M: dict[Road, float] = {
    Road.STRAIGHT: 250.0,
    Road.CURVY: 60.0,
    Road.MOUNTAIN: 40.0,
    Road.DIRT: 60.0,
    Road.POTHOLED: 120.0,
    Road.URBAN: 30.0,
}
GRADE_PERCENT: dict[Road, float] = {Road.MOUNTAIN: 8.0}
DEFAULT_GRADE_PERCENT = 3.0
TRIP_SEGMENTS: dict[Road, list[EventKind]] = {
    Road.STRAIGHT: [EventKind.LANE_CHANGE, EventKind.EMERGENCY_BRAKING],
    Road.CURVY: [EventKind.SHARP_CURVE, EventKind.LANE_CHANGE, EventKind.EMERGENCY_BRAKING],
    Road.MOUNTAIN: [
        EventKind.MOUNTAIN_DESCENT,
        EventKind.SPEED_BUMP,
        EventKind.EMERGENCY_BRAKING,
    ],
    Road.DIRT: [EventKind.LONG_VIBRATION, EventKind.POTHOLE, EventKind.EMERGENCY_BRAKING],
    Road.POTHOLED: [EventKind.POTHOLE, EventKind.LANE_CHANGE, EventKind.EMERGENCY_BRAKING],
    Road.URBAN: [EventKind.SPEED_BUMP, EventKind.SHARP_CURVE, EventKind.EMERGENCY_BRAKING],
}


def trip_event(trip: DraftTrip) -> TripEvent:
    """The trip event of a draft: the road gives curve radii, grades and segments."""
    dirt = trip.road is Road.DIRT
    surface = {
        Weather.DRY: RoadSurface.GRAVEL if dirt else RoadSurface.DRY,
        Weather.WET: RoadSurface.MUD if dirt else RoadSurface.WET,
        Weather.HEAVY_RAIN: RoadSurface.MUD if dirt else RoadSurface.HEAVY_RAIN,
        Weather.MUD: RoadSurface.MUD,
        Weather.FOG: RoadSurface.GRAVEL if dirt else RoadSurface.DRY,
    }[trip.weather]
    curves = trip.event in (
        EventKind.SHARP_CURVE,
        EventKind.MOUNTAIN_DESCENT,
        EventKind.FULL_TRIP,
    )
    downhill = trip.event in (EventKind.MOUNTAIN_DESCENT, EventKind.FULL_TRIP)
    return TripEvent(
        kind=trip.event,
        speed_kmh=trip.speed_kmh,
        road_surface=surface,
        fog=trip.weather is Weather.FOG,
        curve_radius_m=CURVE_RADIUS_M[trip.road] if curves else None,
        grade_percent=GRADE_PERCENT.get(trip.road, DEFAULT_GRADE_PERCENT) if downhill else None,
        segments=TRIP_SEGMENTS[trip.road] if trip.event is EventKind.FULL_TRIP else None,
    )


# --- Configuration -> draft -----------------------------------------------------------------


def build(config: ExplorerConfig, *, scenario_id: str = "explorer", name: str = "") -> Built:
    """Scenario and event of an explorer configuration (through its draft)."""
    draft = draft_from_config(config)
    scenario, event = build_draft(draft, scenario_id=scenario_id, name=name)
    return Built(config=config, draft=draft, scenario=scenario, event=event)


def draft_from_config(config: ExplorerConfig) -> LoadDraft:
    """The load a configuration describes, unit by unit, with the editor's moves and straps."""
    truck = TRUCKS[config.size]
    cargo = CARGO[config.cargo]
    if config.position is Position.STACKED and cargo.shape is UnitShape.CYLINDER:
        raise BuildError("cannot_stack", f"{cargo.label} units cannot be stacked here.")
    count = config.count or min(cargo.count, _fits(config, truck, cargo))
    footprints = _layout(config, truck, cargo, count)
    anchors = _anchors(truck)
    stacked = config.position is Position.STACKED

    moves = {move.index: (move.x_m, move.y_m) for move in config.moves}
    if config.straps is not None and len(config.straps) != count:
        raise BuildError("straps_mismatch", "straps needs one value per unit (or stack).")
    units: list[DraftUnit] = []
    for layer in range(2 if stacked else 1):
        for index, footprint in enumerate(footprints):
            number = layer * count + index
            # A stack moves as one: the top unit follows the unit under it.
            x, y = moves.get(index, footprint)
            lashed = (layer == 1) if stacked else True
            if not lashed:
                straps = 0
            elif config.straps is not None:
                straps = config.straps[index]
            else:
                # The default never asks for more straps than there are anchors along the unit.
                wanted = DEFAULT_TOP_OVER.get(config.restraint, 0)
                straps = min(wanted, len(_anchor_pairs(anchors, x, cargo.size_m[0], y)))
            units.append(
                DraftUnit(
                    id=f"{cargo.unit_id}-{number + 1}",
                    cargo=config.cargo,
                    mass_kg=config.mass_kg,
                    x_m=x,
                    y_m=y,
                    on=f"{cargo.unit_id}-{index + 1}" if layer else None,
                    straps=straps,
                )
            )
    return LoadDraft(
        source="explorer",
        truck=DraftTruck(body=config.body, size=config.size),
        trip=DraftTrip(
            speed_kmh=config.speed_kmh,
            road=config.road,
            weather=config.weather,
            event=config.event,
        ),
        restraint=config.restraint,
        units=units,
    )


def _fits(config: ExplorerConfig, truck: TruckSpec, cargo: CargoSpec) -> int:
    """How many units of the cargo fit on the floor in the chosen position (at least 1)."""
    length, width, _ = cargo.size_m
    together = config.position in (Position.HEADBOARD, Position.STACKED, Position.REAR)
    room = truck.length_m - (0.0 if together else GAP_TO_HEADBOARD_M)
    step = length + (0.0 if together else cargo.spacing_m)
    rows = max(1, math.floor((room - length) / step + 1e-9) + 1) if room >= length else 1
    per_row = max(1, min(cargo.per_row, math.floor(truck.width_m / width + 1e-9)))
    return rows * per_row


def _layout(
    config: ExplorerConfig, truck: TruckSpec, cargo: CargoSpec, count: int
) -> list[tuple[float, float]]:
    """Footprint centres of ``count`` units in rows, from the front, in the chosen position."""
    length, width, _ = cargo.size_m
    half_bed = truck.length_m / 2
    if length > truck.length_m or width > truck.width_m:
        raise BuildError("does_not_fit", f"A {cargo.label.lower()} does not fit on this truck.")
    per_row = max(1, min(cargo.per_row, math.floor(truck.width_m / width + 1e-9)))
    rows = math.ceil(count / per_row)
    position = config.position
    together = position in (Position.HEADBOARD, Position.STACKED, Position.REAR)
    step = length + (0.0 if together else cargo.spacing_m)
    if position is Position.REAR:
        front_x = -half_bed + length / 2 + (rows - 1) * step
    elif together:
        front_x = half_bed - length / 2
    else:
        front_x = half_bed - GAP_TO_HEADBOARD_M - length / 2
    if front_x - (rows - 1) * step < -half_bed + length / 2 - 1e-9:
        raise BuildError("does_not_fit", f"{count} units do not fit on this truck.")

    footprints: list[tuple[float, float]] = []
    for row in range(rows):
        in_row = min(per_row, count - row * per_row)
        row_width = in_row * width
        if position is Position.SIDE:
            first_y = truck.width_m / 2 - SIDE_CLEARANCE_M - row_width + width / 2
        else:
            first_y = -row_width / 2 + width / 2
        x = front_x - row * step
        footprints += [(x, first_y + column * width) for column in range(in_row)]
    return [(round(x, 4) + 0.0, round(y, 4) + 0.0) for x, y in footprints]


# --- Draft -> scenario ------------------------------------------------------------------


def build_draft(
    draft: LoadDraft, *, scenario_id: str = "explorer", name: str = ""
) -> tuple[Scenario, TripEvent]:
    """The scenario and trip event of a load draft."""
    truck = TRUCKS[draft.truck.size]
    bed = _bed(draft.truck.body, truck)
    restraint = draft.restraint

    units: list[CargoUnit] = []
    by_id: dict[str, CargoUnit] = {}
    for item in draft.units:
        cargo = CARGO[item.cargo]
        size = item.size_m or cargo.size_m
        z = 0.0
        if item.on is not None:
            below = by_id[item.on]
            if below.shape is UnitShape.CYLINDER:
                raise BuildError("cannot_stack", f"Nothing can stand on {below.id}.")
            z = round(below.position_m[2] + below.size_m[2], 4)
        material = cargo.material
        if restraint is Restraint.MAT and z == 0:
            material = CargoMaterial.RUBBER_MAT
        try:
            unit = CargoUnit(
                id=item.id,
                label=item.label or cargo.label,
                shape=cargo.shape,
                axis=cargo.axis,
                inner_diameter_m=cargo.inner_diameter_m,
                size_m=size,
                mass_kg=float(item.mass_kg or cargo.mass_kg),
                position_m=(item.x_m, item.y_m, z),
                material=material,
            )
        except ValidationError as error:
            raise BuildError("invalid_unit", error.errors()[0]["msg"]) from error
        units.append(unit)
        by_id[unit.id] = unit

    lashings: list[Lashing] = []
    properties = ROPE if restraint is Restraint.ROPE else STRAP
    for item, unit in zip(draft.units, units, strict=True):
        if item.straps == 0:
            continue
        pairs = _anchor_pairs(
            bed.anchor_points, unit.position_m[0], unit.size_m[0], unit.position_m[1]
        )
        if item.straps > len(pairs):
            raise BuildError(
                "not_enough_anchors",
                f"{unit.id} has room for {len(pairs)} lashings over it, not {item.straps}.",
            )
        lashings += _over(unit, pairs, item.straps, properties)
    floor_units = [unit for unit in units if unit.position_m[2] == 0]
    if restraint in (Restraint.DIRECT, Restraint.CHAIN):
        device = CHAIN if restraint is Restraint.CHAIN else STRAP
        kind = LashingKind.CHAIN if restraint is Restraint.CHAIN else LashingKind.STRAP
        for unit in floor_units:
            lashings += _diagonals(unit, bed.anchor_points, kind, device)
    blocks: list[Block] = []
    if restraint in (Restraint.BLOCKING, Restraint.CRADLE):
        blocks = _blocks(truck, units)

    vehicle = Vehicle(axle_groups=(truck.front, truck.rear), payload_kg=truck.payload_kg)
    try:
        scenario = Scenario(
            id=scenario_id,
            name=name or f"Load on a {draft.truck.size.value} {draft.truck.body.value}",
            bed=bed.model_copy(update={"blocks": blocks}),
            vehicle=vehicle,
            units=units,
            lashings=lashings,
        )
    except ValidationError as error:
        text = str(error)
        code = "units_overlap" if "overlap" in text else "invalid_load"
        if "not resting" in text:
            code = "unit_unsupported"
        raise BuildError(code, error.errors()[0]["msg"]) from error
    for unit in units:
        half_x, half_y = unit.size_m[0] / 2, unit.size_m[1] / 2
        x, y, _ = unit.position_m
        if (
            abs(x) + half_x > truck.length_m / 2 + 1e-6
            or abs(y) + half_y > truck.width_m / 2 + 1e-6
        ):
            raise BuildError("off_the_bed", f"{unit.id} hangs over the edge of the bed.")
    return scenario, trip_event(draft.trip)


def _anchors(truck: TruckSpec) -> list[AnchorPoint]:
    return side_anchor_points(
        length_m=truck.length_m, width_m=truck.width_m, spacing_m=ANCHOR_SPACING_M
    )


def _bed(body: BodyType, truck: TruckSpec) -> TruckBed:
    anchors = _anchors(truck)
    if body is BodyType.FLATBED:
        return TruckBed(
            length_m=truck.length_m,
            width_m=truck.width_m,
            floor_height_m=truck.floor_height_m,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            headboard=Headboard(height_m=FLATBED_HEADBOARD_M),
            anchor_points=anchors,
        )
    rated = min(
        FRONT_WALL_SHARE_OF_PAYLOAD * truck.payload_kg * STANDARD_GRAVITY_MPS2, FRONT_WALL_MAX_N
    )
    walls = truck.wall_height_m
    return TruckBed(
        length_m=truck.length_m,
        width_m=truck.width_m,
        floor_height_m=truck.floor_height_m,
        floor_material=FloorMaterial.PLYWOOD_LAMINATE,
        headboard=Headboard(height_m=walls, rated_capacity_n=round(rated, 1)),
        body=body,
        # A curtain does not restrain cargo: a curtain-sider has no side walls in the model.
        side_rail_height_m=walls if body is BodyType.BOX else 0.0,
        rear_wall_height_m=walls,
        anchor_points=anchors,
    )


def _anchor_pairs(
    anchors: list[AnchorPoint], x: float, length: float, y: float
) -> list[tuple[str, str]]:
    """Left and right anchors facing each other along a unit: where a strap can go over it."""
    low, high = x - length / 2, x + length / 2
    left = {a.position_m[0]: a.id for a in anchors if a.position_m[1] > y}
    right = {a.position_m[0]: a.id for a in anchors if a.position_m[1] < y}
    return [(left[ax], right[ax]) for ax in sorted(left) if ax in right and low < ax < high]


def _over(
    unit: CargoUnit, pairs: list[tuple[str, str]], count: int, device: dict[str, object]
) -> list[Lashing]:
    """``count`` top-over lashings spread evenly over the anchor pairs along a unit."""
    chosen = [pairs[round((index + 0.5) * len(pairs) / count - 0.5)] for index in range(count)]
    return [
        Lashing(
            id=f"{unit.id}-s{index + 1}",
            routing=LashingRouting.TOP_OVER,
            unit_id=unit.id,
            anchor_ids=list(pair),
            **{"kind": LashingKind.STRAP, **device},
        )
        for index, pair in enumerate(chosen)
    ]


def _closest_anchor(anchors: list[AnchorPoint], side: int, x: float) -> AnchorPoint:
    return min(
        (anchor for anchor in anchors if anchor.position_m[1] * side > 0),
        key=lambda anchor: abs(anchor.position_m[0] - x),
    )


def _diagonals(
    unit: CargoUnit,
    anchors: list[AnchorPoint],
    kind: LashingKind,
    device: dict[str, object],
) -> list[Lashing]:
    """Four diagonal lashings from the unit to the bed, forward and backward on both sides.

    On a box they start at its corners, 40 cm up (or half its height); on a coil lying across
    the truck they go through its eye, as coils are chained.
    """
    half_x, half_y, height = unit.size_m[0] / 2, unit.size_m[1] / 2, unit.size_m[2]
    through_eye = unit.shape is UnitShape.CYLINDER and unit.axis is CylinderAxis.Y
    lashings = []
    for end, end_name in ((1, "front"), (-1, "rear")):
        for side, side_name in ((1, "left"), (-1, "right")):
            if through_eye:
                point = (0.0, side * half_y, height / 2)
            else:
                point = (end * half_x, side * half_y, min(0.4, height / 2))
            anchor = _closest_anchor(
                anchors, side, unit.position_m[0] + end * (half_x + DIAGONAL_REACH_M)
            )
            lashings.append(
                Lashing(
                    id=f"{unit.id}-{kind.value}-{end_name}-{side_name}",
                    kind=kind,
                    routing=LashingRouting.DIRECT,
                    unit_id=unit.id,
                    anchor_ids=[anchor.id],
                    attachment_point_m=point,
                    **device,
                )
            )
    return lashings


def _blocks(truck: TruckSpec, units: list[CargoUnit]) -> list[Block]:
    """Blocks in front of and behind each row of units, where there is room for them.

    A coil lying across the truck gets a cradle: a chock on each side, an eighth of its
    diameter high. Anything else gets beams at 60 % of the load's height (at most 1.2 m).
    """
    half_bed = truck.length_m / 2
    floor_units = [unit for unit in units if unit.position_m[2] == 0]
    rows: dict[float, list[CargoUnit]] = {}
    for unit in floor_units:
        rows.setdefault(unit.position_m[0], []).append(unit)
    order = sorted(rows, reverse=True)
    stack_height = max(unit.position_m[2] + unit.size_m[2] for unit in units)
    blocks: list[Block] = []
    for row_index, x in enumerate(order):
        row = rows[x]
        first = row[0]
        half_length = first.size_m[0] / 2
        low_y = min(unit.position_m[1] - unit.size_m[1] / 2 for unit in row)
        high_y = max(unit.position_m[1] + unit.size_m[1] / 2 for unit in row)
        cradle = first.shape is UnitShape.CYLINDER and first.axis is CylinderAxis.Y
        if cradle:
            radius = first.size_m[0] / 2
            height = round(first.size_m[0] * CRADLE_HEIGHT_SHARE, 3)
            # The chock touches the coil at its top edge.
            reach = math.sqrt(2 * radius * height - height**2)
            kind = BlockKind.CRADLE
        else:
            height = round(min(0.6 * stack_height, 1.2), 3)
            reach = half_length
            kind = BlockKind.BEAM
        ahead = (
            order[row_index - 1] - rows[order[row_index - 1]][0].size_m[0] / 2
            if row_index
            else half_bed
        )
        behind = (
            order[row_index + 1] + rows[order[row_index + 1]][0].size_m[0] / 2
            if row_index + 1 < len(order)
            else -half_bed
        )
        for direction, name, limit in ((1, "front", ahead), (-1, "rear", behind)):
            near = x + direction * reach
            far = near + direction * BLOCK_LENGTH_M
            if direction * (limit - far) < -1e-6:
                continue  # no room: the headboard, the next row or the bed's edge
            blocks.append(
                Block(
                    id=f"{name}-{row_index + 1}",
                    kind=kind,
                    size_m=(BLOCK_LENGTH_M, round(high_y - low_y, 4), height),
                    position_m=(round((near + far) / 2, 4), round((low_y + high_y) / 2, 4), 0.0),
                )
            )
    return blocks
