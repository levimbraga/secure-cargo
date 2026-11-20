"""The scene generator produces a MuJoCo model that matches the scenario."""

import mujoco
import pytest

from app.scenario import (
    CargoMaterial,
    CargoUnit,
    FloorMaterial,
    Headboard,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    TruckBed,
)
from app.scenario.presets import side_anchor_points, top_over_lashings
from physics.constants import TIMESTEP_S
from scene.mjcf import BED_ARMATURE_KG, BED_JOINTS, build_scene

ANCHORS = side_anchor_points(length_m=6.0, width_m=2.4)


def scenario() -> Scenario:
    pallet = CargoUnit(
        id="pallet",
        size_m=(1.2, 1.0, 1.0),
        mass_kg=900,
        position_m=(0.0, 0.0, 0.0),
        material=CargoMaterial.SAWN_WOOD,
    )
    drum = CargoUnit(
        id="drum",
        size_m=(0.8, 0.8, 0.6),
        mass_kg=250,
        position_m=(0.0, 0.0, 1.0),
        material=CargoMaterial.PLASTIC_PALLET,
    )
    chain = Lashing(
        id="chain",
        kind=LashingKind.CHAIN,
        routing=LashingRouting.DIRECT,
        unit_id="pallet",
        anchor_ids=["L2"],
        attachment_point_m=(-0.6, 0.5, 0.5),
        pretension_n=1000,
        lashing_capacity_n=40000,
    )
    return Scenario(
        id="scene",
        bed=TruckBed(
            length_m=6.0,
            width_m=2.4,
            floor_material=FloorMaterial.PLYWOOD_LAMINATE,
            headboard=Headboard(height_m=1.2),
            side_rail_height_m=0.5,
            anchor_points=ANCHORS,
        ),
        units=[pallet, drum],
        lashings=[
            *top_over_lashings(
                pallet, ANCHORS, count=2, pretension_n=3000, lashing_capacity_n=25000
            ),
            chain,
        ],
    )


def test_the_generated_model_compiles_with_the_fixed_time_step() -> None:
    model = mujoco.MjModel.from_xml_string(build_scene(scenario()).xml)

    assert model.opt.timestep == TIMESTEP_S
    assert model.opt.integrator == mujoco.mjtIntegrator.mjINT_IMPLICITFAST
    assert model.opt.cone == mujoco.mjtCone.mjCONE_ELLIPTIC


def test_the_bed_is_one_body_on_three_heavy_slide_joints() -> None:
    model = mujoco.MjModel.from_xml_string(build_scene(scenario()).xml)

    for name in BED_JOINTS:
        joint = model.joint(name)
        assert joint.type[0] == mujoco.mjtJoint.mjJNT_SLIDE
        assert model.dof_armature[joint.dofadr[0]] == BED_ARMATURE_KG


def test_units_are_free_bodies_with_their_mass() -> None:
    scene = build_scene(scenario())
    model = mujoco.MjModel.from_xml_string(scene.xml)

    assert [unit.unit.id for unit in scene.units] == ["pallet", "drum"]
    assert model.body("unit:pallet").mass[0] == pytest.approx(900)
    assert model.joint("unit_joint:drum").type[0] == mujoco.mjtJoint.mjJNT_FREE
    assert model.body("unit:drum").pos == pytest.approx([0.0, 0.0, 1.3])


def test_each_lashing_is_a_spatial_tendon() -> None:
    scene = build_scene(scenario())
    model = mujoco.MjModel.from_xml_string(scene.xml)

    assert model.ntendon == 3
    top_over, direct = scene.lashings[0], scene.lashings[2]
    assert top_over.saddle_joint is not None and direct.saddle_joint is None
    assert len(top_over.anchor_points_m) == 2 and len(top_over.unit_points_m) == 2
    assert len(direct.anchor_points_m) == 1
    # Top-over: four points (anchor, two edges, anchor); direct: two.
    assert model.tendon_num[model.tendon(top_over.tendon).id] == 4
    assert model.tendon_num[model.tendon(direct.tendon).id] == 2
    # Strap: 25 kN at 5 % elongation; chain: 40 kN at 1 %.
    assert top_over.axial_stiffness_n == pytest.approx(25000 / 0.05)
    assert direct.axial_stiffness_n == pytest.approx(40000 / 0.01)


def test_friction_follows_the_material_table() -> None:
    scene = build_scene(scenario())
    model = mujoco.MjModel.from_xml_string(scene.xml)

    def pair_friction(geom1: str, geom2: str) -> float:
        ids = {model.geom(geom1).id, model.geom(geom2).id}
        for index in range(model.npair):
            if {int(model.pair_geom1[index]), int(model.pair_geom2[index])} == ids:
                return float(model.pair_friction[index][0])
        raise AssertionError(f"no contact pair for {geom1} and {geom2}")

    assert pair_friction("bed_floor", "unit_geom:pallet") == 0.45  # sawn wood on plywood
    assert pair_friction("bed_floor", "unit_geom:drum") == 0.20  # plastic pallet on plywood
    assert pair_friction("unit_geom:pallet", "unit_geom:drum") == 0.30  # unit on unit: fallback


def test_a_dirty_deck_lowers_the_friction_of_every_contact() -> None:
    scene = build_scene(scenario(), surface_friction_cap=0.2)

    assert [unit.floor_friction.coefficient for unit in scene.units] == [0.2, 0.2]
    assert scene.units[0].floor_friction.capped_by_dirty_surface
