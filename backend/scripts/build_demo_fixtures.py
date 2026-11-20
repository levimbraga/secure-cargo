"""Write the four demo fixtures to ``backend/scenarios/demo``.

The fixtures are plain JSON and are what the API serves; this script is how they were made,
so they can be regenerated after a schema change:

    uv run python -m scripts.build_demo_fixtures

The truck is a two-axle rigid truck ("toco") with a 6.2 m flatbed. Its tare and axle
positions are illustrative values for the demo, not data of a specific model.
"""

import json

from app.demo.fixtures import DEMO_DIR, DemoScenario
from app.scenario import (
    AnchorPoint,
    AxleGroup,
    AxleGroupKind,
    CargoMaterial,
    CargoUnit,
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
    Vehicle,
)
from app.scenario.presets import side_anchor_points, top_over_lashings

BED_LENGTH_M = 6.2
BED_WIDTH_M = 2.4
ANCHORS = side_anchor_points(length_m=BED_LENGTH_M, width_m=BED_WIDTH_M, spacing_m=0.4)
BED = TruckBed(
    length_m=BED_LENGTH_M,
    width_m=BED_WIDTH_M,
    floor_height_m=1.25,
    floor_material=FloorMaterial.PLYWOOD_LAMINATE,
    headboard=Headboard(height_m=1.2),
    anchor_points=ANCHORS,
)
# Front axle 0.9 m ahead of the bed, 4.8 m wheelbase; 6 t empty.
# Units are centred on multiples of the 0.4 m anchor spacing so straps land on anchors.
VEHICLE = Vehicle(
    axle_groups=(
        AxleGroup(
            id="front", kind=AxleGroupKind.SINGLE_2_TYRES, position_x_m=4.0, tare_load_kg=3400
        ),
        AxleGroup(
            id="rear", kind=AxleGroupKind.SINGLE_4_TYRES, position_x_m=-0.8, tare_load_kg=2600
        ),
    )
)

# A 50 mm ratchet strap: LC 2500 daN, standard tension force 300 daN.
STRAP = {"pretension_n": 3000.0, "lashing_capacity_n": 25000.0}
# 10 mm polypropylene rope: breaking load 1150 kg minus the 10 % tolerance of the data sheet.
# Hand-tied tension and working load (a tenth of the breaking load) are assumptions.
ROPE = {
    "kind": LashingKind.ROPE,
    "pretension_n": 300.0,
    "lashing_capacity_n": 1000.0,
    "breaking_strength_n": 10150.0,
}
# 8 mm grade 80 lashing chain, LC 4000 daN, tightened by a load binder.
CHAIN = {"pretension_n": 2500.0, "lashing_capacity_n": 40000.0}


def unit(
    unit_id: str,
    label: str,
    size: tuple[float, float, float],
    mass: float,
    x: float,
    material: CargoMaterial,
    y: float = 0.0,
) -> CargoUnit:
    return CargoUnit(
        id=unit_id,
        label=label,
        size_m=size,
        mass_kg=mass,
        position_m=(x, y, 0.0),
        material=material,
    )


def straps(units: list[CargoUnit], count: int, **properties: object) -> list[Lashing]:
    lashings: list[Lashing] = []
    for cargo in units:
        lashings += top_over_lashings(cargo, ANCHORS, count=count, **properties)  # type: ignore[arg-type]
    return lashings


def closest_anchor(side: int, x: float) -> AnchorPoint:
    return min(
        (anchor for anchor in ANCHORS if anchor.position_m[1] * side > 0),
        key=lambda anchor: abs(anchor.position_m[0] - x),
    )


def corner_chains(
    cargo: CargoUnit, reach_m: float = 0.9, eye_height_m: float = 0.4
) -> list[Lashing]:
    """Four diagonal chains from the lashing eyes at the corners of a machine to the bed."""
    half_x, half_y = cargo.size_m[0] / 2, cargo.size_m[1] / 2
    lashings = []
    for end, end_name in ((1, "front"), (-1, "rear")):
        for side, side_name in ((1, "left"), (-1, "right")):
            anchor = closest_anchor(side, cargo.position_m[0] + end * (half_x + reach_m))
            lashings.append(
                Lashing(
                    id=f"{cargo.id}-chain-{end_name}-{side_name}",
                    kind=LashingKind.CHAIN,
                    routing=LashingRouting.DIRECT,
                    unit_id=cargo.id,
                    anchor_ids=[anchor.id],
                    attachment_point_m=(end * half_x, side * half_y, eye_height_m),
                    **CHAIN,
                )
            )
    return lashings


def scenario(
    scenario_id: str, name: str, units: list[CargoUnit], lashings: list[Lashing]
) -> Scenario:
    return Scenario(
        id=scenario_id, name=name, bed=BED, vehicle=VEHICLE, units=units, lashings=lashings
    )


def emergency_braking() -> DemoScenario:
    wood = CargoMaterial.SAWN_WOOD
    pallets = [
        unit(f"pallet-{index + 1}", "Palletised cargo", (1.2, 1.0, 1.1), 900, x, wood)
        for index, x in enumerate((2.0, 0.4, -1.2))
    ]
    return DemoScenario(
        id="emergency-braking",
        title="Emergency braking",
        summary=(
            "Three 900 kg pallets with one strap each: under emergency braking from 80 km/h "
            "they slide forward and the first one hits the headboard. With two straps each "
            "they stay put."
        ),
        event=TripEvent(kind=EventKind.EMERGENCY_BRAKING, speed_kmh=80),
        as_loaded=scenario(
            "emergency-braking-as-loaded",
            "Three pallets, one strap each",
            pallets,
            straps(pallets, 1, **STRAP),
        ),
        fixed=scenario(
            "emergency-braking-fixed",
            "Three pallets, two straps each",
            pallets,
            straps(pallets, 2, **STRAP),
        ),
    )


def weigh_station() -> DemoScenario:
    steel, wood = CargoMaterial.STEEL_CRATE, CargoMaterial.SAWN_WOOD

    def load(
        machine_x: float, crate_xs: tuple[float, float]
    ) -> tuple[list[CargoUnit], list[Lashing]]:
        machine = unit(
            "machine", "Machine on a steel skid", (2.0, 1.6, 1.2), 6000, machine_x, steel
        )
        crates = [
            unit(f"crate-{index + 1}", "Crate of parts", (1.2, 1.0, 1.0), 1500, x, wood)
            for index, x in enumerate(crate_xs)
        ]
        return [machine, *crates], [*corner_chains(machine), *straps(crates, 2, **STRAP)]

    as_loaded = load(-1.6, (0.4, 2.0))
    fixed = load(1.2, (-0.8, -2.4))
    return DemoScenario(
        id="weigh-station",
        title="Weigh station",
        summary=(
            "A 6 t machine loaded at the back: its chains hold it over the speed bump, but the "
            "rear axle carries 11.35 t, above the 10 t legal limit. Moving the machine forward "
            "brings both axles within their limits."
        ),
        event=TripEvent(kind=EventKind.SPEED_BUMP, speed_kmh=20),
        as_loaded=scenario("weigh-station-as-loaded", "Machine at the rear", *as_loaded),
        fixed=scenario("weigh-station-fixed", "Machine moved forward", *fixed),
    )


def rope_lashing() -> DemoScenario:
    plastic = CargoMaterial.PLASTIC_PALLET
    stacks = [
        unit(f"stack-{index + 1}", "Crates on a plastic pallet", (1.2, 1.0, 1.3), 800, x, plastic)
        for index, x in enumerate((1.6, 0.0, -1.6))
    ]
    return DemoScenario(
        id="rope-lashing",
        title="Rope lashing",
        summary=(
            "Three stacks on plastic pallets tied down with rope: rope stretches and cannot be "
            "tightened enough, so the stacks slide in a sudden lane change. Rope is also "
            "prohibited as cargo lashing (CONTRAN Resolution 945/2022). Three ratchet straps "
            "per stack hold them."
        ),
        event=TripEvent(kind=EventKind.LANE_CHANGE, speed_kmh=80),
        as_loaded=scenario(
            "rope-lashing-as-loaded", "Stacks tied with rope", stacks, straps(stacks, 2, **ROPE)
        ),
        fixed=scenario(
            "rope-lashing-fixed", "Stacks under ratchet straps", stacks, straps(stacks, 3, **STRAP)
        ),
    )


def sharp_curve() -> DemoScenario:
    wood = CargoMaterial.SAWN_WOOD
    cabinets = [
        unit(f"cabinet-{index + 1}", "Tall cabinet", (1.0, 0.8, 2.2), 700, x, wood)
        for index, x in enumerate((2.4, 1.2))
    ]
    return DemoScenario(
        id="sharp-curve",
        title="Sharp curve",
        summary=(
            "Two tall cabinets standing free behind the headboard: in a sharp curve at 60 km/h "
            "they tip over. Two straps over each one keep them upright."
        ),
        event=TripEvent(
            kind=EventKind.SHARP_CURVE,
            speed_kmh=60,
            curve_radius_m=60,
            road_surface=RoadSurface.DRY,
        ),
        as_loaded=scenario("sharp-curve-as-loaded", "Cabinets standing free", cabinets, []),
        fixed=scenario(
            "sharp-curve-fixed",
            "Cabinets under two straps each",
            cabinets,
            straps(cabinets, 2, **STRAP),
        ),
    )


def main() -> None:
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    for demo in (emergency_braking(), weigh_station(), rope_lashing(), sharp_curve()):
        path = DEMO_DIR / f"{demo.id}.json"
        path.write_text(json.dumps(demo.model_dump(mode="json"), indent=2) + "\n")
        print(f"wrote {path.relative_to(DEMO_DIR.parents[1])}")


if __name__ == "__main__":
    main()
