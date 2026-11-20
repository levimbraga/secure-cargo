"""The explorer: one choice per dimension of a load and a trip, turned into a scenario.

The gallery examples are explorer configurations too, so "Open in explorer" shows exactly the
example, and the static cache of the site is keyed by the same canonical query string.
"""

from app.explorer.build import BuildError, Built, build, build_draft, draft_from_config
from app.explorer.config import (
    Cargo,
    ExplorerConfig,
    Position,
    Restraint,
    Road,
    Size,
    Weather,
)
from app.explorer.draft import DraftTrip, DraftTruck, DraftUnit, LoadDraft

__all__ = [
    "BuildError",
    "Built",
    "Cargo",
    "DraftTrip",
    "DraftTruck",
    "DraftUnit",
    "ExplorerConfig",
    "LoadDraft",
    "Position",
    "Restraint",
    "Road",
    "Size",
    "Weather",
    "build",
    "build_draft",
    "draft_from_config",
]
