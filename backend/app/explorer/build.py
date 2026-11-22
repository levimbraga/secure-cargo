"""Explorer configuration -> scenario and trip event.

Every number here is either the same as in the demo fixtures or an illustrative value for a
typical Brazilian truck; the list with sources and assumptions is in the workspace's
``notes/physics-sources.md`` ("Explorer presets"). None of it describes a specific model.
"""

import math
from dataclasses import dataclass, replace

from pydantic import ValidationError

from app.explorer.config import (
    BodyCode,
    Cargo,
    Country,
    ExplorerConfig,
    Position,
    Restraint,
    Road,
    Size,
    Weather,
)
from app.explorer.draft import DraftLashing, DraftTrip, DraftTruck, DraftUnit, LoadDraft
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
    headboard_m: float | None = None  # flatbeds; None: FLATBED_HEADBOARD_M


def _lb(pounds: float) -> float:
    """Pounds to kilograms, rounded to 1 kg (the US presets are typical values in pounds)."""
    return round(pounds * 0.45359237)


# US presets (notes/us-rules.md, section 4). A tractor-semitrailer is modelled like the Brazilian
# semi: the bed rests on a group at the kingpin (the tractor's drive tandem carries it) and on the
# trailer's tandem; the US rules share the kingpin load between the steer axle and the drive
# tandem (rules/us_weights.py). Positions: X forward from the centre of the bed [m].
US_FOOT_M = 0.3048
US_TRUCKS: dict[Size, TruckSpec] = {
    # Class 6 box truck: 26 ft box, steer axle and a single rear axle with duals, 260 in wheelbase.
    Size.US_BOX: TruckSpec(
        length_m=7.92,
        width_m=2.44,
        floor_height_m=1.12,
        wall_height_m=2.44,
        front=AxleGroup(
            id="steer", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.8, tare_load_kg=_lb(7050)
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-1.8, tare_load_kg=_lb(5950)
        ),
        payload_kg=_lb(11_900),
    ),
    # Straight truck: 24 ft bed, steer axle and a tandem (52 in spread), 228 in wheelbase.
    Size.US_STRAIGHT: TruckSpec(
        length_m=7.32,
        width_m=2.44,
        floor_height_m=1.32,
        wall_height_m=2.44,
        front=AxleGroup(
            id="steer", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.6, tare_load_kg=_lb(9480)
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.TANDEM_2_AXLES, position_x_m=-1.2, tare_load_kg=_lb(9260)
        ),
        payload_kg=_lb(24_250),
        headboard_m=1.22,
    ),
    # 48 ft flatbed: kingpin 36 in behind the front. The trailer group is a 10 ft spread axle
    # whose rear axle sits 1.75 m from the rear end (ASSUMPTION, as the Brazilian semi's), so
    # its centre is 3.27 m from the rear; the rules check it as one tandem group at that centre.
    # The kingpin group carries the trailer's front share and the tractor's drive tandem tare.
    Size.US_FLATBED_48: TruckSpec(
        length_m=14.63,
        width_m=2.59,
        floor_height_m=1.52,
        wall_height_m=2.59,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=6.4,
            tare_load_kg=_lb(8000 + 4000),
        ),
        rear=AxleGroup(
            id="trailer",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=-4.05,
            tare_load_kg=_lb(6000),
        ),
        payload_kg=_lb(48_000),
        headboard_m=1.22,
    ),
    # 53 ft dry van: 52 ft 6 in inside, 100 in wide, 110 in tall; tandem slid to the rear.
    Size.US_DRY_VAN_53: TruckSpec(
        length_m=16.0,
        width_m=2.54,
        floor_height_m=1.22,
        wall_height_m=2.79,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=7.09,
            tare_load_kg=_lb(8000 + 6000),
        ),
        rear=AxleGroup(
            id="trailer",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=-5.6,
            tare_load_kg=_lb(9000),
        ),
        payload_kg=_lb(45_000),
    ),
    # Step deck: the 38 ft lower deck at 40 in; the 10 ft upper deck (60 in) and the kingpin are
    # ahead of it. Its "headboard" is the 20 in step up to the upper deck.
    Size.US_STEP_DECK: TruckSpec(
        length_m=11.58,
        width_m=2.59,
        floor_height_m=1.02,
        wall_height_m=2.59,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=7.93,
            tare_load_kg=_lb(8000 + 4400),
        ),
        rear=AxleGroup(
            id="trailer",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=-4.0,
            tare_load_kg=_lb(6600),
        ),
        payload_kg=_lb(47_000),
        headboard_m=0.51,
    ),
}


# EU presets (notes/eu-rules.md, section 4): typical values, our assumptions, not a specific model.
# A 40 t articulated vehicle is modelled like the other semis: the bed rests on a group at the
# kingpin (the tractor carries it) and on the trailer's tri-axle. Under EU rules the kingpin load
# is shared between the 4x2 tractor's steer and driving axles (rules/eu_weights.py); under
# Brazil's and the US rules the kingpin group is checked as one tandem group.
EU_TRUCKS: dict[Size, TruckSpec] = {
    # 7.5 t rigid: 6.2 m body, wheelbase 4.5 m, plated 7.5 t. The steer axle sits under the
    # cab, 1.0 m ahead of the body (ASSUMPTION, all three rigids: a cab-over's steer axle is
    # about 1.0-1.5 m ahead of the body; consistency fixes, 2026-11-22).
    Size.EU_7_5T: TruckSpec(
        length_m=6.2,
        width_m=2.45,
        floor_height_m=1.0,
        wall_height_m=2.3,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.1, tare_load_kg=2700
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.4, tare_load_kg=1600
        ),
        payload_kg=3200,
    ),
    # 18 t rigid, two axles: 7.3 m body, wheelbase 5.5 m, steer axle 1.2 m ahead of the body.
    Size.EU_18T: TruckSpec(
        length_m=7.3,
        width_m=2.48,
        floor_height_m=1.25,
        wall_height_m=2.5,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.85, tare_load_kg=4600
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.65, tare_load_kg=2900
        ),
        payload_kg=10500,
    ),
    # 26 t rigid, three axles: 9.5 m body, driving tandem 1.37 m apart (twin tyres, air); steer
    # axle 1.0 m ahead of the body (11.9 m overall, within the 12 m of 96/53/EC), 6.3 m from the
    # tandem's centre.
    Size.EU_26T: TruckSpec(
        length_m=9.5,
        width_m=2.48,
        floor_height_m=1.3,
        wall_height_m=2.5,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=5.75, tare_load_kg=5700
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.TANDEM_2_AXLES, position_x_m=-0.55, tare_load_kg=4800
        ),
        payload_kg=15500,
    ),
    # 13.6 m semi-trailer (2.48 m wide, 2.70 m inside): kingpin 1.6 m behind the front (12.0 m
    # to the rear, the 96/53/EC maximum), tri-axle centre 7.8 m behind the kingpin. The kingpin
    # group carries the tractor's driving-axle tare (2,400 kg) and the trailer's front share.
    Size.EU_SEMI_136: TruckSpec(
        length_m=13.6,
        width_m=2.48,
        floor_height_m=1.2,
        wall_height_m=2.7,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=5.2,
            tare_load_kg=2400 + 2000,
        ),
        rear=AxleGroup(
            id="trailer",
            kind=AxleGroupKind.TANDEM_3_AXLES,
            position_x_m=-2.6,
            tare_load_kg=4800,
        ),
        payload_kg=25000,
    ),
    # 13.6 m flatbed semi-trailer with a 1.6 m headboard.
    Size.EU_FLATBED_136: TruckSpec(
        length_m=13.6,
        width_m=2.48,
        floor_height_m=1.3,
        wall_height_m=2.7,
        front=AxleGroup(
            id="tractor",
            kind=AxleGroupKind.TANDEM_2_AXLES,
            position_x_m=5.2,
            tare_load_kg=2400 + 1800,
        ),
        rear=AxleGroup(
            id="trailer",
            kind=AxleGroupKind.TANDEM_3_AXLES,
            position_x_m=-2.6,
            tare_load_kg=4200,
        ),
        payload_kg=25000,
        headboard_m=1.6,
    ),
}
# Overall length of each EU preset [m], for 96/53/EC Annex I 1.1 (cab and coupling included).
EU_OVERALL_LENGTH_M: dict[Size, float] = {
    Size.EU_7_5T: 8.5,
    Size.EU_18T: 10.0,
    Size.EU_26T: 11.9,
    Size.EU_SEMI_136: 16.5,
    Size.EU_FLATBED_136: 16.5,
}


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
    # A "3/4": a light two-axle truck between the VUC and the toco (illustrative values).
    Size.THREE_QUARTER: TruckSpec(
        length_m=5.2,
        width_m=2.3,
        floor_height_m=1.1,
        wall_height_m=2.3,
        front=AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=3.5, tare_load_kg=2300
        ),
        rear=AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.7, tare_load_kg=1900
        ),
        payload_kg=5000,
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
    # triple axle; the tractor's steer axle is not modelled. The tri-axle's centre is 3.0 m
    # from the rear, so its last axle (1.25 m spread) sits 1.75 m from the rear (ASSUMPTION:
    # a trailer carries its last axle about 1.5-2 m in; consistency fixes, 2026-11-22).
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
            id="trailer", kind=AxleGroupKind.TANDEM_3_AXLES, position_x_m=-3.2, tare_load_kg=5500
        ),
        payload_kg=28000,
    ),
    **US_TRUCKS,
    **EU_TRUCKS,
}
FLATBED_HEADBOARD_M = 1.2
# ASSUMPTION: the front wall of a box or curtain-sider body is an EN 12642 code L wall, rated for
# 0.4 P (P = payload), at most 5,000 daN. EN 12642:2016 itself is paywalled; the figures are those
# of the EU's 2014 cargo-securing guidelines (sections 2.1 and 2.2) and the IRU's 2014 guidelines
# (section 2.2), which agree (checked 2026-11-21). A real truck's wall may be weaker or stronger.
FRONT_WALL_SHARE_OF_PAYLOAD = 0.4
FRONT_WALL_MAX_N = 50_000.0
# EN 12642 code XL (the same guidelines, section 2.2 and figure 6): the headboard holds 0.5 P
# with no cap, and the side walls, curtains included, 0.4 P. An XL curtain-sider's curtains are
# modelled as side walls (rigid, like a box body's); the rules check the 0.4 P they are rated for.
FRONT_WALL_XL_SHARE = 0.5


def wall_strength_n(code: BodyCode | None, payload_kg: float) -> float:
    """The front wall's rated strength [N] for an EN 12642 code (None: code L assumed)."""
    if code is BodyCode.XL:
        return FRONT_WALL_XL_SHARE * payload_kg * STANDARD_GRAVITY_MPS2
    return min(FRONT_WALL_SHARE_OF_PAYLOAD * payload_kg * STANDARD_GRAVITY_MPS2, FRONT_WALL_MAX_N)


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
# Each further set of diagonals: 20 cm further inside the unit, 40 cm further along the bed.
DIAGONAL_SET_INSET_M = 0.2
DIAGONAL_SET_REACH_M = 0.4
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
                reach = _strap_reach(cargo.shape, cargo.axis, cargo.size_m)
                straps = min(wanted, len(_anchor_pairs(anchors, x, reach, y)))
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
        country=config.country,
        truck=DraftTruck(body=config.body, size=config.size, body_code=config.body_code),
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


def truck_spec(truck: DraftTruck) -> TruckSpec:
    """The truck of a draft: its size's usual truck, with the bed length the driver saved.

    The axle groups stay where they are on the usual truck (a longer bed hangs further behind
    the rear axle), so a saved length may differ from the usual one by a quarter at most.
    """
    spec = TRUCKS[truck.size]
    if truck.bed_length_m is None:
        return spec
    length = min(max(truck.bed_length_m, spec.length_m * 0.75), spec.length_m * 1.25)
    return replace(spec, length_m=round(length, 3))


def build_draft(
    draft: LoadDraft, *, scenario_id: str = "explorer", name: str = ""
) -> tuple[Scenario, TripEvent]:
    """The scenario and trip event of a load draft."""
    truck = truck_spec(draft.truck)
    bed = _bed(
        draft.truck.body,
        truck,
        headboard_m=draft.truck.headboard_height_m,
        anchors_per_side=draft.truck.anchors_per_side,
        code=draft.truck.body_code,
        country=draft.country,
    )
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
        if item.lashings is not None:
            lashings += _by_hand(unit, item.lashings, bed.anchor_points)
            continue
        if item.straps == 0:
            continue
        pairs = _anchor_pairs(
            bed.anchor_points,
            unit.position_m[0],
            _strap_reach(unit.shape, unit.axis, unit.size_m),
            unit.position_m[1],
        )
        if item.straps > len(pairs):
            raise BuildError(
                "not_enough_anchors",
                f"{unit.id} has room for {len(pairs)} lashings over it, not {item.straps}.",
            )
        lashings += _over(unit, pairs, item.straps, properties)
    floor_units = [unit for unit in units if unit.position_m[2] == 0]
    if restraint in (Restraint.DIRECT, Restraint.CHAIN, Restraint.CRADLE_CHAIN):
        chained = restraint is not Restraint.DIRECT
        device = CHAIN if chained else STRAP
        kind = LashingKind.CHAIN if chained else LashingKind.STRAP
        sets = {item.id: item.diagonal_sets for item in draft.units}
        by_hand = {item.id for item in draft.units if item.lashings is not None}
        for unit in floor_units:
            if unit.id in by_hand:
                continue
            lashings += _diagonals(unit, bed.anchor_points, kind, device, sets.get(unit.id, 1))
    blocks: list[Block] = []
    if restraint in (Restraint.BLOCKING, Restraint.CRADLE, Restraint.CRADLE_CHAIN):
        blocks = _blocks(truck, units)

    vehicle = Vehicle(
        axle_groups=(truck.front, truck.rear),
        payload_kg=truck.payload_kg,
        size=draft.truck.size.value,
    )
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


def strap_room(scenario: Scenario, unit_id: str) -> int:
    """How many top-over straps fit over a unit: the anchor pairs facing each other along it."""
    unit = next(u for u in scenario.units if u.id == unit_id)
    return len(
        _anchor_pairs(
            scenario.bed.anchor_points,
            unit.position_m[0],
            _strap_reach(unit.shape, unit.axis, unit.size_m),
            unit.position_m[1],
        )
    )


def _anchors(truck: TruckSpec, per_side: int | None = None) -> list[AnchorPoint]:
    """Lashing points along both edges; a saved truck gives how many there are per side."""
    spacing = ANCHOR_SPACING_M if per_side is None else max(truck.length_m / per_side, 0.3)
    return side_anchor_points(length_m=truck.length_m, width_m=truck.width_m, spacing_m=spacing)


def _bed(
    body: BodyType,
    truck: TruckSpec,
    *,
    headboard_m: float | None = None,
    anchors_per_side: int | None = None,
    code: BodyCode | None = None,
    country: Country = Country.BR,
) -> TruckBed:
    anchors = _anchors(truck, anchors_per_side)
    if body is BodyType.FLATBED:
        # A flatbed's headboard has no rating unless the driver gives its EN 12642 code.
        return TruckBed(
            length_m=truck.length_m,
            width_m=truck.width_m,
            floor_height_m=truck.floor_height_m,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            headboard=Headboard(
                height_m=headboard_m or truck.headboard_m or FLATBED_HEADBOARD_M,
                rated_capacity_n=(
                    round(wall_strength_n(code, truck.payload_kg), 1) if code else None
                ),
            ),
            anchor_points=anchors,
        )
    rated = wall_strength_n(code, truck.payload_kg)
    walls = truck.wall_height_m
    # CONTRAN 945/2022 art. 9: a curtain is never a containment in Brazil, and no US rule rates
    # one; only EU rules credit an EN 12642 XL curtain (rules audit item 7).
    sides = body is BodyType.BOX or (code is BodyCode.XL and country is Country.EU)
    return TruckBed(
        length_m=truck.length_m,
        width_m=truck.width_m,
        floor_height_m=truck.floor_height_m,
        floor_material=FloorMaterial.PLYWOOD_LAMINATE,
        headboard=Headboard(height_m=walls, rated_capacity_n=round(rated, 1)),
        body=body,
        # A code L curtain does not restrain cargo: that curtain-sider has no side walls in the
        # model. An XL curtain is rated for 0.4 P: modelled as a wall, in EU mode only.
        side_rail_height_m=walls if sides else 0.0,
        rear_wall_height_m=walls,
        anchor_points=anchors,
    )


# A strap goes over a unit at least this far inside its ends: on the very edge it would
# slip off (lashing audit, notes/lashing-audit.md).
STRAP_EDGE_MARGIN_M = 0.05


def _strap_reach(
    shape: UnitShape, axis: CylinderAxis | None, size: tuple[float, float, float]
) -> float:
    """How far from a unit's centre, along the bed, a top-over strap can cross it.

    A coil lying across the truck is round along the bed: a strap along its axis presses on it
    only near the crest, so it goes within a quarter of the diameter of the centre.
    """
    if shape is UnitShape.CYLINDER and axis is CylinderAxis.Y:
        return size[0] / 4
    return size[0] / 2 - STRAP_EDGE_MARGIN_M


def _anchor_pairs(
    anchors: list[AnchorPoint], x: float, reach: float, y: float
) -> list[tuple[str, str]]:
    """Left and right anchors facing each other along a unit: where a strap can go over it.

    ``reach``: how far from the unit's centre along the bed (``_strap_reach``).
    """
    left = {a.position_m[0]: a.id for a in anchors if a.position_m[1] > y}
    right = {a.position_m[0]: a.id for a in anchors if a.position_m[1] < y}
    return [
        (left[ax], right[ax]) for ax in sorted(left) if ax in right and abs(ax - x) <= reach + 1e-6
    ]


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


DEVICES: dict[LashingKind, dict[str, object]] = {
    LashingKind.STRAP: STRAP,
    LashingKind.CHAIN: CHAIN,
    LashingKind.ROPE: ROPE,
}


def _by_hand(
    unit: CargoUnit, items: list[DraftLashing], anchors: list[AnchorPoint]
) -> list[Lashing]:
    """The lashings a user set on a unit: each on the lashing points it names.

    A lashing over the top must cross the unit (both points within its strap reach, on
    opposite sides); a diagonal goes from a corner of the unit, 40 cm up (or half its height),
    or through the eye of a coil lying across the truck, to its point.
    """
    known = {anchor.id: anchor for anchor in anchors}
    reach = _strap_reach(unit.shape, unit.axis, unit.size_m)
    half_x, half_y, height = unit.size_m[0] / 2, unit.size_m[1] / 2, unit.size_m[2]
    through_eye = unit.shape is UnitShape.CYLINDER and unit.axis is CylinderAxis.Y
    out: list[Lashing] = []
    for index, item in enumerate(items):
        missing = [a for a in item.anchors if a not in known]
        if missing:
            raise BuildError("unknown_anchor", f"{unit.id}: no lashing point {missing[0]}.")
        device = {"kind": item.kind, **DEVICES[item.kind]}
        if item.routing is LashingRouting.TOP_OVER:
            first, second = (known[a].position_m for a in item.anchors)
            crosses = all(abs(p[0] - unit.position_m[0]) <= reach + 1e-6 for p in (first, second))
            sides = (first[1] - unit.position_m[1]) * (second[1] - unit.position_m[1]) < 0
            if not (crosses and sides):
                raise BuildError(
                    "lashing_misplaced",
                    f"{unit.id}: a lashing over the top needs a point on each side along it.",
                )
            out.append(
                Lashing(
                    id=f"{unit.id}-h{index + 1}",
                    routing=LashingRouting.TOP_OVER,
                    unit_id=unit.id,
                    anchor_ids=list(item.anchors),
                    **device,
                )
            )
            continue
        corner = item.corner or "front_left"
        end = 1 if corner.startswith("front") else -1
        side = 1 if corner.endswith("left") else -1
        if through_eye:
            point = (0.0, side * half_y, height / 2)
        else:
            point = (end * half_x, side * half_y, min(0.4, height / 2))
        out.append(
            Lashing(
                id=f"{unit.id}-h{index + 1}",
                routing=LashingRouting.DIRECT,
                unit_id=unit.id,
                anchor_ids=list(item.anchors),
                attachment_point_m=point,
                **device,
            )
        )
    return out


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
    sets: int = 1,
) -> list[Lashing]:
    """Diagonal lashings from the unit to the bed, forward and backward on both sides: four per set.

    On a box they start at its corners, 40 cm up (or half its height); on a coil lying across
    the truck they go through its eye, as coils are chained. A second or third set starts a bit
    further inside the unit and reaches a lashing point further along the bed, so no two share
    a point where the bed has room.
    """
    half_x, half_y, height = unit.size_m[0] / 2, unit.size_m[1] / 2, unit.size_m[2]
    through_eye = unit.shape is UnitShape.CYLINDER and unit.axis is CylinderAxis.Y
    lashings = []
    for index in range(sets):
        lashings += _diagonal_set(
            unit, anchors, kind, device, index, half_x, half_y, height, through_eye
        )
    return lashings


def _diagonal_set(
    unit: CargoUnit,
    anchors: list[AnchorPoint],
    kind: LashingKind,
    device: dict[str, object],
    index: int,
    half_x: float,
    half_y: float,
    height: float,
    through_eye: bool,
) -> list[Lashing]:
    inset = min(DIAGONAL_SET_INSET_M * index, half_x / 2)
    reach = DIAGONAL_REACH_M + DIAGONAL_SET_REACH_M * index
    suffix = "" if index == 0 else f"-{index + 1}"
    lashings = []
    for end, end_name in ((1, "front"), (-1, "rear")):
        for side, side_name in ((1, "left"), (-1, "right")):
            if through_eye:
                point = (end * inset, side * half_y, height / 2)
            else:
                point = (end * (half_x - inset), side * half_y, min(0.4, height / 2))
            anchor = _closest_anchor(anchors, side, unit.position_m[0] + end * (half_x + reach))
            lashings.append(
                Lashing(
                    id=f"{unit.id}-{kind.value}-{end_name}-{side_name}{suffix}",
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
