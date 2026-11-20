"""Road surface and weather conditions.

A surface changes two things: how hard the truck itself can brake or corner (tyre-road
friction), and, when the road is dirty, how much friction the cargo can count on. Sources and
their confidence are listed in ``docs/physics-model.md``.
"""

from dataclasses import dataclass

from app.scenario import RoadSurface


@dataclass(frozen=True)
class SurfaceCondition:
    # Peak tyre-road friction of truck tyres: the truck cannot brake or corner harder.
    tyre_friction: float
    # Upper limit on cargo-floor friction because the deck is not clean; None = no limit.
    cargo_friction_cap: float | None
    # RMS vertical vibration of the bed caused by the road itself [g].
    roughness_grms: float


SURFACES: dict[RoadSurface, SurfaceCondition] = {
    # Truck tyres on dry concrete at 64 km/h: average peak 0.756 (UMTRI data in Wong, "Theory
    # of Ground Vehicles", ch. 1).
    RoadSurface.DRY: SurfaceCondition(0.756, None, 0.0),
    # Truck tyres on wet concrete: average peak 0.641 (same table). EN 12195-1 friction
    # factors hold for "dry or wet" cargo surfaces, so rain does not lower cargo friction.
    RoadSurface.WET: SurfaceCondition(0.641, None, 0.0),
    # ASSUMPTION: no value was found for standing water. The sliding (locked-wheel) value of
    # truck tyres on wet concrete, 0.467, is used as the limit.
    RoadSurface.HEAVY_RAIN: SurfaceCondition(0.467, None, 0.0),
    # Wet earth road: peak 0.55 (Wong, general table). ASSUMPTION: on a muddy road the deck
    # is not clean, so cargo friction is capped at 0.2 (EN 12195-1 Annex B, footnote).
    RoadSurface.MUD: SurfaceCondition(0.55, 0.2, 0.37),
    # Gravel: peak 0.6 (Wong, general table). ASSUMPTION: a dusty deck that was not swept
    # clean is capped at 0.3 (CTU Code, Annex 7, Appendix 2). Roughness: the lowest truck
    # level of ASTM D4169 (0.37 Grms).
    RoadSurface.GRAVEL: SurfaceCondition(0.60, 0.3, 0.37),
}
