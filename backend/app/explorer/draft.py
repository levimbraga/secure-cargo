"""The load draft: the document the explorer's load editor edits.

A draft is the truck, the trip and the list of cargo units with their place on the bed and
the straps over each one. It is what a configuration of the explorer expands to
(``draft_from_config``), what a photo analysis will fill in (``source="photo"``), and what an
inspection saves. ``build_draft`` turns it into the scenario the physics engine simulates.

Positions are in the bed frame (X to the front, Y to the left, origin at the centre of the
floor): ``x_m``/``y_m`` are the centre of the unit's footprint. A unit that stands on another
names it in ``on``; its height follows from the stack.
"""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.explorer.config import (
    MAX_DIAGONAL_SETS,
    MAX_STRAPS_PER_UNIT,
    BodyCode,
    Cargo,
    Country,
    Restraint,
    Road,
    Size,
    Weather,
)
from app.scenario import BodyType, EventKind

Identifier = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")]
Coordinate = Annotated[float, Field(ge=-10, le=10)]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BodyStyle(StrEnum):
    """The body the driver picks on the truck cards; each one is simulated as a ``BodyType``.

    The rails of an open body and the rack of a tall-rack body are not rated restraints, so all
    three open styles are simulated as a flatbed with a headboard (``notes/physics-sources.md``,
    "Body styles"); the styles differ in the headboard height they suggest and in the drawing.
    """

    OPEN_LOW_SIDES = "open_low_sides"  # "carroceria aberta": low wooden or steel side rails
    OPEN_TALL_RACK = "open_tall_rack"  # open body with a tall rack ("grade alta")
    PLATFORM = "platform"  # flat platform, no side rails
    BOX = "box"  # closed van ("baú")
    CURTAIN_SIDER = "curtain_sider"  # "sider"


STYLE_BODY: dict[BodyStyle, BodyType] = {
    BodyStyle.OPEN_LOW_SIDES: BodyType.FLATBED,
    BodyStyle.OPEN_TALL_RACK: BodyType.FLATBED,
    BodyStyle.PLATFORM: BodyType.FLATBED,
    BodyStyle.BOX: BodyType.BOX,
    BodyStyle.CURTAIN_SIDER: BodyType.CURTAIN_SIDER,
}


class DraftTruck(_Model):
    """The truck. ``style`` and the measurements come from the truck cards or "My trucks".

    ``headboard_height_m`` is None when nobody gave it: the simulation then uses the body's
    usual headboard and CONTRAN 945 art. 8 is reported as "to confirm", never as failed.
    """

    body: BodyType = BodyType.FLATBED
    size: Size = Size.TOCO
    style: BodyStyle | None = None
    bed_length_m: float | None = Field(default=None, ge=2.0, le=15.0)
    headboard_height_m: float | None = Field(default=None, gt=0, le=4.0)
    anchors_per_side: int | None = Field(default=None, ge=2, le=40)
    body_code: BodyCode | None = Field(
        default=None,
        description=(
            "EN 12642 strength code of the body (L or XL), from its plate. None: not given; the "
            "model then assumes code L walls. An XL curtain-sider's curtains are side walls."
        ),
    )

    @model_validator(mode="after")
    def _style_matches(self) -> Self:
        if self.style is not None and STYLE_BODY[self.style] is not self.body:
            raise ValueError(f"a {self.style.value} body is simulated as {STYLE_BODY[self.style]}")
        return self


class DraftTrip(_Model):
    speed_kmh: int = Field(default=80, ge=20, le=100)
    road: Road = Road.STRAIGHT
    weather: Weather = Weather.DRY
    event: EventKind = EventKind.EMERGENCY_BRAKING


class DraftUnit(_Model):
    id: Identifier
    cargo: Cargo
    label: str = Field(default="", max_length=80)
    size_m: tuple[float, float, float] | None = Field(
        default=None, description="Length, width, height [m]; None: the cargo's usual size."
    )
    mass_kg: float | None = Field(
        default=None, gt=0, le=30_000, description="Mass [kg]; None: the cargo's usual mass."
    )
    x_m: Coordinate
    y_m: Coordinate
    on: Identifier | None = Field(default=None, description="Id of the unit it stands on.")
    straps: int = Field(
        default=0, ge=0, le=MAX_STRAPS_PER_UNIT, description="Top-over lashings over this unit."
    )
    diagonal_sets: int = Field(
        default=1,
        ge=1,
        le=MAX_DIAGONAL_SETS,
        description=(
            "With diagonal lashings or chains (restraint direct or chain), sets of four on this "
            "unit: forward and backward on both sides. Heavy units take more than one."
        ),
    )


class LoadDraft(_Model):
    version: Literal[1] = 1
    source: Literal["explorer", "photo", "manual"] = "explorer"
    country: Country = Field(
        default=Country.BR,
        description=(
            "Whose rules the load is checked against (BR: CONTRAN, US: FMCSA and 23 CFR 658, "
            "EU: Directive 2014/47/EU Annex III and Directive 96/53/EC). "
            "Changes no physics, only the rule checks and the planner's legal targets."
        ),
    )
    truck: DraftTruck = DraftTruck()
    trip: DraftTrip = DraftTrip()
    restraint: Restraint = Field(
        default=Restraint.TOP_OVER,
        description=(
            "How the load is secured besides the straps over each unit: diagonals, blocking, "
            "cradles or anti-slip mats apply to every unit on the floor."
        ),
    )
    units: list[DraftUnit] = Field(min_length=1, max_length=40)
    anchored_on_wood: bool = Field(
        default=False,
        description=(
            "Seen on a photo: lashings fixed to the wooden floor or rails instead of the metal "
            "frame (CONTRAN Resolution 945/2022, art. 6). Changes no physics, only the rule check."
        ),
    )

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        ids = [unit.id for unit in self.units]
        if len(set(ids)) != len(ids):
            raise ValueError("unit ids must be unique")
        known: set[str] = set()
        for unit in self.units:
            if unit.on is not None and unit.on not in known:
                raise ValueError(f"unit {unit.id!r} must come after the unit it stands on")
            known.add(unit.id)
        return self
