"""The simulation agrees with the closed-form calculations of EN 12195-1.

These are the numbers of ``docs/validation.md``. One box, frictional (top-over) lashing,
braking at the standard's 0.8 g: the number of lashings the formula asks for is where the
simulation flips from fail to pass.
"""

import math

import pytest

from physics.analytical import tipping_acceleration
from physics.constants import EN_CX_FORWARD, STANDARD_GRAVITY_MPS2
from physics.validation import (
    CASES,
    Case,
    box_scenario,
    brake,
    direct_lashing_tension,
    headboard_force,
    simulated_critical_acceleration,
    simulated_tipping_acceleration,
)

G = STANDARD_GRAVITY_MPS2
CASE_IDS = [case.name for case in CASES]


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_the_formulas_number_of_lashings_is_where_the_simulation_flips(case: Case) -> None:
    needed = math.ceil(case.required())

    one_fewer = brake(box_scenario(case, needed - 1), EN_CX_FORWARD * G)
    enough = brake(box_scenario(case, needed), EN_CX_FORWARD * G)

    assert one_fewer.verdict.status == "fail"
    assert one_fewer.units[0].max_slide_m > 0.10
    assert enough.verdict.status == "pass"
    assert enough.units[0].max_slide_m < 0.001


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
def test_sliding_starts_at_the_deceleration_the_formula_predicts(case: Case) -> None:
    lashings = math.ceil(case.required())

    simulated = simulated_critical_acceleration(case, lashings)

    assert simulated == pytest.approx(case.critical_acceleration(lashings), rel=0.01)


def test_an_unsecured_box_slides_at_friction_times_gravity() -> None:
    case = Case("unsecured", 1000, 0.45, 0.0, (1.2, 1.0, 1.0))

    assert simulated_critical_acceleration(case, 0) == pytest.approx(0.45 * G, rel=0.01)


def test_sideways_sliding_starts_where_the_formula_predicts() -> None:
    case = CASES[2]  # as wide as the bed, so the straps are vertical
    lashings = math.ceil(case.required())

    simulated = simulated_critical_acceleration(case, lashings, sideways=True)

    assert simulated == pytest.approx(case.critical_acceleration(lashings), rel=0.02)


@pytest.mark.parametrize(("base_m", "height_m"), [(0.8, 2.0), (1.2, 2.4)])
def test_an_unsecured_box_tips_at_the_stability_limit(base_m: float, height_m: float) -> None:
    predicted = tipping_acceleration(base_length_m=base_m, height_m=height_m)

    assert simulated_tipping_acceleration(base_m, height_m) == pytest.approx(predicted, rel=0.02)


def test_direct_lashings_carry_the_tension_of_the_force_balance() -> None:
    check = direct_lashing_tension()

    assert check.simulated_tension_n == pytest.approx(check.predicted_tension_n, rel=0.05)


def test_a_blocked_load_presses_on_the_headboard_with_what_friction_cannot_hold() -> None:
    predicted, simulated = headboard_force()

    assert simulated == pytest.approx(predicted, rel=0.05)
