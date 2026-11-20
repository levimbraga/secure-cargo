"""The four demo scenarios: "as loaded" fails and "fixed" passes, in simulation and on disk."""

import json
from pathlib import Path

import pytest

from app.demo import DemoScenario, load_demo_scenarios
from app.demo.fixtures import DEMO_ORDER, VARIANTS
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash
from scripts import build_demo_fixtures

DEMOS = load_demo_scenarios()
STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"


def test_there_are_four_demo_scenarios_in_the_site_order() -> None:
    assert tuple(demo.id for demo in DEMOS) == DEMO_ORDER
    assert DEMO_ORDER == ("emergency-braking", "weigh-station", "rope-lashing", "sharp-curve")


@pytest.mark.parametrize("demo", DEMOS, ids=DEMO_ORDER)
def test_as_loaded_fails_and_fixed_passes(demo: DemoScenario) -> None:
    as_loaded = run_event(demo.as_loaded, demo.event)
    fixed = run_event(demo.fixed, demo.event)

    assert as_loaded.verdict.status == "fail"
    assert fixed.verdict.status == "pass"
    assert fixed.verdict.findings == []
    assert max(unit.max_slide_m for unit in fixed.units) < 0.005


def test_each_demo_fails_for_the_reason_it_illustrates() -> None:
    reasons = {
        demo.id: {
            finding.code for finding in run_event(demo.as_loaded, demo.event).verdict.findings
        }
        for demo in DEMOS
    }

    assert {"unit_slid", "unit_hit_headboard"} <= reasons["emergency-braking"]
    assert reasons["weigh-station"] == {"axle_overloaded"}  # the load itself holds
    assert "unit_slid" in reasons["rope-lashing"]
    assert {"unit_tilted", "unit_left_bed"} <= reasons["sharp-curve"]


def test_the_fixed_version_carries_the_same_cargo() -> None:
    for demo in DEMOS:
        before = sorted((unit.id, unit.mass_kg, unit.size_m) for unit in demo.as_loaded.units)
        after = sorted((unit.id, unit.mass_kg, unit.size_m) for unit in demo.fixed.units)
        assert before == after


def test_the_fixtures_on_disk_are_what_the_generator_writes() -> None:
    generated = (
        build_demo_fixtures.emergency_braking(),
        build_demo_fixtures.weigh_station(),
        build_demo_fixtures.rope_lashing(),
        build_demo_fixtures.sharp_curve(),
    )
    assert generated == DEMOS


@pytest.mark.parametrize("demo", DEMOS, ids=DEMO_ORDER)
def test_the_static_results_shipped_with_the_site_are_current(demo: DemoScenario) -> None:
    for variant in VARIANTS:
        document = json.loads((STATIC_DIR / f"{demo.id}.{variant}.json").read_text())
        result = SimulationResult.model_validate(document["result"])

        # The hash covers the scenario, the event and the engine version: if any of them
        # changes, the static files have to be regenerated (scripts/precompute_demo.py).
        assert document["scenario_hash"] == scenario_hash(demo.variant(variant), demo.event)
        assert result.verdict.status == ("fail" if variant == "as_loaded" else "pass")
        assert result.keyframes.fps == 30
        assert len(result.keyframes.frames) == round(result.duration_s * 30) + 1


def test_the_static_index_lists_every_run() -> None:
    index = json.loads((STATIC_DIR / "index.json").read_text())

    assert [entry["id"] for entry in index["scenarios"]] == list(DEMO_ORDER)
    for entry in index["scenarios"]:
        assert entry["variants"]["as_loaded"]["status"] == "fail"
        assert entry["variants"]["fixed"]["status"] == "pass"
        for variant in VARIANTS:
            assert (STATIC_DIR / entry["variants"][variant]["file"]).is_file()
