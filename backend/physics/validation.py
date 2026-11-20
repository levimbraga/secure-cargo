"""Validation of the simulation against the closed-form calculations of EN 12195-1:2010.

The cases here are used twice: the test-suite asserts them, and ``python -m physics.validation``
prints the tables of ``docs/validation.md``.

Method. One box stands on the bed under ``n`` top-over lashings and the bed brakes with a
constant deceleration (a 0.2 s ramp, then a 2 s hold). The formula of the standard without its
safety factor is the exact force balance, so it predicts where the simulated box must start
to slide. The standard's own answer, with the safety factor, is shown next to it.
"""

import math
from dataclasses import dataclass

from app.scenario import (
    CargoMaterial,
    CargoUnit,
    FloorMaterial,
    Headboard,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    TruckBed,
)
from app.scenario.presets import side_anchor_points, top_over_lashings
from physics.analytical import (
    strap_angle_rad,
    tipping_acceleration,
    top_over_critical_acceleration,
    top_over_lashings_required,
)
from physics.constants import EN_CX_FORWARD, EN_FS_FORWARD, STANDARD_GRAVITY_MPS2
from physics.profile import constant_pulse
from physics.results import SimulationResult
from physics.simulate import simulate
from physics.verdict import SLIDE_WARNING_M

G = STANDARD_GRAVITY_MPS2
BED_LENGTH_M = 8.0
BED_WIDTH_M = 2.4
HOLD_S = 2.0


@dataclass(frozen=True)
class Case:
    name: str
    mass_kg: float
    friction: float
    tension_n: float
    size_m: tuple[float, float, float]

    @property
    def angle_rad(self) -> float:
        return strap_angle_rad(self.size_m[1], self.size_m[2], BED_WIDTH_M)

    def required(self, safety_factor: float = 1.0) -> float:
        return top_over_lashings_required(
            mass_kg=self.mass_kg,
            friction=self.friction,
            acceleration_coefficient=EN_CX_FORWARD,
            tension_n=self.tension_n,
            angle_rad=self.angle_rad,
            safety_factor=safety_factor,
        )

    def critical_acceleration(self, lashings: int) -> float:
        return top_over_critical_acceleration(
            mass_kg=self.mass_kg,
            friction=self.friction,
            lashings=lashings,
            tension_n=self.tension_n,
            angle_rad=self.angle_rad,
        )


# Friction factors are EN 12195-1 Annex B values; tensions are standard tension forces (S_TF)
# of common ratchet straps (300 to 500 daN).
CASES = (
    Case("Pallet, sawn wood on plywood", 1000, 0.45, 4000, (1.2, 1.0, 1.0)),
    Case("Crate, plane wood on plywood", 2000, 0.30, 5000, (2.4, 1.2, 1.2)),
    Case("Full-width machine on sawn wood", 4500, 0.45, 4000, (2.4, 2.4, 1.5)),
    Case("Plastic pallet on plywood", 800, 0.20, 3500, (1.2, 0.8, 1.0)),
    Case("Coil cradle on rubber mat", 10000, 0.60, 5000, (4.0, 2.2, 1.5)),
)


def box_scenario(case: Case, lashings: int, *, friction: float | None = None) -> Scenario:
    """One box in the middle of a flatbed, under ``lashings`` evenly spaced top-over straps."""
    anchors = side_anchor_points(length_m=BED_LENGTH_M, width_m=BED_WIDTH_M, spacing_m=0.2)
    unit = CargoUnit(
        id="box",
        size_m=case.size_m,
        mass_kg=case.mass_kg,
        position_m=(0.0, 0.0, 0.0),
        material=CargoMaterial.SAWN_WOOD,
        friction_coefficient=case.friction if friction is None else friction,
    )
    return Scenario(
        id="validation",
        bed=TruckBed(
            length_m=BED_LENGTH_M,
            width_m=BED_WIDTH_M,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            anchor_points=anchors,
        ),
        units=[unit],
        lashings=top_over_lashings(
            unit,
            anchors,
            count=lashings,
            pretension_n=case.tension_n,
            lashing_capacity_n=25_000,
        ),
    )


def brake(
    scenario: Scenario, deceleration_mps2: float, *, hold_s: float = HOLD_S
) -> SimulationResult:
    """Run a scenario through a constant braking pulse."""
    return simulate(
        scenario, constant_pulse(acceleration_mps2=(-deceleration_mps2, 0.0, 0.0), hold_s=hold_s)
    )


def push_sideways(scenario: Scenario, acceleration_mps2: float) -> SimulationResult:
    return simulate(
        scenario, constant_pulse(acceleration_mps2=(0.0, acceleration_mps2, 0.0), hold_s=HOLD_S)
    )


def simulated_critical_acceleration(case: Case, lashings: int, *, sideways: bool = False) -> float:
    """Smallest bed acceleration [m/s^2] at which the simulated box slides, by bisection."""
    scenario = box_scenario(case, lashings)
    predicted = case.critical_acceleration(lashings)
    low, high = 0.7 * predicted, 1.3 * predicted
    for _ in range(9):  # resolves the threshold to about 0.1 % of the prediction
        middle = (low + high) / 2
        run = push_sideways(scenario, middle) if sideways else brake(scenario, middle)
        if run.units[0].max_slide_m > SLIDE_WARNING_M:
            high = middle
        else:
            low = middle
    return (low + high) / 2


def simulated_tipping_acceleration(base_length_m: float, height_m: float) -> float:
    """Smallest braking [m/s^2] at which an unsecured box with high friction tips, by bisection."""
    case = Case("tall box", 500, 1.2, 0.0, (base_length_m, 1.0, height_m))
    scenario = box_scenario(case, 0)
    predicted = tipping_acceleration(base_length_m=base_length_m, height_m=height_m)
    low, high = 0.7 * predicted, 1.3 * predicted
    for _ in range(9):
        middle = (low + high) / 2
        if brake(scenario, middle).units[0].max_tilt_deg > 2.0:
            high = middle
        else:
            low = middle
    return (low + high) / 2


@dataclass(frozen=True)
class DirectLashingCheck:
    predicted_tension_n: float
    simulated_tension_n: float


def direct_lashing_tension(
    *, mass_kg: float = 3000.0, friction: float = 0.3, deceleration_mps2: float = 0.8 * G
) -> DirectLashingCheck:
    """Tension in a pair of rearward direct lashings holding a box that brakes.

    Force balance along the bed, with the lashings at a vertical angle ``alpha`` and a
    horizontal angle ``beta``: ``2 T (cos(alpha) cos(beta) + mu sin(alpha)) = m (a - mu g)``.
    This is the balance behind the direct-lashing equations of EN 12195-1, without the
    standard's ``f_mu`` conversion factor.
    """
    size = (2.0, 1.6, 1.0)
    anchors = side_anchor_points(length_m=BED_LENGTH_M, width_m=BED_WIDTH_M, spacing_m=0.2)
    unit = CargoUnit(
        id="box",
        size_m=size,
        mass_kg=mass_kg,
        position_m=(0.0, 0.0, 0.0),
        material=CargoMaterial.SAWN_WOOD,
        friction_coefficient=friction,
    )
    # Lashing points on the top rear corners, anchors on the bed edge 1.4 m further back.
    attachment_x, anchor_x = -size[0] / 2, -size[0] / 2 - 1.4
    lashings = []
    for side, prefix in ((1, "L"), (-1, "R")):
        anchor = min(
            (a for a in anchors if a.id.startswith(prefix)),
            key=lambda a: abs(a.position_m[0] - anchor_x),
        )
        lashings.append(
            Lashing(
                id=f"direct-{prefix}",
                kind=LashingKind.CHAIN,
                routing=LashingRouting.DIRECT,
                unit_id="box",
                anchor_ids=[anchor.id],
                attachment_point_m=(attachment_x, side * size[1] / 2, size[2]),
                pretension_n=500.0,
                lashing_capacity_n=40_000,
            )
        )
        dx = attachment_x - anchor.position_m[0]
        dy = side * size[1] / 2 - anchor.position_m[1]
        dz = size[2]
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    along, up = dx / length, dz / length  # cos(alpha) cos(beta) and sin(alpha)
    predicted = mass_kg * (deceleration_mps2 - friction * G) / (2 * (along + friction * up))
    scenario = Scenario(
        id="validation-direct",
        bed=TruckBed(
            length_m=BED_LENGTH_M,
            width_m=BED_WIDTH_M,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            anchor_points=anchors,
        ),
        units=[unit],
        lashings=lashings,
    )
    # A slow ramp, so the lashings load up without dynamic overshoot.
    run = simulate(
        scenario,
        constant_pulse(acceleration_mps2=(-deceleration_mps2, 0.0, 0.0), rise_s=1.0, hold_s=1.5),
    )
    simulated = sum(lashing.final_tension_n for lashing in run.lashings) / len(run.lashings)
    return DirectLashingCheck(predicted_tension_n=predicted, simulated_tension_n=simulated)


def headboard_force(
    *, mass_kg: float = 2000.0, friction: float = 0.3, deceleration_mps2: float = 0.8 * G
) -> tuple[float, float]:
    """Predicted and simulated force on the headboard from a box loaded against it [N].

    Blocking takes what friction cannot: ``F = m (a - mu g)``.
    """
    size = (1.2, 1.0, 1.0)
    anchors = side_anchor_points(length_m=BED_LENGTH_M, width_m=BED_WIDTH_M, spacing_m=0.2)
    unit = CargoUnit(
        id="box",
        size_m=size,
        mass_kg=mass_kg,
        position_m=(BED_LENGTH_M / 2 - size[0] / 2, 0.0, 0.0),
        material=CargoMaterial.SAWN_WOOD,
        friction_coefficient=friction,
    )
    scenario = Scenario(
        id="validation-blocked",
        bed=TruckBed(
            length_m=BED_LENGTH_M,
            width_m=BED_WIDTH_M,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            headboard=Headboard(height_m=1.5),
            anchor_points=anchors,
        ),
        units=[unit],
    )
    run = simulate(
        scenario,
        constant_pulse(acceleration_mps2=(-deceleration_mps2, 0.0, 0.0), rise_s=1.0, hold_s=1.0),
    )
    predicted = mass_kg * (deceleration_mps2 - friction * G)
    return predicted, run.units[0].peak_headboard_force_n


def report() -> str:
    """The tables of ``docs/validation.md`` as Markdown."""
    deceleration = EN_CX_FORWARD * G
    lines = [
        "### Table 1. Number of lashings: formula vs. simulation (braking at 0.8 g)",
        "",
        "| Case | Mass | Friction | Strap angle | Tension per strap | Formula, no safety factor "
        "| EN 12195-1 (f_s = 1.25) | Simulated with one strap fewer | Simulated with the "
        "formula's number |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for case in CASES:
        real = case.required()
        needed = math.ceil(real)
        design = math.ceil(case.required(EN_FS_FORWARD))
        fewer = brake(box_scenario(case, needed - 1), deceleration)
        enough = brake(box_scenario(case, needed), deceleration)
        lines.append(
            f"| {case.name} | {case.mass_kg:.0f} kg | {case.friction:.2f} "
            f"| {math.degrees(case.angle_rad):.0f}° | {case.tension_n / 10:.0f} daN "
            f"| {real:.2f} → **{needed}** | {design} "
            f"| {needed - 1}: slid {fewer.units[0].max_slide_m * 100:.0f} cm, "
            f"**{fewer.verdict.status}** "
            f"| {needed}: slid {enough.units[0].max_slide_m * 1000:.1f} mm, "
            f"**{enough.verdict.status}** |"
        )
    lines += [
        "",
        "### Table 2. Deceleration at which the load starts to slide",
        "",
        "| Case | Lashings | Formula | Simulation | Difference |",
        "|---|---|---|---|---|",
    ]
    for case in CASES:
        needed = math.ceil(case.required())
        predicted = case.critical_acceleration(needed)
        simulated = simulated_critical_acceleration(case, needed)
        lines.append(
            f"| {case.name} | {needed} | {predicted / G:.3f} g | {simulated / G:.3f} g "
            f"| {(simulated / predicted - 1) * 100:+.1f} % |"
        )
    unsecured = Case("Unsecured box, no lashing", 1000, 0.45, 0.0, (1.2, 1.0, 1.0))
    simulated = simulated_critical_acceleration(unsecured, 0)
    lines.append(
        f"| {unsecured.name} | 0 | {unsecured.friction:.3f} g | {simulated / G:.3f} g "
        f"| {(simulated / (unsecured.friction * G) - 1) * 100:+.1f} % |"
    )
    lines += [
        "",
        "### Table 3. Other closed-form checks",
        "",
        "| Check | Formula | Simulation | Difference |",
        "|---|---|---|---|",
    ]
    for base, height in ((0.8, 2.0), (1.2, 2.4)):
        predicted = tipping_acceleration(base_length_m=base, height_m=height)
        simulated = simulated_tipping_acceleration(base, height)
        lines.append(
            f"| Braking at which an unsecured {base} m x {height} m box tips | "
            f"{predicted / G:.3f} g | {simulated / G:.3f} g "
            f"| {(simulated / predicted - 1) * 100:+.1f} % |"
        )
    case = CASES[2]
    needed = math.ceil(case.required())
    predicted = case.critical_acceleration(needed)
    simulated = simulated_critical_acceleration(case, needed, sideways=True)
    lines.append(
        f"| Sideways acceleration at which the full-width machine slides ({needed} lashings) | "
        f"{predicted / G:.3f} g | {simulated / G:.3f} g "
        f"| {(simulated / predicted - 1) * 100:+.1f} % |"
    )
    direct = direct_lashing_tension()
    lines.append(
        "| Tension in each of two direct lashings, 3 t box braking at 0.8 g | "
        f"{direct.predicted_tension_n / 10:.0f} daN | {direct.simulated_tension_n / 10:.0f} daN "
        f"| {(direct.simulated_tension_n / direct.predicted_tension_n - 1) * 100:+.1f} % |"
    )
    predicted, simulated = headboard_force()
    lines.append(
        "| Force on the headboard, 2 t box loaded against it, braking at 0.8 g | "
        f"{predicted / 10:.0f} daN | {simulated / 10:.0f} daN "
        f"| {(simulated / predicted - 1) * 100:+.1f} % |"
    )
    return "\n".join(lines)


if __name__ == "__main__":
    print(report())
