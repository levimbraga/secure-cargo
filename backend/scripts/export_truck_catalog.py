"""The truck catalog the frontend draws its side views from, at one scale for every truck.

The bed, the deck height, the walls, the payload, the tare and the axle groups come from the
trucks the simulation and the rules use (``app/explorer/build.py``). What the simulation does not
model, the cab and the tractor's own axles, comes from the typical values below (our assumptions,
documented in the workspace's ``notes/illustrations-report.md``). Every position is measured in
metres from the front bumper, towards the rear:

    uv run python -m scripts.export_truck_catalog

Writes ``frontend/lib/inspection/truck-catalog.json``; ``tests/test_truck_catalog.py`` fails
when the file is out of date with the simulation's trucks.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.explorer.build import EU_OVERALL_LENGTH_M, FLATBED_HEADBOARD_M, TRUCKS, TruckSpec
from app.explorer.config import EU_SIZES, US_SIZES, Size
from app.scenario import AxleGroupKind

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend" / "lib" / "inspection" / "truck-catalog.json"
LB_KG = 0.45359237


@dataclass(frozen=True)
class Cab:
    kind: str  # "cab_over" (engine under the cab) or "conventional" (a hood in front)
    length_m: float  # bumper to the back of the cab
    height_m: float  # ground to the roof
    steer_m: float  # bumper to the steer axle


@dataclass(frozen=True)
class Tractor:
    """A tractor's own axles, which the simulation folds into one group at the kingpin."""

    steer_to_drive_m: float  # steer axle to the centre of the driving axle(s)
    drive_axles: int
    drive_spread_m: float  # between the two driving axles of a tandem
    fifth_wheel_ahead_m: float  # kingpin ahead of the driving axles' centre
    steer_tare_kg: float  # not modelled by the simulation; added for the gross weight


# Typical values (ASSUMPTION, round numbers inside the ranges of manufacturers' spec sheets).
LIGHT_CAB = Cab("cab_over", 1.7, 2.5, 1.1)
CABS: dict[Size, Cab] = {
    Size.VUC: LIGHT_CAB,
    Size.THREE_QUARTER: Cab("cab_over", 1.8, 2.6, 1.15),
    Size.TOCO: Cab("cab_over", 2.1, 2.9, 1.3),
    Size.TRUCK: Cab("cab_over", 2.1, 3.0, 1.3),
    Size.SEMI: Cab("cab_over", 2.3, 3.3, 1.35),
    # US rigids: low cab-overs, the usual Class 6 box truck; the tractors are conventionals.
    Size.US_BOX: Cab("cab_over", 2.1, 2.6, 1.25),
    Size.US_STRAIGHT: Cab("cab_over", 2.2, 2.8, 1.3),
    Size.US_FLATBED_48: Cab("conventional", 4.6, 3.7, 1.0),
    Size.US_DRY_VAN_53: Cab("conventional", 4.6, 3.7, 1.0),
    Size.US_STEP_DECK: Cab("conventional", 4.6, 3.7, 1.0),
    Size.EU_7_5T: Cab("cab_over", 1.7, 2.7, 1.2),
    Size.EU_18T: Cab("cab_over", 2.1, 3.1, 1.35),
    Size.EU_26T: Cab("cab_over", 2.2, 3.2, 1.4),
    Size.EU_SEMI_136: Cab("cab_over", 2.3, 3.8, 1.4),
    Size.EU_FLATBED_136: Cab("cab_over", 2.3, 3.8, 1.4),
}
BR_TRACTOR = Tractor(3.3, 2, 1.36, 0.3, 5000.0)  # 6x4
US_TRACTOR = Tractor(5.6, 2, 1.32, 0.3, 11_000 * LB_KG)  # notes/us-rules.md section 4
EU_TRACTOR = Tractor(3.7, 1, 0.0, 0.55, 5000.0)  # 4x2, notes/eu-rules.md section 4
TRACTORS: dict[Size, Tractor] = {
    Size.SEMI: BR_TRACTOR,
    Size.US_FLATBED_48: US_TRACTOR,
    Size.US_DRY_VAN_53: US_TRACTOR,
    Size.US_STEP_DECK: US_TRACTOR,
    Size.EU_SEMI_136: EU_TRACTOR,
    Size.EU_FLATBED_136: EU_TRACTOR,
}
# Distance between the axles of a group the simulation treats as one load point [m].
SPREAD_M: dict[Size, float] = {
    Size.TRUCK: 1.36,
    Size.SEMI: 1.25,
    Size.US_STRAIGHT: 1.32,  # 52 in
    Size.US_FLATBED_48: 3.05,  # a spread axle: 10 ft (the rules check it as a 49 in tandem)
    Size.US_DRY_VAN_53: 1.245,  # 49 in, on a slider
    Size.US_STEP_DECK: 1.245,
    Size.EU_26T: 1.37,
    Size.EU_SEMI_136: 1.31,
    Size.EU_FLATBED_136: 1.31,
}
CAB_GAP_M = 0.15  # between the back of the cab and the front of a rigid body
# Step deck: the 10 ft upper deck at 60 in (notes/us-rules.md section 4).
UPPER_DECK = {"length_m": 3.05, "floor_m": 1.52}
SLIDER = {Size.US_DRY_VAN_53}
WHEEL_DIAMETER_M = {Size.VUC: 0.8, Size.THREE_QUARTER: 0.85, Size.EU_7_5T: 0.85}
GROUP_AXLES = {
    AxleGroupKind.SINGLE_2_TYRES: 1,
    AxleGroupKind.SINGLE_4_TYRES: 1,
    AxleGroupKind.TANDEM_2_AXLES: 2,
    AxleGroupKind.TANDEM_3_AXLES: 3,
}


def _country(size: Size) -> str:
    return "US" if size in US_SIZES else "EU" if size in EU_SIZES else "BR"


def _group(centre_m: float, axles: int, spread_m: float) -> list[float]:
    first = centre_m - spread_m * (axles - 1) / 2
    return [round(first + n * spread_m, 3) for n in range(axles)]


def entry(size: Size, spec: TruckSpec) -> dict[str, Any]:
    cab = CABS[size]
    tractor = TRACTORS.get(size)
    half = spec.length_m / 2
    spread = SPREAD_M.get(size, 1.3)
    upper = UPPER_DECK if size == Size.US_STEP_DECK else None
    axles: list[dict[str, Any]] = [{"x_m": cab.steer_m, "group": "steer"}]
    if tractor:
        drive = cab.steer_m + tractor.steer_to_drive_m
        kingpin = drive - tractor.fifth_wheel_ahead_m
        # The simulation's front group is the kingpin: the deck starts where the kingpin sits.
        deck_front = kingpin + (spec.front.position_x_m - half)
        trailer_front = deck_front - (upper["length_m"] if upper else 0.0)
        axles += [
            {"x_m": x, "group": "drive"}
            for x in _group(drive, tractor.drive_axles, tractor.drive_spread_m)
        ]
        trailer_centre = deck_front + half - spec.rear.position_x_m
        axles += [
            {"x_m": x, "group": "trailer"}
            for x in _group(trailer_centre, GROUP_AXLES[spec.rear.kind], spread)
        ]
        gross_kg = (
            tractor.steer_tare_kg
            + spec.front.tare_load_kg
            + spec.rear.tare_load_kg
            + spec.payload_kg
        )
        coupling: dict[str, Any] | None = {
            "kingpin_x_m": round(kingpin, 3),
            "trailer_front_x_m": round(trailer_front, 3),
            "frame_end_x_m": round(drive + 0.9, 3),
        }
    else:
        # A rigid: the steer axle where the cab puts it, unless the body would then overlap the
        # cab; the simulation's axle positions relative to the body always win (an EU rigid's
        # front axle then sits under the back of the cab: see the report).
        ahead = spec.front.position_x_m - half
        deck_front = max(cab.steer_m + ahead, cab.length_m + CAB_GAP_M)
        trailer_front = deck_front
        axles[0]["x_m"] = round(deck_front - ahead, 3)
        rear_centre = deck_front + half - spec.rear.position_x_m
        axles += [
            {"x_m": x, "group": "rear"}
            for x in _group(rear_centre, GROUP_AXLES[spec.rear.kind], spread)
        ]
        gross_kg = spec.front.tare_load_kg + spec.rear.tare_load_kg + spec.payload_kg
        coupling = None
    length = deck_front + spec.length_m
    out: dict[str, Any] = {
        "country": _country(size),
        "length_m": round(length, 3),
        "axle_count": len(axles),
        "axles": axles,
        "wheel_m": WHEEL_DIAMETER_M.get(size, 1.0),
        "cab": {
            "kind": cab.kind,
            "length_m": cab.length_m,
            "height_m": cab.height_m,
        },
        "deck": {
            "front_x_m": round(deck_front, 3),
            "length_m": spec.length_m,
            "width_m": spec.width_m,
            "floor_m": spec.floor_height_m,
            "wall_m": spec.wall_height_m,
            "headboard_m": spec.headboard_m or FLATBED_HEADBOARD_M,
        },
        "upper_deck": (
            {"front_x_m": round(trailer_front, 3), **upper} if upper is not None else None
        ),
        "coupling": coupling,
        "slider": size in SLIDER,
        "payload_kg": spec.payload_kg,
        "gvw_kg": round(gross_kg),
        "gvw_lb": round(gross_kg / LB_KG / 100) * 100 if size in US_SIZES else None,
        "catalog_length_m": EU_OVERALL_LENGTH_M.get(size),
    }
    return out


def catalog() -> dict[str, Any]:
    return {size.value: entry(size, spec) for size, spec in TRUCKS.items()}


def render() -> str:
    return json.dumps(catalog(), indent=2) + "\n"


def main() -> None:
    OUT.write_text(render())
    print(f"wrote {OUT.relative_to(ROOT)} ({len(TRUCKS)} trucks)")


if __name__ == "__main__":
    main()
