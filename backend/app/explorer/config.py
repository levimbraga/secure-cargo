"""Explorer configuration: one value per dimension, plus the edits made in the load editor.

The configuration travels in the page URL as a query string. ``to_query`` writes it in a
canonical form (fixed key order, defaults left out, numbers in a fixed format) that the
frontend reproduces exactly (``frontend/lib/explorer/config.ts``): the same configuration
always gives the same string, which is also the key of the static cache. Only characters that
URL encoding leaves alone are used ("*" separates the moves, "_" their fields).
"""

from enum import StrEnum
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.scenario import BodyType, EventKind


class Size(StrEnum):
    """Truck sizes of the Brazilian market (axle groups per CONTRAN Resolution 882/2021)."""

    VUC = "vuc"  # urban cargo vehicle, two axles
    THREE_QUARTER = "three_quarter"  # "3/4": light two-axle truck, between a VUC and a toco
    TOCO = "toco"  # two-axle rigid truck, single rear axle with dual tyres
    TRUCK = "truck"  # three-axle rigid truck, tandem rear axles
    SEMI = "semi"  # tractor and three-axle semi-trailer


class Cargo(StrEnum):
    WOOD_PALLET = "wood_pallet"
    PLASTIC_PALLET = "plastic_pallet"
    CRATE = "crate"
    DRUM = "drum"
    STEEL_COIL = "steel_coil"
    MACHINE = "machine"
    TALL_CABINET = "tall_cabinet"
    SACKS = "sacks"
    LONG_PIPES = "long_pipes"
    STACKED_BOXES = "stacked_boxes"


class Position(StrEnum):
    HEADBOARD = "headboard"  # against the headboard (front wall)
    GAP = "gap"  # with a gap to the headboard
    REAR = "rear"  # at the rear of the bed
    SIDE = "side"  # pushed to one side
    STACKED = "stacked"  # two layers, against the headboard


class Restraint(StrEnum):
    NONE = "none"
    TOP_OVER = "top_over"  # web straps over the load
    DIRECT = "direct"  # diagonal web straps from the corners
    CHAIN = "chain"  # diagonal chains from the corners
    ROPE = "rope"  # ropes over the load (prohibited for lashing in Brazil)
    BLOCKING = "blocking"  # beams or chocks against the load
    MAT = "mat"  # anti-slip mats under the load, with straps over it
    CRADLE = "cradle"  # coil cradle: chocks on both sides of a coil


class Road(StrEnum):
    STRAIGHT = "straight"  # straight highway
    CURVY = "curvy"  # curvy highway
    MOUNTAIN = "mountain"  # mountain descent
    DIRT = "dirt"  # dirt or gravel road
    POTHOLED = "potholed"  # potholed asphalt
    URBAN = "urban"  # city streets with speed bumps


class Weather(StrEnum):
    DRY = "dry"
    WET = "wet"
    HEAVY_RAIN = "heavy_rain"
    MUD = "mud"
    FOG = "fog"


MAX_UNITS = 20
MAX_STRAPS_PER_UNIT = 6
# Sets of four diagonal lashings (front and back, both sides) a unit can take: up to 12.
MAX_DIAGONAL_SETS = 3

Coordinate = Annotated[float, Field(ge=-10, le=10)]


class UnitMove(BaseModel):
    """Where the load editor moved one unit: the centre of its footprint on the bed [m]."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    index: int = Field(ge=0, lt=2 * MAX_UNITS)
    x_m: Coordinate
    y_m: Coordinate


class ExplorerConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    body: BodyType = BodyType.FLATBED
    size: Size = Size.TOCO
    cargo: Cargo = Cargo.WOOD_PALLET
    position: Position = Position.GAP
    restraint: Restraint = Restraint.TOP_OVER
    speed_kmh: int = Field(default=80, ge=20, le=100)
    road: Road = Road.STRAIGHT
    weather: Weather = Weather.DRY
    event: EventKind = EventKind.EMERGENCY_BRAKING
    # Edits of the load editor. None means "the cargo's default".
    count: int | None = Field(default=None, ge=1, le=MAX_UNITS)
    mass_kg: int | None = Field(default=None, ge=10, le=30_000)
    straps: tuple[int, ...] | None = Field(
        default=None, description="Lashings over each unit, in unit order."
    )
    moves: tuple[UnitMove, ...] = ()

    @model_validator(mode="after")
    def _valid(self) -> Self:
        if self.straps is not None:
            if not self.straps or len(self.straps) > 2 * MAX_UNITS:
                raise ValueError("straps needs one value per unit")
            if any(not 0 <= count <= MAX_STRAPS_PER_UNIT for count in self.straps):
                raise ValueError(f"each unit takes 0 to {MAX_STRAPS_PER_UNIT} lashings")
        indices = [move.index for move in self.moves]
        if len(set(indices)) != len(indices) or indices != sorted(indices):
            raise ValueError("moves must name each unit once, in order")
        return self

    def to_query(self) -> str:
        """The canonical query string (no leading '?')."""
        parts = [
            ("body", self.body.value),
            ("size", self.size.value),
            ("cargo", self.cargo.value),
            ("position", self.position.value),
            ("restraint", self.restraint.value),
            ("speed", str(self.speed_kmh)),
            ("road", self.road.value),
            ("weather", self.weather.value),
            ("event", self.event.value),
        ]
        if self.count is not None:
            parts.append(("n", str(self.count)))
        if self.mass_kg is not None:
            parts.append(("kg", str(self.mass_kg)))
        if self.straps is not None:
            parts.append(("straps", ".".join(str(count) for count in self.straps)))
        if self.moves:
            parts.append(
                (
                    "moves",
                    "*".join(
                        f"{move.index}_{_coordinate(move.x_m)}_{_coordinate(move.y_m)}"
                        for move in self.moves
                    ),
                )
            )
        return "&".join(f"{key}={value}" for key, value in parts)

    @classmethod
    def from_query(cls, values: dict[str, str]) -> Self:
        """Reads the query string's values (as a mapping); unknown keys are refused."""
        known = {
            "body",
            "size",
            "cargo",
            "position",
            "restraint",
            "speed",
            "road",
            "weather",
            "event",
            "n",
            "kg",
            "straps",
            "moves",
        }
        unknown = set(values) - known
        if unknown:
            raise ValueError(f"unknown parameter {sorted(unknown)[0]!r}")
        data: dict[str, object] = {
            key: values[key]
            for key in ("body", "size", "cargo", "position", "restraint", "road", "weather")
            if key in values
        }
        if "event" in values:
            data["event"] = values["event"]
        if "speed" in values:
            data["speed_kmh"] = values["speed"]
        if "n" in values:
            data["count"] = values["n"]
        if "kg" in values:
            data["mass_kg"] = values["kg"]
        if values.get("straps"):
            data["straps"] = tuple(values["straps"].split("."))
        if values.get("moves"):
            moves = []
            for item in values["moves"].split("*"):
                index, x, y = item.split("_")
                moves.append({"index": index, "x_m": x, "y_m": y})
            data["moves"] = tuple(moves)
        return cls.model_validate(data)


def _coordinate(value: float) -> str:
    """Two decimals, without a sign on zero: "-0.00" would not round-trip as the same key."""
    text = f"{value:.2f}"
    return "0.00" if text == "-0.00" else text
