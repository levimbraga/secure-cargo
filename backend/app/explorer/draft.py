"""The load draft: the document the explorer's load editor edits.

A draft is the truck, the trip and the list of cargo units with their place on the bed and
the straps over each one. It is what a configuration of the explorer expands to
(``draft_from_config``), what a photo analysis will fill in (``source="photo"``), and what an
inspection saves. ``build_draft`` turns it into the scenario the physics engine simulates.

Positions are in the bed frame (X to the front, Y to the left, origin at the centre of the
floor): ``x_m``/``y_m`` are the centre of the unit's footprint. A unit that stands on another
names it in ``on``; its height follows from the stack.
"""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.explorer.config import (
    MAX_STRAPS_PER_UNIT,
    Cargo,
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


class DraftTruck(_Model):
    body: BodyType = BodyType.FLATBED
    size: Size = Size.TOCO


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


class LoadDraft(_Model):
    version: Literal[1] = 1
    source: Literal["explorer", "photo", "manual"] = "explorer"
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
