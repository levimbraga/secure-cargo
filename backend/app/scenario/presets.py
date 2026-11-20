"""Helpers to build common scenario parts in code (fixtures, tests, the load advisor)."""

from app.scenario.models import (
    AnchorPoint,
    CargoUnit,
    Lashing,
    LashingKind,
    LashingRouting,
)


def side_anchor_points(
    *, length_m: float, width_m: float, spacing_m: float = 0.5, height_m: float = 0.0
) -> list[AnchorPoint]:
    """Lashing points along both edges of the bed, every ``spacing_m``.

    Ids are ``L<n>`` (left, +Y) and ``R<n>`` (right, -Y), numbered from the rear.
    """
    count = int(length_m / spacing_m)
    first = -(count - 1) * spacing_m / 2
    anchors: list[AnchorPoint] = []
    for index in range(count):
        x = round(first + index * spacing_m, 4)
        anchors.append(AnchorPoint(id=f"L{index}", position_m=(x, width_m / 2, height_m)))
        anchors.append(AnchorPoint(id=f"R{index}", position_m=(x, -width_m / 2, height_m)))
    return anchors


def nearest_anchor_pair(anchors: list[AnchorPoint], x_m: float) -> tuple[str, str]:
    """Ids of the left and right anchors closest to ``x_m`` along the bed."""

    def closest(side: int) -> str:
        on_side = (a for a in anchors if a.position_m[1] * side > 0)
        return min(on_side, key=lambda a: abs(a.position_m[0] - x_m)).id

    return closest(1), closest(-1)


def top_over_lashings(
    unit: CargoUnit,
    anchors: list[AnchorPoint],
    *,
    count: int,
    pretension_n: float,
    lashing_capacity_n: float,
    kind: LashingKind = LashingKind.STRAP,
    elongation_at_lc: float | None = None,
    breaking_strength_n: float | None = None,
) -> list[Lashing]:
    """``count`` top-over lashings spread evenly along a unit, on the nearest anchor pairs."""
    lashings: list[Lashing] = []
    used: set[tuple[str, str]] = set()
    for index in range(count):
        x = unit.position_m[0] - unit.size_m[0] / 2 + unit.size_m[0] * (index + 0.5) / count
        pair = nearest_anchor_pair(anchors, x)
        if pair in used:
            raise ValueError(f"not enough anchor points for {count} lashings on unit {unit.id!r}")
        used.add(pair)
        lashings.append(
            Lashing(
                id=f"{unit.id}-s{index + 1}",
                kind=kind,
                routing=LashingRouting.TOP_OVER,
                unit_id=unit.id,
                anchor_ids=list(pair),
                pretension_n=pretension_n,
                lashing_capacity_n=lashing_capacity_n,
                elongation_at_lc=elongation_at_lc,
                breaking_strength_n=breaking_strength_n,
            )
        )
    return lashings
