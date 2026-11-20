"""The EN 12195-1 formulas reproduce the worked examples published in official guides.

Sources: European Commission, "Cargo securing for road transport: 2014 European best
practices guidelines" (sections 6.1.2, 6.1.3, 6.2.2, 6.2.3), and IRU, "International
Guidelines on Safe Load Securing for Road Transport" (section 5.1.1). The guides print the
secured mass in tonnes with one decimal.
"""

import math

import pytest

from physics.analytical import (
    spring_lashing_mass_secured,
    tipping_acceleration,
    top_over_critical_acceleration,
    top_over_lashings_required,
    top_over_mass_secured,
)
from physics.constants import (
    EN_CX_FORWARD,
    EN_CY_SLIDING,
    EN_FS_FORWARD,
    EN_FS_OTHER,
    STANDARD_GRAVITY_MPS2,
)


@pytest.mark.parametrize(
    ("angle_deg", "tension_n", "coefficient", "safety_factor", "published_t"),
    [
        (55, 5000, EN_CY_SLIDING, EN_FS_OTHER, 13.7),  # EC guidelines 6.1.2, sideways
        (55, 5000, EN_CX_FORWARD, EN_FS_FORWARD, 1.7),  # EC guidelines 6.1.2, forward
        (74, 5000, EN_CY_SLIDING, EN_FS_OTHER, 16.0),  # EC guidelines 6.2.2, sideways
        (74, 5000, EN_CX_FORWARD, EN_FS_FORWARD, 2.0),  # EC guidelines 6.2.2, forward
        (55, 4000, EN_CY_SLIDING, EN_FS_OTHER, 10.9),  # IRU guidelines 5.1.1.2, sideways
        (55, 4000, EN_CX_FORWARD, EN_FS_FORWARD, 1.4),  # IRU guidelines 5.1.1.2, forward
    ],
)
def test_top_over_lashing_matches_published_examples(
    angle_deg: float, tension_n: float, coefficient: float, safety_factor: float, published_t: float
) -> None:
    mass = top_over_mass_secured(
        lashings=2,
        friction=0.45,
        acceleration_coefficient=coefficient,
        tension_n=tension_n,
        angle_rad=math.radians(angle_deg),
        safety_factor=safety_factor,
    )
    assert mass / 1000 == pytest.approx(published_t, abs=0.05)


@pytest.mark.parametrize(
    ("capacity_n", "alpha_deg", "beta_deg", "published_t"),
    [
        (20000, 39, 35, 7.5),  # EC guidelines 6.1.3
        (20000, 43, 16, 8.2),  # EC guidelines 6.2.3
        (16000, 25, 19, 7.1),  # IRU guidelines 5.1.1.3
    ],
)
def test_spring_lashing_matches_published_examples(
    capacity_n: float, alpha_deg: float, beta_deg: float, published_t: float
) -> None:
    mass = spring_lashing_mass_secured(
        lashings=1,
        friction=0.45,
        acceleration_coefficient=EN_CX_FORWARD,
        lashing_capacity_n=capacity_n,
        vertical_angle_rad=math.radians(alpha_deg),
        horizontal_angle_rad=math.radians(beta_deg),
    )
    assert mass / 1000 == pytest.approx(published_t, abs=0.06)


def test_required_lashings_and_secured_mass_are_the_same_equation() -> None:
    common = {"friction": 0.3, "tension_n": 4000.0, "angle_rad": math.radians(60)}
    mass = top_over_mass_secured(
        lashings=3, acceleration_coefficient=0.8, safety_factor=1.25, **common
    )
    required = top_over_lashings_required(
        mass_kg=mass, acceleration_coefficient=0.8, safety_factor=1.25, **common
    )
    assert required == pytest.approx(3.0)


def test_no_lashing_is_needed_when_friction_alone_holds_the_load() -> None:
    assert (
        top_over_lashings_required(
            mass_kg=1000,
            friction=0.6,
            acceleration_coefficient=0.5,
            tension_n=4000,
            angle_rad=math.radians(60),
        )
        == 0.0
    )


def test_critical_acceleration_without_lashings_is_friction_times_gravity() -> None:
    acceleration = top_over_critical_acceleration(
        mass_kg=1000, friction=0.45, lashings=0, tension_n=0, angle_rad=math.radians(60)
    )
    assert acceleration == pytest.approx(0.45 * STANDARD_GRAVITY_MPS2)


def test_a_box_twice_as_tall_as_its_base_tips_at_half_a_g() -> None:
    assert tipping_acceleration(base_length_m=1.0, height_m=2.0) == pytest.approx(
        0.5 * STANDARD_GRAVITY_MPS2
    )


def test_the_forward_safety_factor_is_1_25_not_1_1() -> None:
    """The published forward example (1.7 t) is only reproduced with f_s = 1.25.

    EN 12195-1:2010 has two safety factors for frictional lashing, 1.1 and 1.25 (foreword item
    d; definition 3.2.19). The guidelines assign them: 1.25 forward, 1.1 sideways and
    backward (EC guidelines 6.1.2, p. 44).
    """

    def secured_t(safety_factor: float) -> float:
        mass = top_over_mass_secured(
            lashings=2,
            friction=0.45,
            acceleration_coefficient=EN_CX_FORWARD,
            tension_n=5000.0,
            angle_rad=math.radians(55),
            safety_factor=safety_factor,
        )
        return mass / 1000

    assert EN_FS_FORWARD == 1.25 and EN_FS_OTHER == 1.1
    assert secured_t(1.25) == pytest.approx(1.7, abs=0.05)
    assert secured_t(1.1) == pytest.approx(1.95, abs=0.01)
