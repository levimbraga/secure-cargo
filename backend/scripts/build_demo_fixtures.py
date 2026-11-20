"""Write the gallery's demo fixtures to ``backend/scenarios/demo``.

The fixtures are plain JSON and are what the API serves; this script is how they were made,
so they can be regenerated after a schema change:

    uv run python -m scripts.build_demo_fixtures

Each example is defined in ``app/demo/gallery.py`` as two explorer configurations; the
scenario of each is built by ``app/explorer``, exactly as the explorer page builds it. Truck
dimensions, tares and axle positions are illustrative values for the demo, not data of a
specific model (``notes/physics-sources.md``, "Explorer presets").
"""

import json

from app.demo.fixtures import DEMO_DIR, DemoScenario
from app.demo.gallery import GALLERY, GalleryExample
from app.explorer import build


def demo(example: GalleryExample) -> DemoScenario:
    as_loaded = build(
        example.as_loaded, scenario_id=f"{example.id}-as-loaded", name=example.as_loaded_name
    )
    fixed = build(example.fixed, scenario_id=f"{example.id}-fixed", name=example.fixed_name)
    assert as_loaded.event == fixed.event, example.id
    return DemoScenario(
        id=example.id,
        title=example.title,
        summary=example.summary,
        event=as_loaded.event,
        as_loaded=as_loaded.scenario,
        fixed=fixed.scenario,
        explorer={
            "as_loaded": example.as_loaded.to_query(),
            "fixed": example.fixed.to_query(),
        },
    )


def demos() -> tuple[DemoScenario, ...]:
    return tuple(demo(example) for example in GALLERY)


def main() -> None:
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    for item in demos():
        path = DEMO_DIR / f"{item.id}.json"
        path.write_text(json.dumps(item.model_dump(mode="json"), indent=2) + "\n")
        print(f"wrote {path.relative_to(DEMO_DIR.parents[1])}")


if __name__ == "__main__":
    main()
