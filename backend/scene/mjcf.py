"""Scene generator: scenario -> MuJoCo model (MJCF).

Model
-----
* **Bed.** One body on three slide joints (X, Y, Z). The joints carry a very large armature,
  so the cargo cannot push the bed around; the simulation loop applies the force that gives
  the bed exactly the prescribed acceleration. Floor, headboard and side rails are box geoms.
* **Cargo units.** Free rigid boxes with uniform density.
* **Lashings.** Spatial tendons with a tension-only spring (``springlength="0 L0"``): the rest
  length ``L0`` is shorter than the installed length, which creates the pretension, and the
  stiffness is ``EA / L0`` with ``EA = LC / elongation_at_LC``.
* **Top-over lashings** run anchor -> top edge -> top edge -> anchor. The two edge points sit
  on a light "saddle" that slides along the unit's length: the lashing presses the unit down
  (and centres it sideways) but does not hold it lengthwise, which is exactly the assumption
  of the frictional-lashing formula of EN 12195-1.
* **Direct lashings** run straight from an anchor to a point fixed on the unit.
* **Contacts** are explicit geom pairs, each with the friction factor of its material pair.

The frame is the scenario's bed frame (X front, Y left, Z up, origin at the centre of the
floor surface).
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.scenario import CargoUnit, Lashing, LashingRouting, Scenario
from physics.constants import TIMESTEP_S
from physics.friction import Friction, resolve_friction
from physics.lashing_properties import DEFAULT_ELONGATION_AT_LC

Vec3 = tuple[float, float, float]

BED_BODY = "bed"
BED_JOINTS = ("bed_x", "bed_y", "bed_z")
FLOOR_GEOM = "bed_floor"
HEADBOARD_GEOM = "bed_headboard"

# Inertia added to each bed joint [kg]. It is about 10^5 times the heaviest legal load, so
# the reaction of the cargo changes the bed's acceleration by less than 0.01 %.
BED_ARMATURE_KG = 1.0e9

_WALL_THICKNESS_M = 0.10
_FLOOR_THICKNESS_M = 0.20
# Mass of the stretch of lashing that rides on top of a unit [kg].
_SADDLE_MASS_KG = 0.5

# Contact model. "solref" is the time constant and damping ratio of MuJoCo's soft contacts:
# 10 ms (five time steps) is stiff enough that a loaded unit sinks well under a millimetre.
_CONTACT_SOLREF = "0.01 1"
# Contacts become active this far before touching, which keeps resting contacts steady.
_CONTACT_MARGIN_M = 0.002
# Friction-to-normal impedance ratio. Above 1 it suppresses the slow creep that soft
# contacts otherwise show below the friction limit.
_IMPRATIO = 10
# Extra solver pass that makes friction hold fully before anything else has to carry the
# load. Without it a unit resting against the headboard would lean on it with its whole
# inertia, as if the floor had no friction.
_NOSLIP_ITERATIONS = 10


@dataclass(frozen=True)
class UnitModel:
    unit: CargoUnit
    body: str
    geom: str
    floor_friction: Friction


@dataclass(frozen=True)
class LashingModel:
    lashing: Lashing
    tendon: str
    unit_index: int
    # Axial stiffness EA [N]: force per unit strain.
    axial_stiffness_n: float
    saddle_joint: str | None
    # Geometry for the replay: anchors in the bed frame, unit points relative to the unit centre.
    anchor_points_m: tuple[Vec3, ...]
    unit_points_m: tuple[Vec3, ...]


@dataclass(frozen=True)
class Scene:
    xml: str
    units: tuple[UnitModel, ...]
    lashings: tuple[LashingModel, ...]
    has_headboard: bool


def build_scene(scenario: Scenario, *, surface_friction_cap: float | None = None) -> Scene:
    """Generate the MJCF document for a scenario.

    ``surface_friction_cap`` is the upper limit the trip conditions put on cargo friction
    (a dirty deck); ``None`` means the material table applies unchanged.
    """
    bed = scenario.bed
    root = ET.Element("mujoco", model=f"securecargo-{scenario.id}")
    ET.SubElement(
        root,
        "option",
        timestep=_fmt(TIMESTEP_S),
        integrator="implicitfast",
        cone="elliptic",
        impratio=str(_IMPRATIO),
        noslip_iterations=str(_NOSLIP_ITERATIONS),
    )
    default = ET.SubElement(root, "default")
    # Collisions only happen between the explicit pairs listed under <contact>.
    ET.SubElement(default, "geom", contype="0", conaffinity="0")

    worldbody = ET.SubElement(root, "worldbody")
    bed_body = ET.SubElement(worldbody, "body", name=BED_BODY, gravcomp="1")
    for name, axis in zip(BED_JOINTS, ("1 0 0", "0 1 0", "0 0 1"), strict=True):
        ET.SubElement(
            bed_body, "joint", name=name, type="slide", axis=axis, armature=_fmt(BED_ARMATURE_KG)
        )

    half_length, half_width = bed.length_m / 2, bed.width_m / 2
    bed_geoms = [FLOOR_GEOM]
    _box(
        bed_body,
        FLOOR_GEOM,
        size=(half_length, half_width, _FLOOR_THICKNESS_M / 2),
        pos=(0, 0, -_FLOOR_THICKNESS_M / 2),
    )
    if bed.headboard is not None:
        height = bed.headboard.height_m
        _box(
            bed_body,
            HEADBOARD_GEOM,
            size=(_WALL_THICKNESS_M / 2, half_width, height / 2),
            pos=(half_length + _WALL_THICKNESS_M / 2, 0, height / 2),
        )
        bed_geoms.append(HEADBOARD_GEOM)
    if bed.side_rail_height_m > 0:
        height = bed.side_rail_height_m
        for name, side in (("bed_rail_left", 1), ("bed_rail_right", -1)):
            _box(
                bed_body,
                name,
                size=(half_length, _WALL_THICKNESS_M / 2, height / 2),
                pos=(0, side * (half_width + _WALL_THICKNESS_M / 2), height / 2),
            )
            bed_geoms.append(name)
    anchors = {anchor.id: anchor.position_m for anchor in bed.anchor_points}
    for anchor_id, position in anchors.items():
        ET.SubElement(bed_body, "site", name=f"anchor:{anchor_id}", pos=_vec(position))

    units: list[UnitModel] = []
    unit_bodies: dict[str, ET.Element] = {}
    for unit in scenario.units:
        sx, sy, sz = unit.size_m
        x, y, z = unit.position_m
        body_name, geom_name = f"unit:{unit.id}", f"unit_geom:{unit.id}"
        body = ET.SubElement(worldbody, "body", name=body_name, pos=_vec((x, y, z + sz / 2)))
        ET.SubElement(body, "freejoint", name=f"unit_joint:{unit.id}")
        ET.SubElement(
            body,
            "geom",
            name=geom_name,
            type="box",
            size=_vec((sx / 2, sy / 2, sz / 2)),
            mass=_fmt(unit.mass_kg),
        )
        unit_bodies[unit.id] = body
        friction = resolve_friction(
            unit.material,
            bed.floor_material,
            override=unit.friction_coefficient,
            surface_cap=surface_friction_cap,
        )
        units.append(UnitModel(unit, body_name, geom_name, friction))

    tendons = ET.SubElement(root, "tendon")
    unit_index = {unit.id: index for index, unit in enumerate(scenario.units)}
    lashings: list[LashingModel] = []
    for lashing in scenario.lashings:
        unit = scenario.units[unit_index[lashing.unit_id]]
        body = unit_bodies[unit.id]
        elongation = lashing.elongation_at_lc or DEFAULT_ELONGATION_AT_LC[lashing.kind]
        axial_stiffness = lashing.lashing_capacity_n / elongation
        tendon_name = f"lashing:{lashing.id}"
        tendon = ET.SubElement(tendons, "spatial", name=tendon_name)
        sx, sy, sz = unit.size_m
        saddle_joint: str | None = None
        anchor_points: tuple[Vec3, ...]
        unit_points: tuple[Vec3, ...]

        if lashing.routing is LashingRouting.TOP_OVER:
            first, second = lashing.anchor_ids
            # Order the anchors left (higher Y) then right.
            if anchors[first][1] < anchors[second][1]:
                first, second = second, first
            strap_x = (anchors[first][0] + anchors[second][0]) / 2 - unit.position_m[0]
            saddle_joint = f"saddle_joint:{lashing.id}"
            saddle = ET.SubElement(
                body, "body", name=f"saddle:{lashing.id}", pos=_vec((strap_x, 0, sz / 2))
            )
            ET.SubElement(
                saddle,
                "joint",
                name=saddle_joint,
                type="slide",
                axis="1 0 0",
                limited="true",
                range=f"{_fmt(-sx / 2 - strap_x)} {_fmt(sx / 2 - strap_x)}",
            )
            ET.SubElement(
                saddle,
                "inertial",
                pos="0 0 0",
                mass=_fmt(_SADDLE_MASS_KG),
                diaginertia="0.01 0.01 0.01",
            )
            left, right = f"edge_left:{lashing.id}", f"edge_right:{lashing.id}"
            ET.SubElement(saddle, "site", name=left, pos=_vec((0, sy / 2, 0)))
            ET.SubElement(saddle, "site", name=right, pos=_vec((0, -sy / 2, 0)))
            for site in (f"anchor:{first}", left, right, f"anchor:{second}"):
                ET.SubElement(tendon, "site", site=site)
            anchor_points = (anchors[first], anchors[second])
            unit_points = ((strap_x, sy / 2, sz / 2), (strap_x, -sy / 2, sz / 2))
        else:
            assert lashing.attachment_point_m is not None
            ax, ay, az = lashing.attachment_point_m
            local = (ax, ay, az - sz / 2)
            site_name = f"attachment:{lashing.id}"
            ET.SubElement(body, "site", name=site_name, pos=_vec(local))
            for site in (f"anchor:{lashing.anchor_ids[0]}", site_name):
                ET.SubElement(tendon, "site", site=site)
            anchor_points = (anchors[lashing.anchor_ids[0]],)
            unit_points = (local,)

        lashings.append(
            LashingModel(
                lashing=lashing,
                tendon=tendon_name,
                unit_index=unit_index[unit.id],
                axial_stiffness_n=axial_stiffness,
                saddle_joint=saddle_joint,
                anchor_points_m=anchor_points,
                unit_points_m=unit_points,
            )
        )
    if not lashings:
        root.remove(tendons)

    contact = ET.SubElement(root, "contact")
    for model in units:
        _pair(contact, FLOOR_GEOM, model.geom, model.floor_friction.coefficient)
        for wall in bed_geoms[1:]:
            # Headboard and side rails only block: they are modelled without friction, so a
            # wall never carries part of a unit's weight.
            _pair(contact, wall, model.geom, None)
    for index, upper in enumerate(units):
        for lower in units[index + 1 :]:
            # The friction of a unit-on-unit contact is that of the unit on top.
            top = upper if upper.unit.position_m[2] >= lower.unit.position_m[2] else lower
            friction = resolve_friction(
                top.unit.material,
                None,
                override=top.unit.friction_coefficient,
                surface_cap=surface_friction_cap,
            )
            _pair(contact, upper.geom, lower.geom, friction.coefficient)

    ET.indent(root)
    return Scene(
        xml=ET.tostring(root, encoding="unicode"),
        units=tuple(units),
        lashings=tuple(lashings),
        has_headboard=bed.headboard is not None,
    )


def _box(parent: ET.Element, name: str, *, size: Vec3, pos: Vec3) -> None:
    # The bed's own mass is irrelevant (its motion is prescribed); 1 kg keeps MuJoCo happy.
    ET.SubElement(parent, "geom", name=name, type="box", size=_vec(size), pos=_vec(pos), mass="1")


def _pair(contact: ET.Element, geom1: str, geom2: str, friction: float | None) -> None:
    """A contact pair; ``friction=None`` makes it frictionless."""
    pair = ET.SubElement(
        contact,
        "pair",
        geom1=geom1,
        geom2=geom2,
        condim="1" if friction is None else "3",
        solref=_CONTACT_SOLREF,
        margin=_fmt(_CONTACT_MARGIN_M),
    )
    if friction is not None:
        mu = _fmt(friction)
        pair.set("friction", f"{mu} {mu} 0.005 0.0001 0.0001")


def _fmt(value: float) -> str:
    return repr(float(value))


def _vec(values: Vec3) -> str:
    return " ".join(_fmt(v) for v in values)
