"""Simulate the demo scenarios and write the results as static files for the frontend.

The site replays these files, so the demo works even when the API is cold or down:

    uv run python -m scripts.precompute_demo

Output, under ``frontend/public/demo/``:

* ``index.json`` and one ``<id>.<variant>.json`` per run (scenario, event and server result);
* ``summaries.json``: every run without its keyframes, for pages rendered on the server;
* ``live/<id>.<variant>.json``: the live model (MJCF and run plan) the browser steps;
* ``explorer/index.json``: the explorer configurations that need no API (every gallery
  version, and the explorer's default), keyed by their canonical query string, each with its
  draft, scenario and event in ``explorer/<name>.json``;
* ``coverage.json``, and ``docs/coverage.md`` in the repository: which gallery example covers
  each option of each dimension.
"""

import json
from pathlib import Path

from app.demo import load_demo_scenarios
from app.demo.fixtures import VARIANTS
from app.demo.gallery import GALLERY
from app.explorer import ExplorerConfig, build
from physics.live import build_live_model
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash
from scripts.coverage import coverage, coverage_markdown

ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "frontend" / "public" / "demo"
COVERAGE_DOC = ROOT / "docs" / "coverage.md"


def _compact(document: object) -> str:
    return json.dumps(document, separators=(",", ":")) + "\n"


def _summary(result: SimulationResult) -> dict[str, object]:
    """What the pages render on the server: everything but the keyframes (lib/demo.ts)."""
    return {
        "duration_s": result.duration_s,
        "engine": {
            "mujoco_version": result.engine.mujoco_version,
            "timestep_s": result.engine.timestep_s,
        },
        "profile": result.profile,
        "verdict": result.verdict.model_dump(mode="json"),
        "units": [
            unit.model_dump(
                mode="json",
                include={
                    "id",
                    "friction_coefficient",
                    "max_slide_m",
                    "max_tilt_deg",
                    "peak_friction_use",
                    "hit_headboard",
                    "left_bed",
                },
            )
            for unit in result.units
        ],
        "margins": result.margins.model_dump(mode="json"),
        "axle_loads": [load.model_dump(mode="json") for load in result.axle_loads],
        "en_12195_1": [
            check.model_dump(
                mode="json",
                include={
                    "unit_id",
                    "method",
                    "installed_lashings",
                    "required_lashings",
                    "meets_standard",
                },
            )
            for check in result.en_12195_1
        ],
    }


def build_files() -> dict[str, str]:
    """File name -> content of every static demo file."""
    files: dict[str, str] = {}
    index = []
    explorer: dict[str, dict[str, str]] = {}
    results = {}
    summaries: dict[tuple[str, str], tuple[dict[str, object], SimulationResult]] = {}
    for demo, example in zip(load_demo_scenarios(), GALLERY, strict=True):
        entry: dict[str, object] = {
            "id": demo.id,
            "title": demo.title,
            "summary": demo.summary,
            "event": demo.event.model_dump(mode="json"),
            "variants": {},
        }
        for variant in VARIANTS:
            scenario = demo.variant(variant)
            result = run_event(scenario, demo.event)
            results[(demo.id, variant)] = result
            summaries[(demo.id, variant)] = (demo.event.model_dump(mode="json"), result)
            name = f"{demo.id}.{variant}.json"
            document = {
                "id": demo.id,
                "variant": variant,
                "scenario_hash": scenario_hash(scenario, demo.event),
                "event": demo.event.model_dump(mode="json"),
                "scenario": scenario.model_dump(mode="json"),
                "result": result.model_dump(mode="json"),
            }
            files[name] = _compact(document)
            live = build_live_model(scenario, demo.event)
            files[f"live/{name}"] = live.model_dump_json() + "\n"
            entry["variants"][variant] = {  # type: ignore[index]
                "file": name,
                "scenario_hash": document["scenario_hash"],
                "status": result.verdict.status,
                "explorer": demo.explorer[variant],
            }
            config = getattr(example, variant)
            built = build(config)
            files[f"explorer/{name}"] = _compact(
                {
                    "query": config.to_query(),
                    "config": config.model_dump(mode="json"),
                    "draft": built.draft.model_dump(mode="json"),
                    # The gallery fixture is the same load under the example's own ids.
                    "scenario": scenario.model_dump(mode="json"),
                    "event": built.event.model_dump(mode="json"),
                }
            )
            explorer[config.to_query()] = {
                "file": f"explorer/{name}",
                "live": f"live/{name}",
                "run": name,
            }
        index.append(entry)

    default = ExplorerConfig()
    if default.to_query() not in explorer:
        built = build(default)
        files["explorer/default.json"] = _compact(
            {
                "query": default.to_query(),
                "config": default.model_dump(mode="json"),
                "draft": built.draft.model_dump(mode="json"),
                "scenario": built.scenario.model_dump(mode="json"),
                "event": built.event.model_dump(mode="json"),
            }
        )
        files["live/explorer-default.json"] = (
            build_live_model(built.scenario, built.event).model_dump_json() + "\n"
        )
        explorer[default.to_query()] = {
            "file": "explorer/default.json",
            "live": "live/explorer-default.json",
        }

    files["index.json"] = json.dumps({"scenarios": index}, indent=2) + "\n"
    files["summaries.json"] = (
        json.dumps(
            {
                f"{demo_id}.{variant}": {"event": event, **_summary(result)}
                for (demo_id, variant), (event, result) in summaries.items()
            },
            indent=1,
        )
        + "\n"
    )
    files["explorer/index.json"] = json.dumps({"queries": explorer}, indent=2) + "\n"
    matrix = coverage(GALLERY, results)
    files["coverage.json"] = json.dumps(matrix, indent=2) + "\n"
    return files


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    files = build_files()
    for name, content in files.items():
        (OUTPUT_DIR / name).parent.mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / name).write_text(content)
        print(f"wrote frontend/public/demo/{name} ({len(content) / 1024:.0f} kB)")
    COVERAGE_DOC.write_text(coverage_markdown(json.loads(files["coverage.json"])))
    print(f"wrote {COVERAGE_DOC.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
