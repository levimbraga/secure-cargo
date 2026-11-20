"""Which gallery example covers each option of each dimension the product supports.

Options of the load and the trip come from the examples' explorer configurations; outcomes come
from what the simulation of each "as loaded" version actually reported, never from a label.
Written by ``scripts/precompute_demo.py`` to ``docs/coverage.md`` and the site.
"""

from collections.abc import Mapping
from typing import Any

from app.demo.fixtures import Variant
from app.demo.gallery import GalleryExample
from app.explorer import Cargo, ExplorerConfig, Position, Restraint, Road, Size, Weather
from app.scenario import BodyType, EventKind
from physics.results import SimulationResult

SPEED_BANDS = (("20_40", 20, 40), ("50_70", 50, 70), ("80_100", 80, 100))
OUTCOMES = (
    "slide",
    "tip_over",
    "roll",
    "hit_headboard",
    "fall_off_side",
    "strap_overload",
    "axle_overload",
    "pretension_loss",
)
# A lashing that ends the run below this share of its installed tension lost its pretension.
PRETENSION_LOSS_SHARE = 0.75


def _speed_band(speed: int) -> str:
    return next(band for band, low, high in SPEED_BANDS if low <= speed <= high)


def outcomes(result: SimulationResult) -> set[str]:
    """What happened in a run, from its findings and lashing tensions."""
    found: set[str] = set()
    for finding in result.verdict.findings:
        if finding.severity != "fail":
            continue
        found |= {
            "unit_slid": {"slide"},
            "unit_tilted": {"tip_over"},
            "unit_rolled": {"roll"},
            "unit_hit_headboard": {"hit_headboard"},
            "headboard_overloaded": {"hit_headboard"},
            "unit_left_bed": {"fall_off_side"},
            "lashing_overloaded": {"strap_overload"},
            "lashing_broke": {"strap_overload"},
            "axle_overloaded": {"axle_overload"},
        }.get(finding.code, set())
    if "pretension_after_vibration" in result.profile and any(
        lashing.final_tension_n < PRETENSION_LOSS_SHARE * lashing.initial_tension_n
        for lashing in result.lashings
    ):
        found.add("pretension_loss")
    return found


def coverage(
    gallery: tuple[GalleryExample, ...],
    results: Mapping[tuple[str, Variant], SimulationResult],
) -> dict[str, Any]:
    dimensions: dict[str, list[str]] = {
        "body": [item.value for item in BodyType],
        "size": [item.value for item in Size],
        "cargo": [item.value for item in Cargo],
        "position": [item.value for item in Position],
        "restraint": [item.value for item in Restraint],
        "speed": [band for band, _, _ in SPEED_BANDS],
        "road": [item.value for item in Road],
        "weather": [item.value for item in Weather],
        "event": [item.value for item in EventKind],
        "outcome": list(OUTCOMES),
    }
    hits: dict[str, dict[str, list[dict[str, str]]]] = {
        name: {option: [] for option in options} for name, options in dimensions.items()
    }

    def add(dimension: str, option: str, example: str, variant: str, via: str = "") -> None:
        entries = hits[dimension][option]
        item = {"example": example, "variant": variant, **({"via": via} if via else {})}
        if item not in entries:
            entries.append(item)

    for example in gallery:
        for variant in ("as_loaded", "fixed"):
            config: ExplorerConfig = getattr(example, variant)
            add("body", config.body.value, example.id, variant)
            add("size", config.size.value, example.id, variant)
            add("cargo", config.cargo.value, example.id, variant)
            add("position", config.position.value, example.id, variant)
            add("restraint", config.restraint.value, example.id, variant)
            add("speed", _speed_band(config.speed_kmh), example.id, variant)
            add("road", config.road.value, example.id, variant)
            add("weather", config.weather.value, example.id, variant)
            add("event", config.event.value, example.id, variant)
            event = results[(example.id, variant)].profile.get("segments")
            if isinstance(event, str):
                for segment in event.split(","):
                    add("event", segment, example.id, variant, via="full_trip")
        for outcome in sorted(outcomes(results[(example.id, "as_loaded")])):
            add("outcome", outcome, example.id, "as_loaded")
    return {
        "examples": [example.id for example in gallery],
        "dimensions": [
            {
                "id": name,
                "options": [{"id": option, "covered_by": hits[name][option]} for option in options],
            }
            for name, options in dimensions.items()
        ],
    }


def coverage_markdown(matrix: dict[str, Any]) -> str:
    options = [option for dimension in matrix["dimensions"] for option in dimension["options"]]
    covered = sum(1 for option in options if option["covered_by"])
    total = len(options)
    lines = [
        "# Gallery coverage",
        "",
        "Generated by `backend/scripts/precompute_demo.py`; do not edit by hand.",
        "",
        "Every option of every dimension the product supports, and the gallery examples that",
        "show it (`/app/examples`). Load and trip options come from each example's explorer",
        'configuration; outcomes come from what the simulation of the "as loaded" version',
        'reported. Events marked "in a full trip" appear as a segment of the full-trip example.',
        "",
        f"**{covered} of {total} options covered** by {len(matrix['examples'])} examples.",
        "",
    ]
    for dimension in matrix["dimensions"]:
        lines += [f"## {dimension['id'].capitalize()}", "", "| Option | Examples |", "|---|---|"]
        for option in dimension["options"]:
            examples = sorted(
                {
                    item["example"] + (" (in a full trip)" if item.get("via") else "")
                    for item in option["covered_by"]
                }
            )
            shown = ", ".join(examples) if examples else "**not covered yet**"
            lines.append(f"| {option['id']} | {shown} |")
        lines.append("")
    return "\n".join(lines)
