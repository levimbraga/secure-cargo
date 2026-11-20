"""Closed-form securing calculations of EN 12195-1:2010.

These are the formulas the simulation is validated against (``docs/validation.md``). The
equations are quoted from the European Commission's "Cargo securing for road transport: 2014
European best practices guidelines" (sections 6.1.2 and 6.1.3), which reproduce the standard.
"""

import math

from physics.constants import EN_CZ, EN_F_MU, STANDARD_GRAVITY_MPS2


def strap_angle_rad(unit_width_m: float, unit_height_m: float, anchor_span_m: float) -> float:
    """Angle between a top-over strap and the bed floor, for a unit centred between anchors."""
    overhang = (anchor_span_m - unit_width_m) / 2
    return math.atan2(unit_height_m, overhang)


def top_over_lashings_required(
    *,
    mass_kg: float,
    friction: float,
    acceleration_coefficient: float,
    tension_n: float,
    angle_rad: float,
    safety_factor: float = 1.0,
    cz: float = EN_CZ,
) -> float:
    """Number of top-over (frictional) lashings needed to prevent sliding, EN 12195-1 eq. 10.

    ``n >= (c - mu * cz) * m * g / (2 * mu * sin(alpha) * F_T) * f_s``

    Returns the real-valued requirement; round up for the number of lashings. With
    ``safety_factor = 1`` this is the plain force balance, which is what a physics simulation
    reproduces. The standard then multiplies by ``f_s`` (1.25 forward, 1.1 otherwise).
    """
    deficit = acceleration_coefficient - friction * cz
    if deficit <= 0:
        return 0.0
    return (
        deficit
        * mass_kg
        * STANDARD_GRAVITY_MPS2
        / (2 * friction * math.sin(angle_rad) * tension_n)
        * safety_factor
    )


def top_over_critical_acceleration(
    *, mass_kg: float, friction: float, lashings: int, tension_n: float, angle_rad: float
) -> float:
    """Bed acceleration [m/s^2] at which a unit under top-over lashings starts to slide.

    The same force balance as equation 10, solved for the acceleration:
    ``a = mu * (g + 2 * n * F_T * sin(alpha) / m)``.
    """
    clamping = 2 * lashings * tension_n * math.sin(angle_rad)
    return friction * (STANDARD_GRAVITY_MPS2 + clamping / mass_kg)


def top_over_mass_secured(
    *,
    lashings: int,
    friction: float,
    acceleration_coefficient: float,
    tension_n: float,
    angle_rad: float,
    safety_factor: float,
    cz: float = EN_CZ,
) -> float:
    """Mass [kg] that ``lashings`` top-over lashings keep from sliding (guidelines 6.1.2)."""
    deficit = acceleration_coefficient - friction * cz
    if deficit <= 0:
        return math.inf
    return (
        lashings
        * 2
        * friction
        * math.sin(angle_rad)
        * tension_n
        / (STANDARD_GRAVITY_MPS2 * deficit * safety_factor)
    )


def spring_lashing_mass_secured(
    *,
    lashings: int,
    friction: float,
    acceleration_coefficient: float,
    lashing_capacity_n: float,
    vertical_angle_rad: float,
    horizontal_angle_rad: float,
    cz: float = EN_CZ,
    f_mu: float = EN_F_MU,
) -> float:
    """Mass [kg] kept from sliding by spring lashings, EN 12195-1 eq. 35 (guidelines 6.1.3).

    ``m = 2 n LC (mu f_mu sin(alpha) + cos(alpha) cos(beta)) / (g (c - mu f_mu cz))``
    """
    effective = friction * f_mu
    deficit = acceleration_coefficient - effective * cz
    if deficit <= 0:
        return math.inf
    restraint = effective * math.sin(vertical_angle_rad) + math.cos(vertical_angle_rad) * math.cos(
        horizontal_angle_rad
    )
    return 2 * lashings * lashing_capacity_n * restraint / (STANDARD_GRAVITY_MPS2 * deficit)


def tipping_acceleration(*, base_length_m: float, height_m: float) -> float:
    """Bed acceleration [m/s^2] at which an unsecured, uniform box starts to tip.

    Stability condition of EN 12195-1 (eq. 3): ``b > (c / cz) * d`` with ``b`` half the base
    length and ``d`` the height of the centre of gravity.
    """
    return STANDARD_GRAVITY_MPS2 * (base_length_m / 2) / (height_m / 2)


def rolling_acceleration(
    *, bed_acceleration_mps2: float, diameter_m: float, inner_diameter_m: float = 0.0
) -> float:
    """Acceleration of a free cylinder relative to the bed when it rolls without slipping.

    The bed accelerates by ``a``; the cylinder's inertia pushes it the other way, and part of
    that push goes into spinning it: ``a_rel = a / (1 + I / (m R^2))`` with
    ``I = m (R^2 + r^2) / 2`` for a tube of outer radius ``R`` and inner radius ``r``. A solid
    cylinder rolls at two thirds of the bed's acceleration.
    """
    radius, inner = diameter_m / 2, inner_diameter_m / 2
    ratio = (radius**2 + inner**2) / (2 * radius**2)
    return bed_acceleration_mps2 / (1 + ratio)


def roll_over_chock_acceleration(*, diameter_m: float, chock_height_m: float) -> float:
    """Bed acceleration [m/s^2] at which a cylinder starts to roll over a chock.

    The cylinder pivots on the chock's edge at height ``h``: inertia ``m a`` acts at the
    centre, ``R - h`` above the edge, and the weight ``m g`` at ``sqrt(2 R h - h^2)`` behind it.
    It climbs when ``a / g > sqrt(2 R h - h^2) / (R - h)``.
    """
    radius = diameter_m / 2
    if not 0 < chock_height_m < radius:
        raise ValueError("the chock must be lower than the cylinder's centre")
    lever = math.sqrt(2 * radius * chock_height_m - chock_height_m**2)
    return STANDARD_GRAVITY_MPS2 * lever / (radius - chock_height_m)
