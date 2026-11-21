"""The seeded demo inspections' results: every gallery example through the battery and the planner.

The demo organisation ("Demo Insurer", ``backend/worker/seed/demo.ts``) holds inspections made
from the gallery examples. Their results are computed here, once, and served as static files,
so the manager's dashboard opens them with the API down:

    uv run python -m scripts.build_demo_inspections

Output, under ``frontend/public/demo/inspections/``, per example:

* ``<id>.as_loaded.json``: the battery of the load as the gallery shows it (with the planner's
  recommendation), i.e. the ``POST /battery`` answer;
* ``<id>.fixed.json``: the battery of the planner's proven fix;
* ``<id>.plan.json``: the fix itself (draft and changes) without its battery;
* ``index.json``: per example, passed / total for both versions and whether the fix was proven.
"""

import json
from pathlib import Path

from app.demo.gallery import GALLERY
from app.explorer.draft import LoadDraft
from app.inspection.battery import run_battery
from app.storage import create_storage
from planner.plan import BatteryResponse, Recommendation, plan, recommend

ROOT = Path(__file__).resolve().parents[2]
EXPLORER_DIR = ROOT / "frontend" / "public" / "demo" / "explorer"
OUTPUT_DIR = ROOT / "frontend" / "public" / "demo" / "inspections"


def _write(path: Path, document: object) -> None:
    path.write_text(json.dumps(document, separators=(",", ":")) + "\n")


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    storage = create_storage("memory://")
    index: dict[str, dict[str, object]] = {}
    for example in GALLERY:
        source = json.loads((EXPLORER_DIR / f"{example.id}.as_loaded.json").read_text())
        draft = LoadDraft.model_validate(source["draft"])
        result = plan(storage, draft)
        loaded = run_battery(storage, draft)  # cached: the planner already ran it
        fixed_draft, changes = recommend(draft)
        response = BatteryResponse(
            **loaded.model_dump(),
            recommendation=Recommendation(draft=fixed_draft, changes=changes),
        )
        assert result.battery is not None
        _write(OUTPUT_DIR / f"{example.id}.as_loaded.json", response.model_dump(mode="json"))
        _write(OUTPUT_DIR / f"{example.id}.fixed.json", result.battery.model_dump(mode="json"))
        _write(
            OUTPUT_DIR / f"{example.id}.plan.json",
            result.model_dump(mode="json", exclude={"battery"}),
        )
        index[example.id] = {
            "passed": loaded.passed,
            "total": loaded.total,
            "fixed_passed": result.battery.passed,
            "verified": result.verified,
        }
        print(
            f"{example.id}: {loaded.passed}/{loaded.total} -> "
            f"{result.battery.passed}/7, verified={result.verified}"
        )
    _write(OUTPUT_DIR / "index.json", {"inspections": index})


if __name__ == "__main__":
    main()
