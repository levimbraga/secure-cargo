"""The gallery's demo scenarios: "as loaded" fails and "fixed" passes, in simulation and on disk."""

import json
from pathlib import Path

import pytest

from app.demo import DemoScenario, load_demo_scenarios
from app.demo.fixtures import DEMO_ORDER, VARIANTS
from physics.results import SimulationResult
from physics.run import run_event, scenario_hash
from rules.en12195 import check_scenario
from scripts import build_demo_fixtures

DEMOS = load_demo_scenarios()
STATIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo"


def test_the_gallery_examples_are_in_order() -> None:
    assert tuple(demo.id for demo in DEMOS) == DEMO_ORDER
    assert DEMO_ORDER == (
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


@pytest.mark.parametrize("demo", DEMOS, ids=DEMO_ORDER)
def test_as_loaded_fails_and_fixed_passes(demo: DemoScenario) -> None:
    as_loaded = run_event(demo.as_loaded, demo.event)
    fixed = run_event(demo.fixed, demo.event)

    assert as_loaded.verdict.status == "fail"
    assert fixed.verdict.status == "pass"
    assert fixed.verdict.findings == []
    assert max(unit.max_slide_m for unit in fixed.units) < 0.01


def test_each_demo_fails_for_the_reason_it_illustrates() -> None:
    reasons = {
        demo.id: {
            finding.code for finding in run_event(demo.as_loaded, demo.event).verdict.findings
        }
        for demo in DEMOS
    }

    assert {"unit_slid", "unit_hit_headboard"} <= reasons["emergency-braking"]
    assert {"unit_tilted", "unit_left_bed"} <= reasons["sharp-curve"]
    assert "unit_slid" in reasons["rope-lashing"]
    assert {"unit_rolled", "unit_hit_headboard"} <= reasons["steel-coil"]
    assert "unit_slid" not in reasons["steel-coil"]  # it rolled
    assert reasons["weigh-station"] == {"axle_overloaded"}  # the load itself holds
    assert {"unit_hit_headboard", "headboard_overloaded"} <= reasons["box-truck"]
    assert "unit_slid" in reasons["dirt-road"]
    assert "unit_slid" in reasons["anti-slip-mat"]
    assert "unit_slid" in reasons["full-trip"]


def test_on_the_dirt_road_the_straps_lose_half_their_tension_before_the_slide() -> None:
    demo = next(item for item in DEMOS if item.id == "dirt-road")
    as_loaded = run_event(demo.as_loaded, demo.event)
    for lashing in as_loaded.lashings:
        assert lashing.initial_tension_n > 2500
    # The pretension decays to half while the bed shakes; by the end of the run the slide
    # has pulled some straps tighter, but the ones that were left loose show the loss.
    assert min(item.final_tension_n for item in as_loaded.lashings) < 0.6 * 3000
    # With full pretension three straps hold: the slide is the vibration's doing.
    braking = demo.event.model_copy(update={"kind": "emergency_braking"})
    assert run_event(demo.as_loaded, braking).verdict.status == "pass"


@pytest.mark.parametrize("demo", DEMOS, ids=DEMO_ORDER)
def test_the_fixed_version_meets_en_12195_1_with_its_safety_factor(demo: DemoScenario) -> None:
    checks = check_scenario(demo.fixed)

    # Units held by blocking, stacked units and lying cylinders are outside the closed-form
    # check (None); every unit the standard covers meets it.
    assert False not in [check.meets_standard for check in checks]
    # EN 12195-1 does not assess a coil in a cradle, cargo held by a box body's walls, or round
    # pipes held by direct chains; the simulation decides those.
    assert True in [check.meets_standard for check in checks] or demo.id in (
        "steel-coil",
        "box-truck",
        "potholed-road",
        "overloaded-strap",
    )
    for check in checks:
        if check.method == "top_over":
            assert check.required_lashings is not None
            assert check.installed_lashings >= check.required_lashings


def test_the_as_loaded_versions_fall_short_of_the_standard_where_the_lashing_is_the_problem() -> (
    None
):
    meets = {
        demo.id: all(check.meets_standard for check in check_scenario(demo.as_loaded))
        for demo in DEMOS
    }

    # At the weigh station the lashing is fine; the load is in the wrong place. On the dirt
    # road three straps meet the standard, which assumes a clean deck and full pretension.
    assert meets == {
        "emergency-braking": False,
        "sharp-curve": False,
        "rope-lashing": False,
        "steel-coil": False,
        "weigh-station": True,
        "box-truck": False,
        "dirt-road": True,
        "anti-slip-mat": False,
        "full-trip": False,
        "curtain-sider": False,
        "potholed-road": False,
        "overloaded-strap": False,
    }


def test_the_fixed_runs_report_their_margins() -> None:
    for demo in DEMOS:
        margins = run_event(demo.fixed, demo.event).margins

        assert margins.max_slide_m < margins.slide_limit_m / 5
        if not demo.fixed.lashings:  # held by blocking
            assert margins.peak_lashing_force_ratio is None
            continue
        assert margins.peak_lashing_force_ratio is not None
        assert margins.peak_lashing_force_ratio < 0.5
        assert margins.lashing_capacity_reserve == pytest.approx(
            1 - margins.peak_lashing_force_ratio, abs=1e-4
        )


def test_the_fixed_version_carries_the_same_cargo() -> None:
    for demo in DEMOS:
        before = sorted((unit.id, unit.mass_kg, unit.size_m) for unit in demo.as_loaded.units)
        after = sorted((unit.id, unit.mass_kg, unit.size_m) for unit in demo.fixed.units)
        assert before == after


def test_the_fixtures_on_disk_are_what_the_generator_writes() -> None:
    assert build_demo_fixtures.demos() == DEMOS


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
        assert len(result.keyframes.frames) == _frame_count(result.duration_s)


def _frame_count(duration_s: float) -> int:
    """Keyframes of a run: the first, then one each time a 30 fps frame is due (2 ms steps)."""
    steps = round(duration_s / 0.002)
    frames = 1
    while round(frames / (30 * 0.002)) <= steps:
        frames += 1
    return frames


def test_the_static_index_lists_every_run() -> None:
    index = json.loads((STATIC_DIR / "index.json").read_text())

    assert [entry["id"] for entry in index["scenarios"]] == list(DEMO_ORDER)
    for entry in index["scenarios"]:
        assert entry["variants"]["as_loaded"]["status"] == "fail"
        assert entry["variants"]["fixed"]["status"] == "pass"
        for variant in VARIANTS:
            assert (STATIC_DIR / entry["variants"][variant]["file"]).is_file()


def test_every_run_has_its_raw_mujoco_render() -> None:
    # Written by scripts/render_demo_videos.py with MuJoCo's own renderer.
    for demo in DEMOS:
        for variant in VARIANTS:
            video = STATIC_DIR / "video" / f"{demo.id}.{variant}.mp4"
            assert video.is_file() and video.with_suffix(".jpg").is_file()
            assert 20_000 < video.stat().st_size < 400_000
