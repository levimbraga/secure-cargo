"""EU cargo securing: Directive 2014/47/EU, Article 13 and Annex III, with the standards it names.

Every check carries the Annex III point or Table 1 item, a stable ``code`` the UI translates, an
English message and, when it fails, the deficiency class a roadside inspection would give it
(``deficiency``: minor, major or dangerous). The texts, the worked examples and our readings are in
the workspace's ``notes/eu-rules.md``.

How a direction is assessed (Annex III I.1: 0.8 g forward, 0.5 g sideways, 0.5 g rearward). Each
stack (a unit on the floor and what stands on it) is held by the cargo mass every method holds,
added up as the EU's 2014 best-practice guidelines (EBPG) do in their worked examples (6.1.4):

* top-over lashing, EN 12195-1 eq. 10: ``2 mu sin(a) F_T / (g (c - mu) f_s)`` per lashing;
* direct lashing, eq. 35: ``LC (f_mu mu sin(a) + cos(a) cos(b)) / (g (c - f_mu mu))`` per lashing,
  with LC no more than its lashing point holds (EN 12640, EBPG table 3);
* a wall in contact (15 cm at most, EBPG A.2.4), EN 12642: its share of the wall's rating,
  ``R / (g (c - mu))``; a block or a cradle in front of or behind it holds it along the truck;
* friction alone when ``mu >= c`` (EBPG "no risk"). A cylinder lying down has no friction in the
  direction it rolls.

The ratio held / mass classes a shortfall (our reading of Table 1, notes/eu-rules.md section 1):
at least 2/3 is **major** ("inadequate"), less is **dangerous** ("less than 2/3 of required
strength"); and nothing but friction towards an open side (a flatbed's side or rear, a code L
curtain) is **dangerous**: the cargo can move outside the loading surface (Article 13(1)).
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal

from app.explorer.config import BodyCode
from app.explorer.draft import LoadDraft
from app.scenario import (
    AnchorPoint,
    BodyType,
    CargoUnit,
    CylinderAxis,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    UnitShape,
)
from physics.constants import (
    EN_CX_FORWARD,
    EN_CX_REARWARD,
    EN_CY_SLIDING,
    EN_CZ,
    EN_F_MU,
    EN_FS_FORWARD,
    EN_FS_OTHER,
    STANDARD_GRAVITY_MPS2,
)
from physics.friction import resolve_friction
from rules.contran945 import _blocked, _lashings_of, _stacks
from rules.fmcsa393 import RuleCheck

Direction = Literal["forward", "sideways", "rearward"]
Deficiency = Literal["minor", "major", "dangerous"]
DIRECTIONS: tuple[Direction, ...] = ("forward", "sideways", "rearward")

_G = STANDARD_GRAVITY_MPS2
# Annex III I.1 (the same values as EN 12195-1 Table 2 for road transport).
ACCELERATION: dict[Direction, float] = {
    "forward": EN_CX_FORWARD,
    "sideways": EN_CY_SLIDING,
    "rearward": EN_CX_REARWARD,
}
SAFETY_FACTOR: dict[Direction, float] = {
    "forward": EN_FS_FORWARD,
    "sideways": EN_FS_OTHER,
    "rearward": EN_FS_OTHER,
}
# EBPG A.2.2: 0.6 sideways when there is a risk of the cargo tipping.
TIPPING_ACCELERATION: dict[Direction, float] = {
    "forward": EN_CX_FORWARD,
    "sideways": 0.6,
    "rearward": EN_CX_REARWARD,
}
CONTACT_M = 0.15  # Table 1 item 20.1.1; EBPG A.2.4: voids of 15 cm at most
TWO_THIRDS = 2 / 3

# EN 12642 (EBPG section 2, figure 6): share of the payload P each wall holds; code L caps.
REAR_WALL_SHARE = {BodyCode.L: 0.25, BodyCode.XL: 0.3}
REAR_WALL_L_MAX_N = 31_000.0
SIDE_WALL_SHARE: dict[tuple[BodyType, BodyCode], float] = {
    (BodyType.BOX, BodyCode.L): 0.3,
    (BodyType.BOX, BodyCode.XL): 0.4,
    (BodyType.CURTAIN_SIDER, BodyCode.L): 0.0,  # "weather protection only"
    (BodyType.CURTAIN_SIDER, BodyCode.XL): 0.4,
}


def lashing_point_strength_n(vehicle_mass_kg: float) -> float:
    """EN 12640 minimum strength of a lashing point by the vehicle's total mass (EBPG table 3)."""
    if vehicle_mass_kg <= 7_500:
        return 8_000.0
    if vehicle_mass_kg <= 12_000:
        return 10_000.0
    return 20_000.0


def top_over_mass_kg(
    friction: float, sine: float, tension_n: float, direction: Direction, lashings: int = 1
) -> float:
    """Cargo mass held from sliding by top-over lashings (EN 12195-1 eq. 10, EBPG 6.1.2)."""
    c = ACCELERATION[direction]
    if c - friction * EN_CZ <= 0:
        return math.inf
    return (
        lashings
        * 2
        * friction
        * sine
        * tension_n
        / (_G * (c - friction * EN_CZ) * SAFETY_FACTOR[direction])
    )


def direct_mass_kg(friction: float, restraint_n: float, direction: Direction) -> float:
    """Cargo mass held by direct lashings that restrain ``restraint_n`` (eq. 35, EBPG 6.1.3).

    ``restraint_n`` is the sum of ``LC (f_mu mu sin(a) + cos(a) cos(b))`` of the lashings.
    """
    c = ACCELERATION[direction]
    if c - EN_F_MU * friction * EN_CZ <= 0:
        return math.inf
    return restraint_n / (_G * (c - EN_F_MU * friction * EN_CZ))


def wall_mass_kg(friction: float, wall_n: float, direction: Direction) -> float:
    """Cargo mass a wall of strength ``wall_n`` blocks (EBPG table 1: 5,000 daN / ((0.8-mu) g))."""
    c = ACCELERATION[direction]
    if c - friction * EN_CZ <= 0:
        return math.inf
    return wall_n / (_G * (c - friction * EN_CZ))


@dataclass
class _Hold:
    """What holds one stack in one direction."""

    lashing_kg: float = 0.0  # top-over and direct lashings
    lashing_lc_kg: float = 0.0  # the same, with each direct lashing at its full LC
    wall_kg: float = 0.0
    blocked: bool = False
    friction_alone: bool = False  # mu >= c: no risk of sliding (EBPG A.2.1)
    wall_unknown: bool = False  # leans on a wall with no rating (a flatbed's headboard)
    methods: set[str] = field(default_factory=set)


@dataclass
class _Stack:
    units: list[CargoUnit]
    mass_kg: float
    friction: float
    hold: dict[Direction, _Hold]

    @property
    def ids(self) -> list[str]:
        return [u.id for u in self.units]

    def held_kg(self, direction: Direction, *, lc: bool = False) -> float:
        hold = self.hold[direction]
        if hold.friction_alone or hold.blocked:
            return math.inf
        lashing = hold.lashing_lc_kg if lc else hold.lashing_kg
        return lashing + hold.wall_kg

    def ratio(self, direction: Direction, *, lc: bool = False) -> float:
        return self.held_kg(direction, lc=lc) / self.mass_kg if self.mass_kg else math.inf


def body_code(draft: LoadDraft | None) -> tuple[BodyCode, bool]:
    """The body's EN 12642 code and whether it was assumed (no code given: L)."""
    code = draft.truck.body_code if draft else None
    return (code or BodyCode.L), code is None


def _rolls(unit: CargoUnit) -> set[Direction]:
    if unit.shape is not UnitShape.CYLINDER or unit.axis is CylinderAxis.Z:
        return set()
    return {"sideways"} if unit.axis is CylinderAxis.X else {"forward", "rearward"}


def _top(stack: list[CargoUnit]) -> float:
    return max(u.position_m[2] + u.size_m[2] for u in stack)


def _span(unit: CargoUnit, axis: int) -> tuple[float, float]:
    return (
        unit.position_m[axis] - unit.size_m[axis] / 2,
        unit.position_m[axis] + unit.size_m[axis] / 2,
    )


def _overlap(a: tuple[float, float], b: tuple[float, float]) -> float:
    return min(a[1], b[1]) - max(a[0], b[0])


def _floor(stacks: list[list[CargoUnit]]) -> list[list[CargoUnit]]:
    return [s for s in stacks if s[0].position_m[2] == 0]


def _chain(scenario: Scenario, stacks: list[list[CargoUnit]], sign: int) -> set[int]:
    """Stacks pressing on the front (sign +1) or rear (sign -1) wall, directly or through others.

    A stack within ``CONTACT_M`` of the wall, or of a stack in its lane that is itself in the
    chain, transmits its load to the wall (EBPG A.2.4, overall blocking).
    """
    half = scenario.bed.length_m / 2
    floor = _floor(stacks)
    order = sorted(range(len(floor)), key=lambda i: -sign * floor[i][0].position_m[0])
    chained: set[int] = set()
    index_of = {id(s): stacks.index(s) for s in floor}
    for i in order:
        base = floor[i][0]
        lo, hi = _span(base, 0)
        end = hi if sign > 0 else lo
        if half - sign * end <= CONTACT_M + 1e-9:
            chained.add(index_of[id(floor[i])])
            continue
        lane = _span(base, 1)
        for j in chained:
            other = stacks[j][0]
            if _overlap(lane, _span(other, 1)) <= 0.01:
                continue
            olo, ohi = _span(other, 0)
            face = olo if sign > 0 else ohi
            gap = sign * (face - end)
            if -0.01 <= gap <= CONTACT_M + 1e-9:
                chained.add(index_of[id(floor[i])])
                break
    return chained


def _sides_closed(scenario: Scenario, stacks: list[list[CargoUnit]]) -> set[int]:
    """Stacks whose row leaves 15 cm at most of void across the width (EBPG A.2.4, 6.3)."""
    floor = _floor(stacks)
    closed: set[int] = set()
    for stack in floor:
        span = _span(stack[0], 0)
        row = [
            s
            for s in floor
            if _overlap(span, _span(s[0], 0)) >= 0.5 * min(stack[0].size_m[0], s[0].size_m[0])
        ]
        width = sum(s[0].size_m[1] for s in row)
        if scenario.bed.width_m - width <= CONTACT_M + 1e-9:
            closed.add(stacks.index(stack))
    return closed


def _anchors(scenario: Scenario) -> dict[str, AnchorPoint]:
    return {a.id: a for a in scenario.bed.anchor_points}


def _vehicle_mass_kg(scenario: Scenario) -> float:
    if scenario.vehicle is None:
        return 0.0
    tare = sum(g.tare_load_kg for g in scenario.vehicle.axle_groups)
    return tare + (scenario.vehicle.payload_kg or sum(u.mass_kg for u in scenario.units))


def _point_n(scenario: Scenario, anchor: AnchorPoint) -> float:
    return anchor.rated_capacity_n or lashing_point_strength_n(_vehicle_mass_kg(scenario))


def _top_over_sine(scenario: Scenario, unit: CargoUnit, lashing: Lashing) -> float:
    anchors = _anchors(scenario)
    top = unit.position_m[2] + unit.size_m[2]
    sines = []
    for anchor_id in lashing.anchor_ids:
        anchor = anchors[anchor_id].position_m
        side = 1.0 if anchor[1] > unit.position_m[1] else -1.0
        edge_y = unit.position_m[1] + side * unit.size_m[1] / 2
        rise = top - anchor[2]
        sines.append(rise / math.hypot(rise, anchor[1] - edge_y))
    return min(sines)


_MOVEMENT: dict[Direction, tuple[tuple[float, float], ...]] = {
    "forward": ((1.0, 0.0),),
    "rearward": ((-1.0, 0.0),),
    "sideways": ((0.0, 1.0), (0.0, -1.0)),
}


def _direct_restraint_n(
    scenario: Scenario,
    units: dict[str, CargoUnit],
    lashings: Iterable[Lashing],
    friction: float,
    direction: Direction,
    *,
    with_points: bool,
) -> float:
    """``sum LC (f_mu mu sin(a) + cos(a) cos(b))`` of the direct lashings pulling against a move."""
    anchors = _anchors(scenario)
    effective = EN_F_MU * friction
    totals = []
    for movement in _MOVEMENT[direction]:
        total = 0.0
        for lashing in lashings:
            unit = units[lashing.unit_id]
            assert lashing.attachment_point_m is not None
            anchor = anchors[lashing.anchor_ids[0]]
            point = [unit.position_m[k] + lashing.attachment_point_m[k] for k in range(3)]
            pull = [anchor.position_m[k] - point[k] for k in range(3)]
            span = math.hypot(*pull)
            against = -(pull[0] * movement[0] + pull[1] * movement[1]) / span
            if against <= 0:
                continue
            down = max(-pull[2] / span, 0.0)
            capacity = lashing.lashing_capacity_n
            if with_points:
                capacity = min(capacity, _point_n(scenario, anchor))
            total += capacity * (effective * down + against)
        totals.append(total)
    return min(totals)


def _assess(scenario: Scenario, draft: LoadDraft | None) -> list[_Stack]:
    bed = scenario.bed
    code, _ = body_code(draft)
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    stacks = _stacks(scenario)
    units = {u.id: u for u in scenario.units}
    out: list[_Stack] = []
    for stack in stacks:
        base = stack[0]
        friction = resolve_friction(
            base.material, bed.floor_material, override=base.friction_coefficient
        ).coefficient
        lashings = _lashings_of(scenario, stack)
        mass = sum(u.mass_kg for u in stack)
        rolls = _rolls(base)
        hold: dict[Direction, _Hold] = {}
        for direction in DIRECTIONS:
            mu = 0.0 if direction in rolls else friction
            h = _Hold(friction_alone=mu * EN_CZ >= ACCELERATION[direction])
            for lashing in lashings:
                if lashing.routing is LashingRouting.TOP_OVER:
                    held = top_over_mass_kg(
                        mu,
                        _top_over_sine(scenario, units[lashing.unit_id], lashing),
                        lashing.pretension_n,
                        direction,
                    )
                    h.lashing_kg += held
                    h.lashing_lc_kg += held
                    h.methods.add("top_over")
            direct = [x for x in lashings if x.routing is LashingRouting.DIRECT]
            if direct:
                h.methods.add("direct")
                for with_points in (True, False):
                    held = direct_mass_kg(
                        mu,
                        _direct_restraint_n(
                            scenario, units, direct, mu, direction, with_points=with_points
                        ),
                        direction,
                    )
                    if with_points:
                        h.lashing_kg += held
                    else:
                        h.lashing_lc_kg += held
            if direction != "sideways" and _blocked(scenario, stack):
                h.blocked = True
                h.methods.add("block")
            hold[direction] = h
        out.append(_Stack(stack, mass, friction, hold))

    # Walls: each wall's rating shared by the stacks leaning on it, in proportion to their mass
    # (EBPG 6.3: the force is spread evenly over the wall).
    walls: list[tuple[Direction, set[int], float | None]] = []
    if bed.headboard is not None:
        walls.append(("forward", _chain(scenario, stacks, +1), bed.headboard.rated_capacity_n))
    if bed.rear_wall_height_m > 0 and payload:
        share = REAR_WALL_SHARE[code] * payload * _G
        rear = min(share, REAR_WALL_L_MAX_N) if code is BodyCode.L else share
        walls.append(("rearward", _chain(scenario, stacks, -1), rear))
    if bed.side_rail_height_m > 0 and payload and bed.body is not BodyType.FLATBED:
        side = SIDE_WALL_SHARE.get((bed.body, code), 0.0) * payload * _G
        walls.append(("sideways", _sides_closed(scenario, stacks), side))
    for direction, leaning, rating in walls:
        total = sum(out[i].mass_kg for i in leaning)
        for i in leaning:
            h = out[i].hold[direction]
            h.methods.add("wall")
            if rating is None:
                h.wall_unknown = True
                continue
            mu = 0.0 if direction in _rolls(out[i].units[0]) else out[i].friction
            share = rating * out[i].mass_kg / total if total else 0.0
            h.wall_kg = wall_mass_kg(mu, share, direction)
    return out


def _closed(scenario: Scenario, direction: Direction) -> bool:
    """Whether a wall closes the loading space that way (even one that is too weak)."""
    bed = scenario.bed
    if direction == "forward":
        return bed.headboard is not None
    if direction == "rearward":
        return bed.rear_wall_height_m > 0
    return bed.side_rail_height_m > 0


_WALL_ITEM: dict[Direction, str] = {
    "forward": "Table 1 item 10.1.2",
    "sideways": "Table 1 item 10.2.2",
    "rearward": "Table 1 item 10.3.2",
}
_GAP_ITEM: dict[Direction, str] = {
    "forward": "Table 1 item 20.1.1.1",
    "sideways": "Table 1 item 20.1.1.2",
    "rearward": "Table 1 item 20.1.1.3",
}


def _unsecured(stack: _Stack) -> bool:
    """No lashing, block or wall anywhere: Table 1 item 30, "load entirely unsecured"."""
    return not any(h.methods for h in stack.hold.values())


def _classify(scenario: Scenario, stack: _Stack, direction: Direction) -> tuple[Deficiency, str]:
    """The deficiency class of a stack that is not held enough, and the Table 1 item behind it."""
    hold = stack.hold[direction]
    ratio = stack.ratio(direction)
    acting = hold.methods - {"wall"} or ({"wall"} if hold.wall_kg > 0 else set())
    if not acting:
        if not _closed(scenario, direction):
            item = "Table 1 item 30" if _unsecured(stack) else "Table 1 item 20.1.2.4"
            return "dangerous", f"Directive 2014/47/EU Art. 13(1); Annex III, {item}"
        return "major", f"Directive 2014/47/EU Annex III, {_GAP_ITEM[direction]}"
    if "direct" in acting:
        item = "Table 1 item 20.1.5.1"
    elif "top_over" in acting:
        item = "Table 1 item 20.2.1.1"
    else:
        item = _WALL_ITEM[direction]
    return (
        "major" if ratio >= TWO_THIRDS else "dangerous"
    ), f"Directive 2014/47/EU Annex III, {item}"


_RANK: dict[Deficiency, int] = {"minor": 0, "major": 1, "dangerous": 2}


def worst(classes: Iterable[Deficiency | None]) -> Deficiency | None:
    best: Deficiency | None = None
    for c in classes:
        if c is not None and (best is None or _RANK[c] > _RANK[best]):
            best = c
    return best


def _direction_check(scenario: Scenario, stacks: list[_Stack], direction: Direction) -> RuleCheck:
    code = f"eu_{direction}"
    article = "Directive 2014/47/EU Annex III I.1; EN 12195-1"
    if not stacks:
        return RuleCheck(code=code, article=article, status="not_applicable", message="No cargo.")
    worst_stack = min(stacks, key=lambda s: s.ratio(direction))
    ratio = worst_stack.ratio(direction)
    hold = worst_stack.hold[direction]
    values: dict[str, float] = {
        "acceleration_g": ACCELERATION[direction],
        "mass_kg": round(worst_stack.mass_kg, 1),
        "friction": round(
            0.0 if direction in _rolls(worst_stack.units[0]) else worst_stack.friction, 3
        ),
        "held_kg": round(min(worst_stack.held_kg(direction), 999_999.0), 1),
        "lashing_kg": round(min(hold.lashing_kg, 999_999.0), 1),
        "wall_kg": round(min(hold.wall_kg, 999_999.0), 1),
        "ratio": round(min(ratio, 99.0), 3),
        "friction_alone": float(hold.friction_alone),
        "blocked": float(hold.blocked),
    }
    failing = [
        s for s in stacks if s.ratio(direction) < 1 - 1e-9 and not s.hold[direction].wall_unknown
    ]
    if failing:
        graded = [(s, *_classify(scenario, s, direction)) for s in failing]
        deficiency = worst(g[1] for g in graded)
        cited = next(g[2] for g in graded if g[1] == deficiency)
        values["stacks"] = float(len(failing))
        return RuleCheck(
            code=code,
            article=cited,
            status="fail",
            unit_ids=[uid for s in failing for uid in s.ids],
            values=values,
            deficiency=deficiency,
            message=(
                f"Not held {direction} at {ACCELERATION[direction]} g: the securing holds "
                f"{min(ratio, 99.0):.0%} of the cargo."
            ),
        )
    leaning = [
        s for s in stacks if s.hold[direction].wall_unknown and s.ratio(direction) < 1 - 1e-9
    ]
    if leaning:
        return RuleCheck(
            code=code,
            article="EN 12642; " + article,
            status="to_confirm",
            unit_ids=[uid for s in leaning for uid in s.ids],
            values=values,
            message="Held only if the headboard is rated for it: confirm its EN 12642 code.",
        )
    return RuleCheck(
        code=code,
        article=article,
        status="pass",
        values=values,
        message=f"Held {direction} at {ACCELERATION[direction]} g.",
    )


def _required_tilting_lashings(
    stack: _Stack, direction: Direction, base: float, height: float, sine: float, tension: float
) -> float:
    c = TIPPING_ACCELERATION[direction]
    moment = (c * height / base - EN_CZ) * stack.mass_kg * _G
    if moment <= 0:
        return 0.0
    if tension <= 0 or sine <= 0:
        return math.inf
    return moment * SAFETY_FACTOR[direction] / (2 * sine * tension)


def _direct_tipping_n(scenario: Scenario, stack: _Stack, direction: Direction) -> float:
    """Restoring moment of the direct lashings about the tipping edge [N m], at half their LC.

    A lashing at point p pulling along u restores ``F (-u_z) (edge - p) + F (-u_h) p_z`` about the
    bottom edge the stack would tip over (EN 12195-1 tilting, with 0.5 LC as for 0.6 g sideways).
    """
    base = stack.units[0]
    anchors = _anchors(scenario)
    axis, signs = (
        (1, (1.0, -1.0))
        if direction == "sideways"
        else (0, (1.0,) if direction == "forward" else (-1.0,))
    )
    moments = []
    for sign in signs:
        edge = base.position_m[axis] + sign * base.size_m[axis] / 2
        total = 0.0
        for lashing in _lashings_of(scenario, stack.units):
            if lashing.routing is not LashingRouting.DIRECT or lashing.attachment_point_m is None:
                continue
            unit = next(u for u in stack.units if u.id == lashing.unit_id)
            point = [unit.position_m[k] + lashing.attachment_point_m[k] for k in range(3)]
            anchor = anchors[lashing.anchor_ids[0]].position_m
            pull = [anchor[k] - point[k] for k in range(3)]
            span = math.hypot(*pull)
            u = [c / span for c in pull]
            lever = sign * (edge - point[axis])
            moment = (-u[2]) * lever + (-sign * u[axis]) * (point[2] - base.position_m[2])
            total += 0.5 * lashing.lashing_capacity_n * max(moment, 0.0)
        moments.append(total)
    return min(moments)


def tipping(scenario: Scenario, stacks: list[_Stack]) -> RuleCheck:
    """Annex III I.1: securing "must prevent tilting or tipping"; EN 12195-1 eq. 3 and eq. 16."""
    article = "Directive 2014/47/EU Annex III I.1; EN 12195-1"
    bed = scenario.bed
    units = {u.id: u for u in scenario.units}
    failing: list[tuple[_Stack, Direction]] = []
    unstable = 0
    for stack in stacks:
        base = stack.units[0]
        if base.position_m[2] > 0:
            continue
        height = _top(stack.units)
        length, width = base.size_m[0], base.size_m[1]
        if base.shape is UnitShape.CYLINDER and base.axis is not CylinderAxis.Z:
            continue  # rolling, assessed as sliding with no friction
        for direction in DIRECTIONS:
            b = width if direction == "sideways" else length
            if b / height > TIPPING_ACCELERATION[direction] / EN_CZ + 1e-9:
                continue  # stable: b/2 > (c / cz) h/2
            unstable += 1
            hold = stack.hold[direction]
            if hold.blocked:
                continue
            # A wall in contact at least as high as the centre of gravity stops it tipping.
            if "wall" in hold.methods and (hold.wall_kg > 0 or hold.wall_unknown):
                wall_h = (
                    bed.headboard.height_m
                    if direction == "forward" and bed.headboard
                    else (
                        bed.rear_wall_height_m
                        if direction == "rearward"
                        else bed.side_rail_height_m
                    )
                )
                if wall_h >= height / 2:
                    continue
            top_over = [
                x
                for x in _lashings_of(scenario, stack.units)
                if x.routing is LashingRouting.TOP_OVER
            ]
            if top_over:
                sine = min(_top_over_sine(scenario, units[x.unit_id], x) for x in top_over)
                tension = min(x.pretension_n for x in top_over)
                needed = _required_tilting_lashings(stack, direction, b, height, sine, tension)
                if len(top_over) >= needed - 1e-9:
                    continue
            demand = (
                stack.mass_kg * _G * (TIPPING_ACCELERATION[direction] * height / 2 - EN_CZ * b / 2)
            )
            if _direct_tipping_n(scenario, stack, direction) >= demand - 1e-6:
                continue
            failing.append((stack, direction))
    if not unstable:
        return RuleCheck(
            code="eu_tipping",
            article=article,
            status="not_applicable",
            message="Every unit is stable on its own (EN 12195-1 eq. 3).",
        )
    if failing:
        # Overturning inside closed walls is "major"; towards an open side cargo can fall off.
        deficiency = worst("major" if _closed(scenario, d) else "dangerous" for _, d in failing)
        return RuleCheck(
            code="eu_tipping",
            article=article,
            status="fail",
            unit_ids=sorted({uid for s, _ in failing for uid in s.ids}),
            values={"directions": float(len({d for _, d in failing}))},
            deficiency=deficiency,
            message="A unit that can tip over is not held against tipping.",
        )
    return RuleCheck(
        code="eu_tipping",
        article=article,
        status="pass",
        message="Units that could tip are held by lashings or walls.",
    )


def body_strength(scenario: Scenario, draft: LoadDraft | None, stacks: list[_Stack]) -> RuleCheck:
    """Annex III I.3 and EN 12642: what the body's walls are rated for, and whether that is used."""
    bed = scenario.bed
    code, assumed = body_code(draft)
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    article = "Directive 2014/47/EU Annex III I.3; EN 12642"
    values: dict[str, float] = {"xl": float(code is BodyCode.XL), "assumed": float(assumed)}
    if bed.headboard and bed.headboard.rated_capacity_n:
        values["front_dan"] = round(bed.headboard.rated_capacity_n / 10)
    if payload and bed.body is not BodyType.FLATBED:
        values["side_dan"] = round(SIDE_WALL_SHARE.get((bed.body, code), 0.0) * payload * _G / 10)
        rear = REAR_WALL_SHARE[code] * payload * _G
        values["rear_dan"] = round(
            (min(rear, REAR_WALL_L_MAX_N) if code is BodyCode.L else rear) / 10
        )
    if bed.body is BodyType.FLATBED and (draft is None or draft.truck.body_code is None):
        return RuleCheck(
            code="eu_body_strength",
            article=article,
            status="not_applicable",
            values=values,
            message="A flatbed's headboard has no EN 12642 code given.",
        )
    curtain_l = bed.body is BodyType.CURTAIN_SIDER and code is BodyCode.L
    if curtain_l:
        relying = [s for s in stacks if s.ratio("sideways") < 1 - 1e-9]
        if relying:
            return RuleCheck(
                code="eu_body_strength",
                article=article + "; Annex III Table 1 item 20.1.2.4",
                status="fail",
                unit_ids=[uid for s in relying for uid in s.ids],
                values=values,
                deficiency="dangerous",
                message="A code L curtain is weather protection only: it holds no cargo.",
            )
    leaning = any(
        h.methods & {"wall"} and not h.friction_alone for s in stacks for h in s.hold.values()
    )
    if assumed and leaning and bed.body is not BodyType.FLATBED:
        return RuleCheck(
            code="eu_body_strength",
            article=article,
            status="to_confirm",
            values=values,
            message="The walls are taken as code L: check the code on the body's plate.",
        )
    return RuleCheck(
        code="eu_body_strength",
        article=article,
        status="pass",
        values=values,
        message="The walls the load leans on are counted at their EN 12642 rating.",
    )


def headboard_height(scenario: Scenario, stacks: list[_Stack], headboard_known: bool) -> RuleCheck:
    """Table 1 item 10.1.2: a front wall used for securing, too low for the cargo (dangerous)."""
    article = "Directive 2014/47/EU Annex III, Table 1 item 10.1.2"
    bed = scenario.bed
    headboard = bed.headboard
    relying = [
        s
        for s in stacks
        if "wall" in s.hold["forward"].methods
        and s.hold["forward"].lashing_kg < s.mass_kg
        and not s.hold["forward"].friction_alone
        and not s.hold["forward"].blocked
    ]
    if headboard is None or bed.body is not BodyType.FLATBED or not relying:
        return RuleCheck(
            code="eu_headboard_height",
            article=article,
            status="not_applicable",
            message="No cargo leans on a flatbed's headboard.",
        )
    top = max(_top(s.units) for s in relying)
    values = {"height_m": round(headboard.height_m, 3), "load_top_m": round(top, 3)}
    if not headboard_known:
        return RuleCheck(
            code="eu_headboard_height",
            article=article,
            status="to_confirm",
            unit_ids=[uid for s in relying for uid in s.ids],
            values=values,
            message="Confirm the headboard's height: the cargo leans on it.",
        )
    taller = [s for s in relying if _top(s.units) > headboard.height_m + 0.01]
    if taller:
        return RuleCheck(
            code="eu_headboard_height",
            article=article,
            status="fail",
            unit_ids=[uid for s in taller for uid in s.ids],
            values=values,
            deficiency="dangerous",
            message="Cargo leaning on the headboard stands taller than it.",
        )
    return RuleCheck(
        code="eu_headboard_height",
        article=article,
        status="pass",
        values=values,
        message="The headboard is as tall as the cargo leaning on it.",
    )


def devices(scenario: Scenario) -> RuleCheck:
    """Annex III I.5: lashings to EN 12195-2 (webbing), -3 (chains), -4 (wire ropes)."""
    article = "Directive 2014/47/EU Annex III I.5; EN 12195-2/-3/-4"
    if not scenario.lashings:
        return RuleCheck(
            code="eu_devices", article=article, status="not_applicable", message="No lashings."
        )
    values: dict[str, float] = {}
    for kind, prefix in ((LashingKind.STRAP, "strap"), (LashingKind.CHAIN, "chain")):
        found = [x for x in scenario.lashings if x.kind is kind]
        if found:
            values[f"{prefix}_lc_dan"] = round(min(x.lashing_capacity_n for x in found) / 10)
            values[f"{prefix}_stf_dan"] = round(min(x.pretension_n for x in found) / 10)
    ropes = sorted({x.unit_id for x in scenario.lashings if x.kind is LashingKind.ROPE})
    if ropes:
        return RuleCheck(
            code="eu_devices",
            article="Directive 2014/47/EU Annex III, Table 1 item 20.3.1",
            status="fail",
            unit_ids=ropes,
            values=values,
            deficiency="major",
            message="A fibre rope is not a lashing to EN 12195: an unsuitable device.",
        )
    return RuleCheck(
        code="eu_devices",
        article=article,
        status="pass",
        values=values,
        message="Rated web lashings or chains, marked with their LC and STF.",
    )


def lashing_points(scenario: Scenario, stacks: list[_Stack], anchored_on_wood: bool) -> RuleCheck:
    """Annex III I.3 and EN 12640: lashing points strong enough for the forces of the lashings."""
    article = "Directive 2014/47/EU Annex III I.3; EN 12640"
    point = lashing_point_strength_n(_vehicle_mass_kg(scenario))
    values = {"point_dan": round(point / 10), "vehicle_kg": round(_vehicle_mass_kg(scenario))}
    if not scenario.lashings:
        return RuleCheck(
            code="eu_lashing_points",
            article=article,
            status="not_applicable",
            values=values,
            message="No lashings.",
        )
    if anchored_on_wood:
        return RuleCheck(
            code="eu_lashing_points",
            article="Directive 2014/47/EU Annex III, Table 1 item 10.5.1",
            status="fail",
            values=values,
            deficiency="major",
            message="Lashings are fixed to the wooden floor or rails, not to lashing points.",
        )
    weak: list[tuple[_Stack, float]] = []
    for stack in stacks:
        for direction in DIRECTIONS:
            if stack.ratio(direction) < 1 - 1e-9 <= stack.ratio(direction, lc=True) - 2e-9:
                weak.append((stack, stack.ratio(direction)))
    if weak:
        lowest = min(r for _, r in weak)
        return RuleCheck(
            code="eu_lashing_points",
            article="Directive 2014/47/EU Annex III, Table 1 item 10.5.1",
            status="fail",
            unit_ids=sorted({uid for s, _ in weak for uid in s.ids}),
            values={**values, "ratio": round(lowest, 3)},
            deficiency="major" if lowest >= TWO_THIRDS else "dangerous",
            message="The lashing points, not the lashings, limit what the lashings can hold.",
        )
    return RuleCheck(
        code="eu_lashing_points",
        article=article,
        status="pass",
        values=values,
        message="The lashing points hold what the lashings pull.",
    )


def check_annex3(
    scenario: Scenario,
    draft: LoadDraft | None = None,
    *,
    anchored_on_wood: bool = False,
    headboard_known: bool = True,
) -> list[RuleCheck]:
    """The EU securing checks: the three directions, tipping, the body, the devices, the points."""
    stacks = _assess(scenario, draft)
    return [
        *(_direction_check(scenario, stacks, d) for d in DIRECTIONS),
        tipping(scenario, stacks),
        body_strength(scenario, draft, stacks),
        headboard_height(scenario, stacks, headboard_known),
        devices(scenario),
        lashing_points(scenario, stacks, anchored_on_wood),
    ]


def roadside_class(checks: list[RuleCheck]) -> Deficiency | None:
    """Annex III II.1: the transport takes the highest class of its deficiencies."""
    return worst(c.deficiency for c in checks if c.status == "fail")
