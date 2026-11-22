"""The lashing rules of CONTRAN Resolution 945/2022, as explicit checks on a scenario.

Resolution 945/2022 (DOU 2022-04-01) is the Brazilian rule for securing cargo on trucks. Each
check below carries the article it comes from, a stable ``code`` the UI translates, and an
English message. The articles and their wording are summarised, with the official links, in the
workspace's ``notes/physics-sources.md`` (section 4).

Interpretations (the text gives no number for these; documented in ``docs/physics-model.md``):

* Art. 4, safety factor: "2 times the cargo weight on the nominal working capacity of the
  lashing set, in the longitudinal direction". The sum of the lashing capacities (LC) of the
  straps and chains over a unit (or a stack) must be at least twice its weight. A unit held
  longitudinally by blocking, a cradle or the front wall of a box body is not assessed.
* Art. 7, "cargo that does not fill the body length": a load with room to travel along the
  truck, meaning a gap of more than ``GAP_TOLERANCE_M`` between the headboard and the first
  unit, or between units in a row. Such a load needs diagonal devices (direct lashings or
  chains) or blocking.
* Art. 7, sole paragraph: vehicles whose front and rear panels are not containment devices, and
  vehicles without panels, need diagonal devices too, gap or no gap. Every open body of the model
  is a flatbed with an unrated headboard and no rear panel (the rails of an open body and the rack
  of a tall-rack body are not rated restraints), so on a flatbed every unit needs diagonal devices
  or blocking (approved by the owner on 2026-11-21, rules audit item 1).
* Art. 5: each unit on an open body (one machine or one coil too) needs 4 lashing terminals; the
  text exempts neither a single unit nor a blocked one (rules audit item 2).
* Art. 8 caput: a front panel used as a stop must be strong enough. The text gives no figure; when
  cargo leans on a flatbed's headboard, its rating is asked ("to confirm") unless the body's
  EN 12642 code gives one, which is then compared with the EN 12195-1 forward demand
  ``(0.8 - mu) m g`` (our engineering choice, the same values as the simulation).
* Art. 8 sole paragraph: on a flatbed, a unit standing taller than the headboard that could slide
  forward (not held by diagonal devices or blocking) is not allowed to travel.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.scenario import BodyType, CargoUnit, Lashing, LashingKind, LashingRouting, Scenario
from physics.constants import EN_CX_FORWARD, EN_CZ, STANDARD_GRAVITY_MPS2
from physics.friction import resolve_friction

# Room to travel above which a load "does not fill the body length" [m].
GAP_TOLERANCE_M = 0.15
SAFETY_FACTOR = 2.0
MIN_TERMINALS = 4

# "to_confirm": the check depends on a measurement nobody gave (the headboard height); it is
# never reported as a violation on an assumed value.
CheckStatus = Literal["pass", "fail", "not_applicable", "to_confirm"]


class ContranCheck(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: Literal[
        "devices_allowed",
        "safety_factor",
        "four_terminals",
        "anchoring",
        "diagonals_for_gaps",
        "diagonals_open_body",
        "headboard_strength",
        "above_headboard",
    ]
    article: str
    status: CheckStatus
    unit_ids: list[str] = []
    values: dict[str, float] = Field(default_factory=dict)
    message: str


def check_contran_945(
    scenario: Scenario, *, anchored_on_wood: bool = False, headboard_known: bool = True
) -> list[ContranCheck]:
    """The eight checks, in the order of the articles.

    ``anchored_on_wood``: seen on a photo. ``headboard_known``: False when the headboard height
    is the body's usual one and nobody confirmed it; art. 8 then asks for it instead of failing.
    """
    return [
        _devices_allowed(scenario),
        _safety_factor(scenario),
        _four_terminals(scenario),
        _anchoring(scenario, anchored_on_wood),
        _diagonals_for_gaps(scenario),
        _diagonals_open_body(scenario),
        _headboard_strength(scenario),
        _above_headboard(scenario, headboard_known),
    ]


def _stacks(scenario: Scenario) -> list[list[CargoUnit]]:
    """Units grouped by footprint: a unit on the floor and whatever stands on it."""
    stacks: dict[tuple[float, float], list[CargoUnit]] = {}
    for unit in sorted(scenario.units, key=lambda u: u.position_m[2]):
        key = (round(unit.position_m[0], 3), round(unit.position_m[1], 3))
        stacks.setdefault(key, []).append(unit)
    return list(stacks.values())


def _lashings_of(scenario: Scenario, stack: list[CargoUnit]) -> list[Lashing]:
    ids = {unit.id for unit in stack}
    return [lashing for lashing in scenario.lashings if lashing.unit_id in ids]


def _held_by_contact(scenario: Scenario, stack: list[CargoUnit]) -> bool:
    """Blocks around the stack, or the walls of a box body: held without lashing."""
    return scenario.bed.body is BodyType.BOX or _blocked(scenario, stack)


def _blocked(scenario: Scenario, stack: list[CargoUnit]) -> bool:
    """Blocks (beams, chocks, a cradle) right in front of or behind the stack."""
    base = stack[0]
    for block in scenario.bed.blocks:
        dx = abs(block.position_m[0] - base.position_m[0])
        dy = abs(block.position_m[1] - base.position_m[1])
        if (
            dx <= base.size_m[0] / 2 + block.size_m[0] + 0.3
            and dy <= (base.size_m[1] + block.size_m[1]) / 2
        ):
            return True
    return False


def _diagonal(scenario: Scenario, stack: list[CargoUnit]) -> bool:
    return any(
        lashing.routing is LashingRouting.DIRECT and lashing.kind is not LashingKind.ROPE
        for lashing in _lashings_of(scenario, stack)
    )


def _devices_allowed(scenario: Scenario) -> ContranCheck:
    ropes = sorted({x.unit_id for x in scenario.lashings if x.kind is LashingKind.ROPE})
    if ropes:
        return ContranCheck(
            code="devices_allowed",
            article="Art. 4 §3",
            status="fail",
            unit_ids=ropes,
            message="Ropes are prohibited as cargo lashing; use straps or chains.",
        )
    return ContranCheck(
        code="devices_allowed",
        article="Art. 4",
        status="pass",
        message="Only straps, chains, blocking or mats secure the load.",
    )


def _safety_factor(scenario: Scenario) -> ContranCheck:
    failing: list[str] = []
    assessed = 0
    for stack in _stacks(scenario):
        # Blocks or the body's front wall hold the load longitudinally, which is the direction
        # the article's factor is about; lashings are then supplementary.
        if _held_by_contact(scenario, stack):
            continue
        rated = [
            lashing
            for lashing in _lashings_of(scenario, stack)
            if lashing.kind is not LashingKind.ROPE
        ]
        assessed += 1
        weight_n = sum(unit.mass_kg for unit in stack) * STANDARD_GRAVITY_MPS2
        capacity_n = sum(lashing.lashing_capacity_n for lashing in rated)
        if capacity_n < SAFETY_FACTOR * weight_n:
            failing += [unit.id for unit in stack]
    if not assessed:
        return ContranCheck(
            code="safety_factor",
            article="Art. 4",
            status="not_applicable",
            message="The load is held by blocking or the body's walls, not by lashings.",
        )
    if failing:
        return ContranCheck(
            code="safety_factor",
            article="Art. 4",
            status="fail",
            unit_ids=failing,
            message="The lashings' working capacity is less than twice the weight they hold.",
        )
    return ContranCheck(
        code="safety_factor",
        article="Art. 4",
        status="pass",
        message="Every lashed unit has lashings rated for at least twice its weight.",
    )


def _terminals(lashings: list[Lashing]) -> int:
    """A top-over lashing ends in two terminals, a direct one in one."""
    return sum(2 if x.routing is LashingRouting.TOP_OVER else 1 for x in lashings)


def _four_terminals(scenario: Scenario) -> ContranCheck:
    """Art. 5: every unit on an open body, a single one too, and blocking does not exempt it."""
    if scenario.bed.body is BodyType.BOX:
        return ContranCheck(
            code="four_terminals",
            article="Art. 5",
            status="not_applicable",
            message="Applies to cargo on an open body or a platform.",
        )
    failing = [
        unit.id
        for stack in _stacks(scenario)
        if _terminals([x for x in _lashings_of(scenario, stack) if x.kind is not LashingKind.ROPE])
        < MIN_TERMINALS
        for unit in stack
    ]
    if failing:
        return ContranCheck(
            code="four_terminals",
            article="Art. 5",
            status="fail",
            unit_ids=failing,
            message="Each unit needs at least 4 lashing terminals hooked to the truck.",
        )
    return ContranCheck(
        code="four_terminals",
        article="Art. 5",
        status="pass",
        message="Each unit is secured with at least 4 lashing terminals.",
    )


def _anchoring(scenario: Scenario, anchored_on_wood: bool) -> ContranCheck:
    if anchored_on_wood:
        return ContranCheck(
            code="anchoring",
            article="Art. 6",
            status="fail",
            message=(
                "Lashings are fixed to the wooden floor or rails; anchor them to the metal frame."
            ),
        )
    if not scenario.lashings:
        return ContranCheck(
            code="anchoring",
            article="Art. 6",
            status="not_applicable",
            message="No lashings.",
        )
    return ContranCheck(
        code="anchoring",
        article="Art. 6",
        status="pass",
        message="Lashings are anchored to the truck's lashing points on the metal frame.",
    )


def _diagonals_for_gaps(scenario: Scenario) -> ContranCheck:
    half = scenario.bed.length_m / 2
    loose: list[str] = []
    for stack in _stacks(scenario):
        base = stack[0]
        front = base.position_m[0] + base.size_m[0] / 2
        # The nearest thing in front of the unit: the headboard or another unit in its lane.
        ahead = half
        for other in scenario.units:
            if other is base or other.position_m[2] > 0:
                continue
            lane = (
                abs(other.position_m[1] - base.position_m[1])
                < (other.size_m[1] + base.size_m[1]) / 2 - 0.01
            )
            back = other.position_m[0] - other.size_m[0] / 2
            if lane and back >= front - 0.01:
                ahead = min(ahead, back)
        # Walls of a box body do not count: a load with room to travel slams into them.
        if ahead - front > GAP_TOLERANCE_M and not (
            _diagonal(scenario, stack) or _blocked(scenario, stack)
        ):
            loose += [unit.id for unit in stack]
    if loose:
        return ContranCheck(
            code="diagonals_for_gaps",
            article="Art. 7",
            status="fail",
            unit_ids=loose,
            message=(
                "The load does not fill the body length: close the gaps or add diagonal "
                "lashings against forward and backward movement."
            ),
        )
    return ContranCheck(
        code="diagonals_for_gaps",
        article="Art. 7",
        status="pass",
        message="No room to travel along the truck, or diagonal devices hold the load.",
    )


def _diagonals_open_body(scenario: Scenario) -> ContranCheck:
    """Art. 7 sole paragraph: no containment panels, so diagonals (or blocking) on every unit."""
    if scenario.bed.body is not BodyType.FLATBED:
        return ContranCheck(
            code="diagonals_open_body",
            article="Art. 7 sole paragraph",
            status="not_applicable",
            message="The body's front and rear walls contain the load.",
        )
    loose = [
        unit.id
        for stack in _stacks(scenario)
        if not (_diagonal(scenario, stack) or _row_blocked(scenario, stack))
        for unit in stack
    ]
    if loose:
        return ContranCheck(
            code="diagonals_open_body",
            article="Art. 7 sole paragraph",
            status="fail",
            unit_ids=loose,
            message=(
                "This body has no containment panels: every unit needs diagonal lashings "
                "against forward and backward movement, even with no gap."
            ),
        )
    return ContranCheck(
        code="diagonals_open_body",
        article="Art. 7 sole paragraph",
        status="pass",
        message="Diagonal devices or blocking hold every unit forward and backward.",
    )


def _row_blocked(scenario: Scenario, stack: list[CargoUnit]) -> bool:
    """Blocked itself, or part of a row of touching units with blocks at its ends."""
    floor = [s for s in _stacks(scenario) if s[0].position_m[2] == 0]
    if stack[0].position_m[2] > 0 or stack not in floor:
        return _blocked(scenario, stack)
    row, frontier = [stack], [stack]
    while frontier:
        current = frontier.pop()[0]
        for other in floor:
            if any(other is r for r in row):
                continue
            b = other[0]
            lane = (
                abs(b.position_m[1] - current.position_m[1])
                < (b.size_m[1] + current.size_m[1]) / 2 - 0.01
            )
            gap = (
                abs(b.position_m[0] - current.position_m[0]) - (b.size_m[0] + current.size_m[0]) / 2
            )
            if lane and gap <= GAP_TOLERANCE_M:
                row.append(other)
                frontier.append(other)
    return any(_blocked(scenario, s) for s in row)


def _leaning_on_headboard(scenario: Scenario) -> list[list[CargoUnit]]:
    """Stacks that use the headboard as a stop: touching it, or touching a stack that does,
    and not held forward by diagonal devices or blocking."""
    half = scenario.bed.length_m / 2
    stacks = [s for s in _stacks(scenario) if s[0].position_m[2] == 0]
    fronts = {id(s[0]): s[0].position_m[0] + s[0].size_m[0] / 2 for s in stacks}
    leaning: list[list[CargoUnit]] = []
    for stack in sorted(stacks, key=lambda s: -fronts[id(s[0])]):
        base = stack[0]
        if _diagonal(scenario, stack) or _blocked(scenario, stack):
            continue
        front = fronts[id(base)]
        if half - front <= GAP_TOLERANCE_M:
            leaning.append(stack)
            continue
        for other in leaning:
            lane = (
                abs(other[0].position_m[1] - base.position_m[1])
                < (other[0].size_m[1] + base.size_m[1]) / 2 - 0.01
            )
            back = other[0].position_m[0] - other[0].size_m[0] / 2
            if lane and 0 <= back - front <= GAP_TOLERANCE_M:
                leaning.append(stack)
                break
    return leaning


def _headboard_strength(scenario: Scenario) -> ContranCheck:
    """Art. 8 caput: a front panel used as a stop must be strong enough (no figure given)."""
    headboard = scenario.bed.headboard
    leaning = _leaning_on_headboard(scenario) if headboard is not None else []
    if scenario.bed.body is not BodyType.FLATBED or headboard is None or not leaning:
        return ContranCheck(
            code="headboard_strength",
            article="Art. 8",
            status="not_applicable",
            message="No cargo uses an open body's headboard as a stop.",
        )
    demand = 0.0
    for stack in leaning:
        base = stack[0]
        mu = resolve_friction(
            base.material, scenario.bed.floor_material, override=base.friction_coefficient
        ).coefficient
        mass = sum(u.mass_kg for u in stack)
        demand += max(0.0, EN_CX_FORWARD - mu * EN_CZ) * mass * STANDARD_GRAVITY_MPS2
    ids = [u.id for stack in leaning for u in stack]
    values = {"demand_n": round(demand, 1)}
    if headboard.rated_capacity_n is None:
        return ContranCheck(
            code="headboard_strength",
            article="Art. 8",
            status="to_confirm",
            unit_ids=ids,
            values=values,
            message=(
                f"The headboard is the stop of the cargo against it: confirm it holds "
                f"{demand / 1000:.1f} kN forward."
            ),
        )
    values["rated_n"] = headboard.rated_capacity_n
    if demand > headboard.rated_capacity_n:
        return ContranCheck(
            code="headboard_strength",
            article="Art. 8",
            status="fail",
            unit_ids=ids,
            values=values,
            message="The headboard is not strong enough for the cargo against it.",
        )
    return ContranCheck(
        code="headboard_strength",
        article="Art. 8",
        status="pass",
        unit_ids=ids,
        values=values,
        message="The headboard is strong enough for the cargo against it.",
    )


def _above_headboard(scenario: Scenario, known: bool = True) -> ContranCheck:
    headboard = scenario.bed.headboard
    if scenario.bed.body is not BodyType.FLATBED or headboard is None:
        return ContranCheck(
            code="above_headboard",
            article="Art. 8",
            status="not_applicable",
            message="The body's front wall is full height.",
        )
    tall = [
        unit.id
        for stack in _stacks(scenario)
        if max(u.position_m[2] + u.size_m[2] for u in stack) > headboard.height_m + 0.01
        and not (_diagonal(scenario, stack) or _held_by_contact(scenario, stack))
        for unit in stack
    ]
    if tall and not known:
        return ContranCheck(
            code="above_headboard",
            article="Art. 8",
            status="to_confirm",
            unit_ids=tall,
            message=(
                f"The load stands taller than a {headboard.height_m:.1f} m headboard; "
                "confirm the headboard height."
            ),
        )
    if tall:
        return ContranCheck(
            code="above_headboard",
            article="Art. 8",
            status="fail",
            unit_ids=tall,
            message="Cargo above the headboard could slide forward over it.",
        )
    return ContranCheck(
        code="above_headboard",
        article="Art. 8",
        status="pass",
        message="Nothing above the headboard can slide forward over it.",
    )
