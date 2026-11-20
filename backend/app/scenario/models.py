"""Scenario schema, version 1.

Conventions
-----------
* SI units everywhere: metres, kilograms, seconds, newtons. Every field carries its unit as a
  suffix (``_m``, ``_kg``, ``_n``). The two exceptions follow how drivers speak: ``speed_kmh``
  and ``curve_radius_m``/``grade_percent`` on the trip event. Lashing labels are printed in
  daN; 1 daN = 10 N, so a strap labelled "LC 2500 daN" has ``lashing_capacity_n = 25000``.
* Bed frame: right-handed, **X to the front of the truck, Y to its left, Z up**, origin at the
  centre of the bed floor surface. The headboard is at ``x = +length_m / 2``.
* Cargo units are axis-aligned boxes. ``position_m`` is the centre of the unit's bottom face,
  so a unit standing on the floor has ``z = 0``.
"""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION: Literal[1] = 1

Vec3 = tuple[float, float, float]
Identifier = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]

# Tolerance used when checking that units touch but do not overlap [m].
_CONTACT_TOLERANCE_M = 0.005


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FloorMaterial(StrEnum):
    """Loading platform materials of EN 12195-1:2010 Annex B, plus a plank floor."""

    PLYWOOD_LAMINATE = "plywood_laminate"  # "fabric base laminate / plywood"
    GROOVED_ALUMINIUM = "grooved_aluminium"
    STAINLESS_STEEL = "stainless_steel"
    SAWN_WOOD = "sawn_wood"  # plank floor; only the concrete rows of Annex B cover it


class CargoMaterial(StrEnum):
    """Material of the surface a unit stands on (its base), per EN 12195-1:2010 Annex B."""

    SAWN_WOOD = "sawn_wood"  # e.g. a wooden pallet
    PLANE_WOOD = "plane_wood"
    PLASTIC_PALLET = "plastic_pallet"
    STEEL_CRATE = "steel_crate"
    CONCRETE_ROUGH = "concrete_rough"
    CONCRETE_SMOOTH = "concrete_smooth"
    RUBBER_MAT = "rubber_mat"  # the unit stands on a rubber anti-slip mat


class LashingKind(StrEnum):
    STRAP = "strap"  # polyester web lashing with a ratchet
    CHAIN = "chain"
    ROPE = "rope"  # fibre rope; not a rated lashing device


class LashingRouting(StrEnum):
    TOP_OVER = "top_over"  # frictional lashing: over the unit, anchored on both sides
    DIRECT = "direct"  # from one anchor point straight to a point on the unit


class EventKind(StrEnum):
    EMERGENCY_BRAKING = "emergency_braking"
    LANE_CHANGE = "lane_change"
    SHARP_CURVE = "sharp_curve"
    POTHOLE = "pothole"
    SPEED_BUMP = "speed_bump"
    MOUNTAIN_DESCENT = "mountain_descent"
    LONG_VIBRATION = "long_vibration"


class RoadSurface(StrEnum):
    DRY = "dry"
    WET = "wet"
    HEAVY_RAIN = "heavy_rain"
    MUD = "mud"
    GRAVEL = "gravel"


class AxleGroupKind(StrEnum):
    """Axle groups with a legal load limit in CONTRAN Resolution 882/2021."""

    SINGLE_2_TYRES = "single_2_tyres"
    SINGLE_4_TYRES = "single_4_tyres"
    TANDEM_2_AXLES = "tandem_2_axles"
    TANDEM_3_AXLES = "tandem_3_axles"


class AnchorPoint(_Model):
    """A lashing point fixed to the truck body."""

    id: Identifier
    position_m: Vec3 = Field(description="Position in the bed frame [m].")
    rated_capacity_n: float | None = Field(
        default=None, gt=0, description="Rated strength of the lashing point [N], if known."
    )


class Headboard(_Model):
    """Front wall of the bed, at x = +length_m / 2."""

    height_m: float = Field(gt=0, le=4, description="Height above the bed floor [m].")
    rated_capacity_n: float | None = Field(
        default=None,
        gt=0,
        description="Blocking capacity of the headboard [N]; the run fails if it is exceeded.",
    )


class TruckBed(_Model):
    length_m: float = Field(gt=0.5, le=20, description="Inner length along X [m].")
    width_m: float = Field(gt=0.5, le=3.5, description="Inner width along Y [m].")
    floor_height_m: float = Field(
        default=1.2, gt=0, le=2, description="Height of the bed floor above the road [m]."
    )
    floor_material: FloorMaterial
    headboard: Headboard | None = None
    side_rail_height_m: float = Field(
        default=0.0, ge=0, le=3, description="Height of the side rails [m]; 0 means a flatbed."
    )
    anchor_points: list[AnchorPoint] = Field(max_length=200)

    @model_validator(mode="after")
    def _unique_anchor_ids(self) -> Self:
        _require_unique([anchor.id for anchor in self.anchor_points], "anchor point")
        return self


class AxleGroup(_Model):
    id: Identifier
    kind: AxleGroupKind
    position_x_m: float = Field(description="X of the centre of the group, in the bed frame [m].")
    tare_load_kg: float = Field(ge=0, description="Load on this group with the truck empty [kg].")


class Vehicle(_Model):
    """Axle data, only needed for the axle-load check. Exactly two groups (front, rear)."""

    axle_groups: tuple[AxleGroup, AxleGroup]

    @model_validator(mode="after")
    def _distinct_positions(self) -> Self:
        front, rear = self.axle_groups
        if abs(front.position_x_m - rear.position_x_m) < 0.5:
            raise ValueError("the two axle groups must be at least 0.5 m apart")
        _require_unique([front.id, rear.id], "axle group")
        return self


class CargoUnit(_Model):
    """One rigid, axis-aligned box of cargo."""

    id: Identifier
    label: str = Field(default="", max_length=80)
    size_m: Vec3 = Field(description="Length (X), width (Y) and height (Z) [m].")
    mass_kg: float = Field(gt=0, le=60_000, description="Mass [kg], centred in the box.")
    position_m: Vec3 = Field(description="Centre of the bottom face, in the bed frame [m].")
    material: CargoMaterial = Field(description="Material of the unit's base.")
    friction_coefficient: float | None = Field(
        default=None,
        gt=0,
        le=1.5,
        description=(
            "Friction factor between this unit and whatever it stands on. Overrides the "
            "material table; use it for a tested or certified value."
        ),
    )
    stackable: bool = Field(default=True, description="Whether other units may rest on it.")

    @model_validator(mode="after")
    def _positive_size(self) -> Self:
        if min(self.size_m) < 0.05 or max(self.size_m) > 20:
            raise ValueError("each side of size_m must be between 0.05 m and 20 m")
        if self.position_m[2] < 0:
            raise ValueError("position_m[2] (bottom of the unit) cannot be below the floor")
        return self


class Lashing(_Model):
    """One lashing device securing one unit."""

    id: Identifier
    kind: LashingKind
    routing: LashingRouting
    unit_id: Identifier
    anchor_ids: list[Identifier] = Field(
        min_length=1,
        max_length=2,
        description="Two anchors on opposite sides for top-over routing, one for direct.",
    )
    attachment_point_m: Vec3 | None = Field(
        default=None,
        description=(
            "Direct routing only: where the lashing is fixed on the unit, relative to the "
            "centre of the unit's bottom face [m]."
        ),
    )
    pretension_n: float = Field(
        ge=0,
        description=(
            "Tension applied when the lashing is installed [N]. For a ratchet strap this is "
            "the standard tension force S_TF on the label at most."
        ),
    )
    lashing_capacity_n: float = Field(
        gt=0, description="Rated capacity LC in straight pull [N] (label value in daN x 10)."
    )
    elongation_at_lc: float | None = Field(
        default=None,
        gt=0,
        le=0.5,
        description="Elongation at LC as a fraction (0.04 = 4 %). Defaults per lashing kind.",
    )
    breaking_strength_n: float | None = Field(
        default=None,
        gt=0,
        description="Force at which the lashing breaks [N]. If unset it never breaks.",
    )

    @model_validator(mode="after")
    def _routing_is_consistent(self) -> Self:
        if self.routing is LashingRouting.TOP_OVER:
            if len(self.anchor_ids) != 2 or self.anchor_ids[0] == self.anchor_ids[1]:
                raise ValueError("top-over routing needs two different anchor points")
            if self.attachment_point_m is not None:
                raise ValueError("attachment_point_m only applies to direct routing")
        else:
            if len(self.anchor_ids) != 1:
                raise ValueError("direct routing needs exactly one anchor point")
            if self.attachment_point_m is None:
                raise ValueError("direct routing needs attachment_point_m")
        if self.pretension_n > self.lashing_capacity_n:
            raise ValueError("pretension_n cannot exceed lashing_capacity_n")
        if self.breaking_strength_n is not None and self.breaking_strength_n < self.pretension_n:
            raise ValueError("breaking_strength_n cannot be below pretension_n")
        return self


class TripEvent(_Model):
    """What happens on the road. The physics inputs are derived from these few fields."""

    kind: EventKind
    speed_kmh: float = Field(ge=10, le=120, description="Truck speed when the event starts.")
    road_surface: RoadSurface = RoadSurface.DRY
    fog: bool = Field(
        default=False, description="Low visibility: the driver reacts later and brakes harder."
    )
    curve_radius_m: float | None = Field(
        default=None, ge=15, le=2000, description="Sharp curve only: radius of the curve [m]."
    )
    grade_percent: float | None = Field(
        default=None, ge=0, le=15, description="Mountain descent only: downhill grade [%]."
    )


class Scenario(_Model):
    """A loaded truck bed: bed, cargo units and lashings."""

    schema_version: Literal[1] = SCHEMA_VERSION
    id: Identifier
    name: str = Field(default="", max_length=120)
    bed: TruckBed
    vehicle: Vehicle | None = None
    units: list[CargoUnit] = Field(min_length=1, max_length=40)
    lashings: list[Lashing] = Field(default_factory=list, max_length=120)

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        _require_unique([unit.id for unit in self.units], "cargo unit")
        _require_unique([lashing.id for lashing in self.lashings], "lashing")
        units = {unit.id: unit for unit in self.units}
        anchors = {anchor.id: anchor for anchor in self.bed.anchor_points}
        for lashing in self.lashings:
            unit = units.get(lashing.unit_id)
            if unit is None:
                raise ValueError(f"lashing {lashing.id!r} refers to unknown unit")
            missing = [a for a in lashing.anchor_ids if a not in anchors]
            if missing:
                raise ValueError(f"lashing {lashing.id!r} refers to unknown anchor {missing[0]!r}")
            if lashing.routing is LashingRouting.TOP_OVER:
                first, second = (anchors[a].position_m for a in lashing.anchor_ids)
                unit_y = unit.position_m[1]
                if (first[1] - unit_y) * (second[1] - unit_y) >= 0:
                    raise ValueError(
                        f"lashing {lashing.id!r}: top-over anchors must be on opposite sides "
                        "of the unit"
                    )
                strap_x = (first[0] + second[0]) / 2
                if abs(strap_x - unit.position_m[0]) > unit.size_m[0] / 2:
                    raise ValueError(f"lashing {lashing.id!r} does not pass over its unit")
            else:
                point = lashing.attachment_point_m
                assert point is not None
                half_x, half_y = unit.size_m[0] / 2, unit.size_m[1] / 2
                inside = (
                    abs(point[0]) <= half_x + _CONTACT_TOLERANCE_M
                    and abs(point[1]) <= half_y + _CONTACT_TOLERANCE_M
                    and -_CONTACT_TOLERANCE_M <= point[2] <= unit.size_m[2] + _CONTACT_TOLERANCE_M
                )
                if not inside:
                    raise ValueError(f"lashing {lashing.id!r}: attachment point is off the unit")
        self._check_placement()
        return self

    def _check_placement(self) -> None:
        """Units may touch but not overlap, and each one rests on the floor or on a unit."""
        boxes = [(unit, *_bounds(unit)) for unit in self.units]
        for index, (unit, low, high) in enumerate(boxes):
            for other, other_low, other_high in boxes[index + 1 :]:
                overlap = all(
                    low[axis] < other_high[axis] - _CONTACT_TOLERANCE_M
                    and other_low[axis] < high[axis] - _CONTACT_TOLERANCE_M
                    for axis in range(3)
                )
                if overlap:
                    raise ValueError(f"units {unit.id!r} and {other.id!r} overlap")
            if low[2] <= _CONTACT_TOLERANCE_M:
                continue
            supported = any(
                other is not unit
                and abs(other_high[2] - low[2]) <= _CONTACT_TOLERANCE_M
                and low[0] < other_high[0]
                and other_low[0] < high[0]
                and low[1] < other_high[1]
                and other_low[1] < high[1]
                for other, other_low, other_high in boxes
            )
            if not supported:
                raise ValueError(f"unit {unit.id!r} is not resting on the floor or another unit")


def _bounds(unit: CargoUnit) -> tuple[Vec3, Vec3]:
    x, y, z = unit.position_m
    sx, sy, sz = unit.size_m
    return (x - sx / 2, y - sy / 2, z), (x + sx / 2, y + sy / 2, z + sz)


def _require_unique(ids: list[str], what: str) -> None:
    seen: set[str] = set()
    for identifier in ids:
        if identifier in seen:
            raise ValueError(f"duplicate {what} id {identifier!r}")
        seen.add(identifier)
