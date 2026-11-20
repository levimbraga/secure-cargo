"""Friction factors between a cargo unit and what it stands on.

Values are those of EN 12195-1:2010 Annex B (Table B.1), as reproduced in the European
Commission's "Cargo securing for road transport: 2014 European best practices guidelines",
Appendix 3. The table applies to surfaces that are "dry or wet but clean", so rain alone
does not change the factor; a dirty surface caps it (see ``DIRTY_SURFACE_CAP``).
"""

from dataclasses import dataclass
from typing import Literal

from app.scenario import CargoMaterial, FloorMaterial

FrictionSource = Literal["unit_override", "en_12195_1_annex_b", "fallback_pair_not_listed"]

_C = CargoMaterial
_F = FloorMaterial

# (unit base material, platform material) -> friction factor.
EN_12195_1_ANNEX_B: dict[tuple[CargoMaterial, FloorMaterial], float] = {
    (_C.SAWN_WOOD, _F.PLYWOOD_LAMINATE): 0.45,
    (_C.SAWN_WOOD, _F.GROOVED_ALUMINIUM): 0.40,
    (_C.SAWN_WOOD, _F.STAINLESS_STEEL): 0.30,
    (_C.PLANE_WOOD, _F.PLYWOOD_LAMINATE): 0.30,
    (_C.PLANE_WOOD, _F.GROOVED_ALUMINIUM): 0.25,
    (_C.PLANE_WOOD, _F.STAINLESS_STEEL): 0.20,
    (_C.PLASTIC_PALLET, _F.PLYWOOD_LAMINATE): 0.20,
    (_C.PLASTIC_PALLET, _F.GROOVED_ALUMINIUM): 0.15,
    (_C.PLASTIC_PALLET, _F.STAINLESS_STEEL): 0.15,
    (_C.STEEL_CRATE, _F.PLYWOOD_LAMINATE): 0.45,
    (_C.STEEL_CRATE, _F.GROOVED_ALUMINIUM): 0.30,
    (_C.STEEL_CRATE, _F.STAINLESS_STEEL): 0.20,
    # Annex B lists concrete only against sawn wood battens.
    (_C.CONCRETE_ROUGH, _F.SAWN_WOOD): 0.70,
    (_C.CONCRETE_SMOOTH, _F.SAWN_WOOD): 0.55,
}

# Annex B: a rubber anti-slip mat, against any surface.
RUBBER_MAT_FRICTION = 0.60

# IMO/ILO/UNECE CTU Code, Annex 7, Appendix 2: a material pair that is not in the table may
# be credited with at most 0.3.
UNLISTED_PAIR_FRICTION = 0.30

# EN 12195-1:2010 Annex B, footnote: if the surfaces are not clean (or carry frost, ice or
# snow) the friction factor must not exceed 0.2.
DIRTY_SURFACE_CAP = 0.20


@dataclass(frozen=True)
class Friction:
    coefficient: float
    source: FrictionSource
    capped_by_dirty_surface: bool = False


def resolve_friction(
    material: CargoMaterial,
    support: FloorMaterial | None,
    *,
    override: float | None = None,
    surface_cap: float | None = None,
) -> Friction:
    """Friction factor of a unit standing on the bed floor, or on another unit.

    ``support`` is the floor material, or ``None`` when the unit rests on another unit (no
    table covers cargo on cargo). ``surface_cap`` is the limit imposed by the trip conditions.
    """
    source: FrictionSource
    if override is not None:
        coefficient, source = override, "unit_override"
    elif material is CargoMaterial.RUBBER_MAT:
        coefficient, source = RUBBER_MAT_FRICTION, "en_12195_1_annex_b"
    elif support is not None and (material, support) in EN_12195_1_ANNEX_B:
        coefficient, source = EN_12195_1_ANNEX_B[(material, support)], "en_12195_1_annex_b"
    else:
        coefficient, source = UNLISTED_PAIR_FRICTION, "fallback_pair_not_listed"

    if surface_cap is not None and coefficient > surface_cap:
        return Friction(surface_cap, source, capped_by_dirty_surface=True)
    return Friction(coefficient, source)
