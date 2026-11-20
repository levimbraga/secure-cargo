"""Simulate the demo scenarios and write the results as static JSON for the frontend.

The site replays these files, so the demo works even when the API is cold or down:

    uv run python -m scripts.precompute_demo

Output: ``frontend/public/demo/index.json``, one ``<id>.<variant>.json`` per run, and one
``live/<id>.<variant>.json`` per run with the live model (MJCF and run plan) the browser steps
with MuJoCo WebAssembly.
"""

import json
from pathlib import Path

from app.demo import load_demo_scenarios
from app.demo.fixtures import VARIANTS
from physics.live import build_live_model
from physics.run import run_event, scenario_hash

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"


def build() -> dict[str, str]:
    """File name -> JSON content of every static demo file."""
    files: dict[str, str] = {}
    index = []
    for demo in load_demo_scenarios():
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
            name = f"{demo.id}.{variant}.json"
            document = {
                "id": demo.id,
                "variant": variant,
                "scenario_hash": scenario_hash(scenario, demo.event),
                "event": demo.event.model_dump(mode="json"),
                "scenario": scenario.model_dump(mode="json"),
                "result": result.model_dump(mode="json"),
            }
            files[name] = json.dumps(document, separators=(",", ":")) + "\n"
            live = build_live_model(scenario, demo.event)
            files[f"live/{name}"] = live.model_dump_json() + "\n"
            entry["variants"][variant] = {  # type: ignore[index]
                "file": name,
                "scenario_hash": document["scenario_hash"],
                "status": result.verdict.status,
            }
        index.append(entry)
    files["index.json"] = json.dumps({"scenarios": index}, indent=2) + "\n"
    return files


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, content in build().items():
        (OUTPUT_DIR / name).parent.mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / name).write_text(content)
        print(f"wrote frontend/public/demo/{name} ({len(content) / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
