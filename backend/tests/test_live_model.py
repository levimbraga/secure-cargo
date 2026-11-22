"""The live model: the MJCF and run plan a browser steps with MuJoCo WebAssembly."""

import mujoco
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.demo import load_demo_scenarios
from app.demo.fixtures import VARIANTS
from physics.conditions import build_profile
from physics.live import build_live_model
from physics.run import run_event, scenario_hash
from scene.mjcf import build_scene


@pytest.mark.parametrize("demo", load_demo_scenarios(), ids=lambda demo: demo.id)
def test_the_live_model_is_what_the_server_simulates(demo) -> None:  # type: ignore[no-untyped-def]
    for variant in VARIANTS:
        scenario = demo.variant(variant)
        live = build_live_model(scenario, demo.event)
        profile, surface = build_profile(demo.event)
        scene = build_scene(scenario, surface_friction_cap=surface.cargo_friction_cap)

        assert live.mjcf == scene.xml
        assert live.scenario_hash == scenario_hash(scenario, demo.event)
        assert live.engine.mujoco_version == mujoco.__version__
        acceleration = np.asarray(live.profile.acceleration_mps2).reshape(-1, 3)
        assert np.array_equal(acceleration, profile.acceleration_mps2)
        assert live.profile.steps == profile.steps == len(live.profile.truck_speed_mps)
        assert [unit.id for unit in live.units] == [unit.id for unit in scenario.units]
        assert [lashing.id for lashing in live.lashings] == [item.id for item in scenario.lashings]


def test_the_live_model_names_exist_in_the_mjcf() -> None:
    demo = load_demo_scenarios()[0]
    live = build_live_model(demo.fixed, demo.event)
    model = mujoco.MjModel.from_xml_string(live.mjcf)

    assert model.body(live.names.bed_body).id > 0
    for joint in live.names.bed_joints:
        assert model.joint(joint).id >= 0
    assert model.geom(live.names.floor_geom).id >= 0
    assert live.names.headboard_geom is not None
    for unit in live.units:
        assert model.body(unit.body).id > 0 and model.geom(unit.geom).id >= 0
    for lashing in live.lashings:
        assert model.tendon(lashing.tendon).id >= 0
        if lashing.routing == "top_over":
            assert lashing.saddle_joint is not None
            assert model.joint(lashing.saddle_joint).id >= 0


def test_the_live_model_carries_the_checks_of_a_server_run() -> None:
    demo = next(d for d in load_demo_scenarios() if d.id == "weigh-station")
    live = build_live_model(demo.as_loaded, demo.event)
    result = run_event(demo.as_loaded, demo.event)

    assert live.axle_loads == result.axle_loads
    assert live.en_12195_1 == result.en_12195_1
    assert [finding.code for finding in live.axle_findings] == ["axle_overloaded"]
    assert live.thresholds.slide_fail_m == result.margins.slide_limit_m


def test_post_mjcf_returns_the_live_model(client: TestClient) -> None:
    demo = load_demo_scenarios()[0]
    payload = {
        "scenario": demo.as_loaded.model_dump(mode="json"),
        "event": demo.event.model_dump(mode="json"),
    }
    response = client.post("/mjcf", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["version"] == 1
    assert body["mjcf"].startswith("<mujoco")
    assert len(body["profile"]["acceleration_mps2"]) == 3 * body["profile"]["steps"]
    assert body["settings"]["timestep_s"] == 0.002


def test_get_scenario_mjcf_serves_json_and_xml(client: TestClient) -> None:
    live = client.get("/scenarios/emergency-braking/mjcf", params={"variant": "fixed"})
    xml = client.get(
        "/scenarios/emergency-braking/mjcf", params={"variant": "fixed", "format": "xml"}
    )

    assert live.status_code == 200 and len(live.json()["lashings"]) == 15
    assert xml.status_code == 200
    assert xml.headers["content-type"].startswith("application/xml")
    assert xml.text == live.json()["mjcf"]


def test_get_scenario_mjcf_rejects_unknown_ids(client: TestClient) -> None:
    response = client.get("/scenarios/nope/mjcf")

    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_scenario"
