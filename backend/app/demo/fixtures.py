"""Loading the demo fixtures from ``backend/scenarios/demo``."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.scenario import Scenario, TripEvent

DEMO_DIR = Path(__file__).resolve().parents[2] / "scenarios" / "demo"
# Order of the examples in the gallery (app/demo/gallery.py).
DEMO_ORDER = (
    "emergency-braking",
    "sharp-curve",
    "rope-lashing",
    "steel-coil",
    "weigh-station",
    "box-truck",
    "dirt-road",
    "anti-slip-mat",
    "full-trip",
    "curtain-sider",
    "potholed-road",
    "overloaded-strap",
)

Variant = Literal["as_loaded", "fixed"]
VARIANTS: tuple[Variant, ...] = ("as_loaded", "fixed")


class DemoScenario(BaseModel):
    """One demo: the same cargo and trip event, loaded the way it arrived and the way we fix it."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    title: str
    summary: str = Field(description="What goes wrong as loaded, and what the fix is.")
    event: TripEvent
    as_loaded: Scenario
    fixed: Scenario
    explorer: dict[Variant, str] = Field(
        description="Canonical explorer query string of each version (app/explorer/config.py)."
    )

    def variant(self, name: Variant) -> Scenario:
        return self.as_loaded if name == "as_loaded" else self.fixed


@lru_cache
def load_demo_scenarios() -> tuple[DemoScenario, ...]:
    return tuple(
        DemoScenario.model_validate_json((DEMO_DIR / f"{name}.json").read_text())
        for name in DEMO_ORDER
    )
