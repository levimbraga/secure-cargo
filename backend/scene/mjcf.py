"""Scene generator: scenario -> MuJoCo model (MJCF).

Model
-----
* **Bed.** One body on three slide joints (X, Y, Z). The joints carry a very large armature,
  so the cargo cannot push the bed around; the simulation loop applies the force that gives
  the bed exactly the prescribed acceleration. Floor, headboard and side rails are box geoms.
* **Cargo units.** Free rigid bodies: boxes with uniform density, or cylinders (coils, drums,
  pipes) with the inertia of a thick-walled tube when they have an inner diameter.
* **Blocks** (chocks, beams, the sides of a coil cradle) are boxes fixed to the bed; like the
  walls they only block, without friction.
* **Lashings.** Spatial tendons with a tension-only spring (``springlength="0 L0"``): the rest
  length ``L0`` is shorter than the installed length, which creates the pretension, and the
  stiffness is ``EA / L0`` with ``EA = LC / elongation_at_LC``.
* **Top-over lashings** run anchor -> top edge -> top edge -> anchor. The two edge points sit
  on a light "saddle" that slides along the unit's length: the lashing presses the unit down
  (and centres it sideways) but does not hold it lengthwise, which is exactly the assumption
  of the frictional-lashing formula of EN 12195-1.
* **Direct lashings** run straight from an anchor to a point fixed on the unit.
* **Contacts** are explicit geom pairs, each with the friction factor of its material pair.
  Headboard, side rails and the road under the truck are frictionless.

The frame is the scenario's bed frame (X front, Y left, Z up, origin at the centre of the
floor surface).
"""

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass

from app.scenario import CargoUnit, CylinderAxis, Lashing, LashingRouting, Scenario, UnitShape
from physics.constants import TIMESTEP_S
from physics.friction import Friction, resolve_friction
from physics.lashing_properties import DEFAULT_ELONGATION_AT_LC

Vec3 = tuple[float, float, float]

BED_BODY = "bed"
BED_JOINTS = ("bed_x", "bed_y", "bed_z")
FLOOR_GEOM = "bed_floor"
HEADBOARD_GEOM = "bed_headboard"
REAR_WALL_GEOM = "bed_rear_wall"
BLOCK_GEOM_PREFIX = "block:"
ROAD_GEOM = "road"
# Euler angles (degrees) that turn MuJoCo's cylinder axis (local Z) onto each bed axis.
_CYLINDER_EULER = {CylinderAxis.X: "0 90 0", CylinderAxis.Y: "90 0 0", CylinderAxis.Z: "0 0 0"}

# Inertia added to each bed joint [kg]. It is about 10^5 times the heaviest legal load, so
# the reaction of the cargo changes the bed's acceleration by less than 0.01 %.
BED_ARMATURE_KG = 1.0e9

_WALL_THICKNESS_M = 0.10
_FLOOR_THICKNESS_M = 0.20
# Two points of a strap over a row closer than this are one: where two units touch, the
# strap passes from one top to the next (a zero-length piece of tendon has no direction).
_ROW_POINT_GAP_M = 0.03
# Mass of the stretch of lashing that rides on top of a unit [kg].
_SADDLE_MASS_KG = 0.5

# Contact model. "solref" is the time constant and damping ratio of MuJoCo's soft contacts:
# 10 ms (five time steps) is stiff enough that a loaded unit sinks well under a millimetre.
_CONTACT_SOLREF = "0.01 1"
# Contacts become active this far before touching, which keeps resting contacts steady.
_CONTACT_MARGIN_M = 0.002
# Walls stand this far outside the bed's edge, and blocks are this much smaller than their
# nominal size, on every side. A contact pushes until its two bodies are a margin apart, so
# a unit loaded right against a wall would otherwise be pushed off it (and lean on it with
# friction) before anything happens. With the setback it rests against the wall at zero force.
_WALL_SETBACK_M = _CONTACT_MARGIN_M
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

    @property
    def lying_axis(self) -> int | None:
        """Index (0 = X, 1 = Y) of the axis of a cylinder lying on its side; None otherwise.

        Such a unit can roll, and it has tipped over when that axis is no longer horizontal.
        """
        axis = self.unit.axis
        if (
            self.unit.shape is UnitShape.CYLINDER
            and axis is not None
            and axis is not CylinderAxis.Z
        ):
            return 0 if axis is CylinderAxis.X else 1
        return None


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
    # The unit (index) each of ``unit_points_m`` is on: one, or a row under a top-over strap.
    point_units: tuple[int, ...] = ()
    # The saddles of the other units of the row, which slide like ``saddle_joint``.
    extra_saddle_joints: tuple[str, ...] = ()

    @property
    def unit_indices(self) -> tuple[int, ...]:
        """Every unit the lashing acts on, its own first."""
        return tuple(dict.fromkeys((self.unit_index, *self.point_units)))


@dataclass(frozen=True)
class Scene:
    xml: str
    units: tuple[UnitModel, ...]
    lashings: tuple[LashingModel, ...]
    has_headboard: bool


def build_scene(
    scenario: Scenario, *, surface_friction_cap: float | None = None, visual: bool = False
) -> Scene:
    """Generate the MJCF document for a scenario.

    ``surface_friction_cap`` is the upper limit the trip conditions put on cargo friction
    (a dirty deck); ``None`` means the material table applies unchanged. ``visual`` adds what
    MuJoCo's own renderer needs to make a readable picture (a checkered ground, colours, a
    light, translucent cargo); it does not touch anything the physics uses.
    """
    bed = scenario.bed
    root = ET.Element("mujoco", model=f"securecargo-{scenario.id}")
    option = ET.SubElement(
        root,
        "option",
        timestep=_fmt(TIMESTEP_S),
        integrator="implicitfast",
        cone="elliptic",
        impratio=str(_IMPRATIO),
        noslip_iterations=str(_NOSLIP_ITERATIONS),
    )
    if any(unit.shape is UnitShape.CYLINDER for unit in scenario.units):
        # A cylinder lying on a flat floor touches it along a line. The general convex
        # collision finds a single point there, and a coil balanced on one point drifts
        # sideways; "multiccd" finds the points at both ends of the line.
        ET.SubElement(option, "flag", multiccd="enable")
    default = ET.SubElement(root, "default")
    # Collisions only happen between the explicit pairs listed under <contact>.
    ET.SubElement(default, "geom", contype="0", conaffinity="0")

    worldbody = ET.SubElement(root, "worldbody")
    # The road under the truck, so a unit that falls off the bed lands instead of falling
    # for ever. It is frictionless: what happens to cargo on the road is not simulated.
    ET.SubElement(
        worldbody,
        "geom",
        name=ROAD_GEOM,
        type="plane",
        size="0 0 1",
        pos=_vec((0, 0, -bed.floor_height_m)),
    )
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
            pos=(half_length + _WALL_SETBACK_M + _WALL_THICKNESS_M / 2, 0, height / 2),
        )
        bed_geoms.append(HEADBOARD_GEOM)
    if bed.side_rail_height_m > 0:
        height = bed.side_rail_height_m
        for name, side in (("bed_rail_left", 1), ("bed_rail_right", -1)):
            _box(
                bed_body,
                name,
                size=(half_length, _WALL_THICKNESS_M / 2, height / 2),
                pos=(0, side * (half_width + _WALL_SETBACK_M + _WALL_THICKNESS_M / 2), height / 2),
            )
            bed_geoms.append(name)
    if bed.rear_wall_height_m > 0:
        height = bed.rear_wall_height_m
        _box(
            bed_body,
            REAR_WALL_GEOM,
            size=(_WALL_THICKNESS_M / 2, half_width, height / 2),
            pos=(-half_length - _WALL_SETBACK_M - _WALL_THICKNESS_M / 2, 0, height / 2),
        )
        bed_geoms.append(REAR_WALL_GEOM)
    for block in bed.blocks:
        bx, by, bz = block.size_m
        name = f"{BLOCK_GEOM_PREFIX}{block.id}"
        _box(
            bed_body,
            name,
            size=(bx / 2 - _WALL_SETBACK_M, by / 2 - _WALL_SETBACK_M, bz / 2),
            pos=(block.position_m[0], block.position_m[1], bz / 2),
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
        if unit.shape is UnitShape.CYLINDER:
            _cylinder(body, geom_name, unit)
        else:
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
    by_id = {unit.id: unit for unit in scenario.units}
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

        point_units: tuple[int, ...] = ()
        extra_saddles: list[str] = []
        if lashing.routing is LashingRouting.TOP_OVER:
            first, second = lashing.anchor_ids
            # Order the anchors left (higher Y) then right.
            if anchors[first][1] < anchors[second][1]:
                first, second = second, first
            # The units under the strap, from left to right: one, or a row side by side.
            row = sorted(
                [unit, *(by_id[other] for other in lashing.also_over)],
                key=lambda item: -item.position_m[1],
            )
            path = [f"anchor:{first}"]
            last_world: Vec3 = anchors[first]
            points: list[Vec3] = []
            owners: list[int] = []
            for place, covered in enumerate(row):
                cx, cy, cz = covered.size_m
                strap_x = (anchors[first][0] + anchors[second][0]) / 2 - covered.position_m[0]
                primary = covered.id == unit.id
                suffix = lashing.id if primary else f"{lashing.id}:{covered.id}"
                joint = f"saddle_joint:{suffix}"
                if primary:
                    saddle_joint = joint
                else:
                    extra_saddles.append(joint)
                saddle = ET.SubElement(
                    unit_bodies[covered.id],
                    "body",
                    name=f"saddle:{suffix}",
                    pos=_vec((strap_x, 0, cz / 2)),
                )
                ET.SubElement(
                    saddle,
                    "joint",
                    name=joint,
                    type="slide",
                    axis="1 0 0",
                    limited="true",
                    range=f"{_fmt(-cx / 2 - strap_x)} {_fmt(cx / 2 - strap_x)}",
                )
                ET.SubElement(
                    saddle,
                    "inertial",
                    pos="0 0 0",
                    mass=_fmt(_SADDLE_MASS_KG),
                    diaginertia="0.01 0.01 0.01",
                )
                edge_left, edge_right = top_over_edges(
                    covered, strap_x, anchors[first], anchors[second]
                )
                on_covered: list[tuple[str, Vec3]] = [
                    (f"edge_left:{suffix}", edge_left),
                    (f"edge_right:{suffix}", edge_right),
                ]
                round_along = covered.shape is UnitShape.CYLINDER and covered.axis is CylinderAxis.X
                if round_along and len(row) > 1:
                    # Between two pipes the strap rests on each one's crest.
                    crest = (strap_x, 0.0, cy / 2)
                    inner = [
                        item
                        for side, item in enumerate(on_covered)
                        if (side == 0 and place == 0) or (side == 1 and place == len(row) - 1)
                    ]
                    if place == 0:
                        on_covered = [inner[0], (f"crest:{suffix}", crest)]
                    elif place == len(row) - 1:
                        on_covered = [(f"crest:{suffix}", crest), inner[-1]]
                    else:
                        on_covered = [(f"crest:{suffix}", crest)]
                for name, point in on_covered:
                    world = (
                        covered.position_m[0] + point[0],
                        covered.position_m[1] + point[1],
                        covered.position_m[2] + cz / 2 + point[2],
                    )
                    if math.dist(world, last_world) < _ROW_POINT_GAP_M:
                        continue  # two units touching: the strap passes from one to the next
                    last_world = world
                    ET.SubElement(
                        saddle, "site", name=name, pos=_vec((0, point[1], point[2] - cz / 2))
                    )
                    path.append(name)
                    points.append(point)
                    owners.append(unit_index[covered.id])
            path.append(f"anchor:{second}")
            for site in path:
                ET.SubElement(tendon, "site", site=site)
            anchor_points = (anchors[first], anchors[second])
            unit_points = tuple(points)
            point_units = tuple(owners)
        else:
            assert lashing.attachment_point_m is not None
            local = attachment_on_unit(unit, lashing.attachment_point_m)
            site_name = f"attachment:{lashing.id}"
            ET.SubElement(body, "site", name=site_name, pos=_vec(local))
            for site in (f"anchor:{lashing.anchor_ids[0]}", site_name):
                ET.SubElement(tendon, "site", site=site)
            anchor_points = (anchors[lashing.anchor_ids[0]],)
            unit_points = (local,)
            point_units = (unit_index[unit.id],)

        lashings.append(
            LashingModel(
                lashing=lashing,
                tendon=tendon_name,
                unit_index=unit_index[unit.id],
                axial_stiffness_n=axial_stiffness,
                saddle_joint=saddle_joint,
                anchor_points_m=anchor_points,
                unit_points_m=unit_points,
                point_units=point_units,
                extra_saddle_joints=tuple(extra_saddles),
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
        _pair(contact, ROAD_GEOM, model.geom, None)
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

    if visual:
        _add_visuals(root)
    ET.indent(root)
    return Scene(
        xml=ET.tostring(root, encoding="unicode"),
        units=tuple(units),
        lashings=tuple(lashings),
        has_headboard=bed.headboard is not None,
    )


def _add_visuals(root: ET.Element) -> None:
    """Appearance for MuJoCo's renderer: the classic checkered ground and translucent bodies."""
    visual = ET.SubElement(root, "visual")
    ET.SubElement(visual, "global", offwidth="1280", offheight="800")
    ET.SubElement(
        visual, "headlight", ambient="0.45 0.45 0.45", diffuse="0.5 0.5 0.5", specular="0 0 0"
    )
    ET.SubElement(visual, "map", force="0.0002")  # length of a force arrow per newton
    ET.SubElement(visual, "scale", contactwidth="0.12", contactheight="0.03", forcewidth="0.035")
    ET.SubElement(visual, "rgba", contactforce="0.85 0.1 0.1 1", contactpoint="0.95 0.65 0 1")
    asset = ET.SubElement(root, "asset")
    ET.SubElement(
        asset,
        "texture",
        type="skybox",
        builtin="gradient",
        rgb1="0.93 0.93 0.9",
        rgb2="0.75 0.77 0.8",
        width="256",
        height="256",
    )
    ET.SubElement(
        asset,
        "texture",
        name="checker",
        type="2d",
        builtin="checker",
        rgb1="0.82 0.82 0.79",
        rgb2="0.7 0.7 0.67",
        width="512",
        height="512",
    )
    # One checker square is one metre of road.
    ET.SubElement(
        asset, "material", name="checker", texture="checker", texrepeat="2 2", texuniform="true"
    )
    colours = {
        "unit_geom:": "0.83 0.69 0.48 0.45",
        "bed_": "0.62 0.64 0.66 1",
        BLOCK_GEOM_PREFIX: "0.45 0.33 0.2 1",
    }
    for geom in root.iter("geom"):
        name = geom.get("name", "")
        if name == ROAD_GEOM:
            geom.set("material", "checker")
            continue
        for prefix, rgba in colours.items():
            if name.startswith(prefix):
                geom.set("rgba", rgba)
    for tendon in root.iter("spatial"):
        tendon.set("width", "0.02")
        tendon.set("rgba", "0.95 0.63 0 1")
    worldbody = root.find("worldbody")
    assert worldbody is not None
    ET.SubElement(
        worldbody,
        "light",
        pos="-3 -4 9",
        dir="0.3 0.4 -1",
        diffuse="0.6 0.6 0.6",
        castshadow="true",
    )


def top_over_edges(
    unit: CargoUnit, strap_x: float, left_anchor: Vec3, right_anchor: Vec3
) -> tuple[Vec3, Vec3]:
    """Where a top-over strap leaves a unit on its left and right, relative to the unit's centre.

    ``strap_x``: the strap's place along the bed, from the unit's centre. On a box, the top
    edges. On a round unit, where the strap really touches it (lashing audit, 2026-11-22):
    across a pipe or coil lying along the truck, the tangent points from each anchor (the strap
    wraps the round side between them); along a coil lying across the truck, its surface under
    the strap; across a standing drum, the ends of the chord of its top circle.
    """
    sx, sy, sz = unit.size_m
    box = ((strap_x, sy / 2, sz / 2), (strap_x, -sy / 2, sz / 2))
    if unit.shape is not UnitShape.CYLINDER or unit.axis is None:
        return box
    if unit.axis is CylinderAxis.X:
        radius = sy / 2
        centre_y, centre_z = unit.position_m[1], unit.position_m[2] + sz / 2
        points = []
        for anchor in (left_anchor, right_anchor):
            u, v = anchor[1] - centre_y, anchor[2] - centre_z
            distance = math.hypot(u, v)
            if distance <= radius * 1.001:
                return box
            towards, spread = math.atan2(v, u), math.acos(radius / distance)
            angle = max(towards + spread, towards - spread, key=math.sin)
            points.append((strap_x, radius * math.cos(angle), radius * math.sin(angle)))
        return points[0], points[1]
    radius = sx / 2
    offset = min(abs(strap_x), radius)
    chord = math.sqrt(radius * radius - offset * offset)
    if unit.axis is CylinderAxis.Y:
        return (strap_x, sy / 2, chord), (strap_x, -sy / 2, chord)
    return (strap_x, chord, sz / 2), (strap_x, -chord, sz / 2)


def attachment_on_unit(unit: CargoUnit, point: Vec3) -> Vec3:
    """A direct lashing's point on the unit, relative to its centre.

    ``point`` is relative to the centre of the unit's bottom face. A point given on the box
    around a round unit but outside the cylinder (a corner) moves onto the cylinder's surface,
    straight towards its axis; a point inside (a coil's eye) stays.
    """
    sz = unit.size_m[2]
    x, y, z = point[0], point[1], point[2] - sz / 2
    if unit.shape is not UnitShape.CYLINDER or unit.axis is None:
        return (x, y, z)
    radius = unit.diameter_m / 2
    if unit.axis is CylinderAxis.Z:
        distance = math.hypot(x, y)
        if distance > radius:
            return (x * radius / distance, y * radius / distance, z)
    elif unit.axis is CylinderAxis.X:
        distance = math.hypot(y, z)
        if distance > radius:
            return (x, y * radius / distance, z * radius / distance)
    else:
        distance = math.hypot(x, z)
        if distance > radius:
            return (x * radius / distance, y, z * radius / distance)
    return (x, y, z)


def cylinder_inertia(unit: CargoUnit) -> Vec3:
    """Principal moments of inertia of a cylindrical unit about X, Y, Z of the bed [kg m^2].

    A thick-walled tube of outer radius R, inner radius r and length L: m (R^2 + r^2) / 2
    about its axis and m (3 (R^2 + r^2) + L^2) / 12 across it (r = 0 for a solid cylinder).
    """
    assert unit.axis is not None
    radius = unit.diameter_m / 2
    inner = (unit.inner_diameter_m or 0.0) / 2
    axis = {CylinderAxis.X: 0, CylinderAxis.Y: 1, CylinderAxis.Z: 2}[unit.axis]
    length = unit.size_m[axis]
    squares = radius**2 + inner**2
    along = unit.mass_kg * squares / 2
    across = unit.mass_kg * (3 * squares + length**2) / 12
    return (
        along if axis == 0 else across,
        along if axis == 1 else across,
        along if axis == 2 else across,
    )


def _cylinder(body: ET.Element, name: str, unit: CargoUnit) -> None:
    assert unit.axis is not None
    axis = {CylinderAxis.X: 0, CylinderAxis.Y: 1, CylinderAxis.Z: 2}[unit.axis]
    ET.SubElement(
        body,
        "inertial",
        pos="0 0 0",
        mass=_fmt(unit.mass_kg),
        diaginertia=_vec(cylinder_inertia(unit)),
    )
    ET.SubElement(
        body,
        "geom",
        name=name,
        type="cylinder",
        size=f"{_fmt(unit.diameter_m / 2)} {_fmt(unit.size_m[axis] / 2)}",
        euler=_CYLINDER_EULER[unit.axis],
        mass="0",
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
