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
    # US presets (2026-11-21, US mode): typical values, ``notes/us-rules.md`` section 4.
    US_BOX = "us_box"  # Class 6 box truck, 26 ft box, two axles
    US_STRAIGHT = "us_straight"  # straight truck, 24 ft bed, tandem rear axles
    US_FLATBED_48 = "us_flatbed_48"  # tractor and 48 ft flatbed semitrailer, five axles
    US_DRY_VAN_53 = "us_dry_van_53"  # tractor and 53 ft dry van, five axles
    US_STEP_DECK = "us_step_deck"  # tractor and 48 ft step deck (the lower deck is modelled)
    # EU presets (2026-11-21, EU mode): typical values, ``notes/eu-rules.md`` section 4.
    EU_7_5T = "eu_7_5t"  # 7.5 t rigid, two axles
    EU_18T = "eu_18t"  # 18 t rigid, two axles
    EU_26T = "eu_26t"  # 26 t rigid, three axles (driving tandem)
    EU_SEMI_136 = "eu_semi_136"  # 40 t articulated: 4x2 tractor and a 13.6 m tri-axle semi
    EU_FLATBED_136 = "eu_flatbed_136"  # 40 t articulated with a 13.6 m flatbed semi-trailer


US_SIZES = frozenset(
    {Size.US_BOX, Size.US_STRAIGHT, Size.US_FLATBED_48, Size.US_DRY_VAN_53, Size.US_STEP_DECK}
)
EU_SIZES = frozenset(
    {Size.EU_7_5T, Size.EU_18T, Size.EU_26T, Size.EU_SEMI_136, Size.EU_FLATBED_136}
)
EU_ARTICULATED = frozenset({Size.EU_SEMI_136, Size.EU_FLATBED_136})


class Country(StrEnum):
    """Whose rules a load is checked against. The physics is the same everywhere."""

    BR = "BR"  # CONTRAN Resolutions 945/2022 and 882/2021
    US = "US"  # 49 CFR 393 subpart I and 23 CFR 658
    EU = "EU"  # Directive 2014/47/EU Annex III (EN 12195-1, EN 12642) and Directive 96/53/EC


class BodyCode(StrEnum):
    """The body's strength code of EN 12642 (on its plate). Changes the walls in the model."""

    L = "L"  # headboard 0.4 P (at most 5,000 daN); a curtain holds nothing
    XL = "XL"  # headboard 0.5 P, side walls (curtains too) 0.4 P, rear wall 0.3 P


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
    # Anti-slip mats under the load and diagonal straps from its corners (straps over it as set):
    # Brazil asks for diagonals on a flatbed (CONTRAN 945/2022 art. 7 sole paragraph).
    MAT_DIRECT = "mat_direct"
    CRADLE = "cradle"  # coil cradle: chocks on both sides of a coil
    # A coil cradle plus chains through the eye, forward and backward (49 CFR 393.120(c)).
    CRADLE_CHAIN = "cradle_chain"


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
    # Whose rules the load is checked against; changes no physics (``country`` in the query).
    country: Country = Country.BR
    # The body's EN 12642 code (``code`` in the query); None: not given (code L assumed).
    body_code: BodyCode | None = None

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
        if self.country is not Country.BR:
            parts.append(("country", self.country.value))
        if self.body_code is not None:
            parts.append(("code", self.body_code.value))
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
            "country",
            "code",
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
        if "country" in values:
            data["country"] = values["country"]
        if "code" in values:
            data["body_code"] = values["code"]
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
