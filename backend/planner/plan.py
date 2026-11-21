"""The planner: the smallest change to a load that passes the rules and the whole battery.

1. **Rules first.** Ropes become straps (CONTRAN 945 art. 4 §3); lashings tied to the wooden
   floor go to the metal frame (art. 6). These are never optional.
2. **Steps, in order of effort.** Move the units (forward against the headboard, or back to
   free an overloaded axle: then the move is mandatory too), add straps (the number EN 12195-1
   asks for), an anti-slip mat under them, diagonal lashings, chains; a coil gets a cradle and
   a box body blocking. Every candidate is a set of steps, and candidates are tried by their
   total effort, fewest steps first on a tie: "diagonals" is tried before "move + diagonals", so
   the two are combined only when neither is enough on its own.
3. **On paper first.** A candidate is simulated only if it meets EN 12195-1 and every CONTRAN
   check without simulating.
4. **Proof and minimality.** Candidates go through the battery (stopping at the first failure)
   in order; the first that passes is the plan. Then each optional step of the plan is dropped
   in turn and the rest re-checked; a step whose removal still passes is not needed. Because
   every subset of a plan costs less, it was tried earlier, so this mostly confirms the plan.
5. **Protection.** Edge protectors are advised under straps over fragile cargo; they change no
   physics and are added last, as advice.

Every change carries a stable code (translated by the UI), the article behind it when there
is one, and the numbers that explain it.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer import BuildError, build_draft
from app.explorer.build import CARGO, strap_room
from app.explorer.config import MAX_DIAGONAL_SETS, MAX_STRAPS_PER_UNIT, Cargo, Restraint
from app.explorer.draft import LoadDraft
from app.inspection.battery import (
    SITUATIONS,
    BatteryResult,
    Situation,
    SituationId,
    run_battery,
    run_situations,
)
from app.scenario import BodyType, CylinderAxis, Scenario, UnitShape
from app.storage import Storage
from rules.axle_loads import axle_loads
from rules.contran945 import check_contran_945
from rules.en12195 import check_scenario

# Simulated candidates at most; each costs up to one battery.
MAX_ROUNDS = 5
# Placement tolerance [m].
EPS = 1e-6
# A unit counts as tall when it is more than this times higher than its narrowest side.
TALL_RATIO = 1.6
# Spreading a stacked load: the search step along the bed and the gap left between units [m].
SPREAD_STEP_M = 0.05
SPREAD_GAP_M = 0.05

ChangeCode = Literal[
    "replace_rope",
    "reanchor",
    "close_gaps",
    "balance_axles",
    "straps",
    "restraint",
    "diagonal_sets",
    "spread",
    "overweight",
    "edge_protectors",
]

# Effort of each step (what it takes the driver), for ordering the candidates.
STEP_EFFORT: dict[str, int] = {
    "move": 1,
    "straps": 2,
    "cradle": 2,
    "blocking": 2,
    "mat": 3,
    "direct": 4,
    # Unloading the top of a stack and setting it down on the floor: heavier than re-lashing.
    "spread": 4,
    "chain": 5,
}
FRAGILE_CARGO = {Cargo.STACKED_BOXES, Cargo.SACKS, Cargo.PLASTIC_PALLET}

# Battery situations in the order the planner tries them: the ones most loads fail first, so a
# weak candidate is rejected after one or two runs.
_PROOF_ORDER: tuple[SituationId, ...] = (
    "long_vibration",
    "emergency_braking",
    "mountain_descent",
    "sharp_curve",
    "lane_change",
    "pothole",
    "speed_bump",
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Change(_Model):
    code: ChangeCode
    unit_id: str | None = None
    before: str | float | None = None
    after: str | float | None = None
    article: str | None = Field(default=None, description="Rule behind the change, if any.")
    values: dict[str, float] = Field(default_factory=dict)
    message: str


class Plan(_Model):
    draft: LoadDraft
    changes: list[Change]
    verified: bool = Field(description="True when the plan passed the whole battery.")
    rounds: int = Field(description="Candidates simulated.")
    battery: BatteryResult | None = None


class Recommendation(_Model):
    """The planner's analytic answer (no simulation): the load it would try first."""

    draft: LoadDraft
    changes: list[Change]


class BatteryResponse(BatteryResult):
    """The battery of an inspection, plus the fix the planner recommends when it fails."""

    recommendation: Recommendation | None


@dataclass
class _Candidate:
    name: str
    draft: LoadDraft
    changes: list[Change] = field(default_factory=list)
    steps: tuple[str, ...] = ()

    @property
    def effort(self) -> tuple[int, int]:
        return (sum(STEP_EFFORT.get(step, 1) for step in self.steps), len(self.steps))


# --- 1. Rules ----------------------------------------------------------------------------


def _rule_fixes(draft: LoadDraft) -> tuple[LoadDraft, list[Change]]:
    changes: list[Change] = []
    if draft.restraint is Restraint.ROPE:
        draft = draft.model_copy(update={"restraint": Restraint.TOP_OVER})
        changes.append(
            Change(
                code="replace_rope",
                before="rope",
                after="top_over",
                article="CONTRAN 945/2022 art. 4 §3",
                message="Ropes are prohibited as cargo lashing: replace them with ratchet straps.",
            )
        )
    if draft.anchored_on_wood:
        draft = draft.model_copy(update={"anchored_on_wood": False})
        changes.append(
            Change(
                code="reanchor",
                article="CONTRAN 945/2022 art. 6",
                message=(
                    "Hook the lashings to the lashing points on the metal frame, "
                    "not the wooden floor."
                ),
            )
        )
    return draft, changes


# --- 2. Placement ------------------------------------------------------------------------


def _with_positions(draft: LoadDraft, xs: dict[str, float]) -> LoadDraft:
    """Move floor units to new X; whatever stands on a unit moves with it."""
    base_of: dict[str, str] = {}
    for unit in draft.units:
        base_of[unit.id] = base_of.get(unit.on, unit.on) if unit.on else unit.id
    units = [
        unit.model_copy(update={"x_m": round(xs[base_of[unit.id]], 4) + 0.0})
        if base_of[unit.id] in xs
        else unit
        for unit in draft.units
    ]
    return draft.model_copy(update={"units": units})


def _close_gaps(draft: LoadDraft, scenario: Scenario) -> tuple[LoadDraft, float]:
    """Slide every floor unit forward against the headboard or the unit in front of it.

    Returns the new draft and the largest distance any unit moved [m].
    """
    floor = sorted(
        (u for u in scenario.units if u.position_m[2] == 0),
        key=lambda u: -(u.position_m[0] + u.size_m[0] / 2),
    )
    front_limit = scenario.bed.length_m / 2
    placed: list[tuple[float, float, float]] = []  # (back x, low y, high y)
    xs: dict[str, float] = {}
    moved = 0.0
    for unit in floor:
        low = unit.position_m[1] - unit.size_m[1] / 2
        high = unit.position_m[1] + unit.size_m[1] / 2
        stop = front_limit
        for back, other_low, other_high in placed:
            if other_low < high - 0.01 and low < other_high - 0.01:
                stop = min(stop, back)
        x = stop - unit.size_m[0] / 2
        x = max(x, unit.position_m[0])  # never move a unit backwards here
        xs[unit.id] = x
        moved = max(moved, x - unit.position_m[0])
        placed.append((x - unit.size_m[0] / 2, low, high))
    return _with_positions(draft, xs), moved


def _axle_shift(scenario: Scenario) -> float | None:
    """The smallest shift of the whole load [m, + forward] that keeps every axle group legal.

    0 when the axles are already within their limits, None when no shift on the bed works.
    """
    if scenario.vehicle is None:
        return 0.0
    loads = axle_loads(scenario)
    if all(load.load_kg <= load.limit_kg for load in loads):
        return 0.0
    front, rear = scenario.vehicle.axle_groups
    span = front.position_x_m - rear.position_x_m
    mass = sum(unit.mass_kg for unit in scenario.units)
    front_load, rear_load = loads[0].load_kg, loads[1].load_kg
    # Moving the load by d puts mass * d / span more on the front group and as much less on
    # the rear one: the front stays legal for d <= high, the rear for d >= low.
    low = (rear_load - loads[1].limit_kg) * span / mass
    high = (loads[0].limit_kg - front_load) * span / mass
    if low > high:
        return None
    half = scenario.bed.length_m / 2
    room_forward = min(half - (u.position_m[0] + u.size_m[0] / 2) for u in scenario.units)
    room_back = min((u.position_m[0] - u.size_m[0] / 2) + half for u in scenario.units)
    shift = low if low > 0 else high
    if shift > room_forward + EPS or -shift > room_back + EPS:
        return None
    # Round away from the limit to the editor's 5 cm grid.
    return math.ceil(shift * 20) / 20 if shift > 0 else math.floor(shift * 20) / 20


def _axles_legal(scenario: Scenario) -> bool:
    return all(load.load_kg <= load.limit_kg for load in axle_loads(scenario))


def _placement(draft: LoadDraft, scenario: Scenario) -> tuple[LoadDraft, list[Change]]:
    """Against the headboard if the axles allow it; else as far forward as they allow.

    Reported as one change, the net movement from where the load was.
    """
    original = {u.id: u.position_m[0] for u in scenario.units}
    placed, _ = _close_gaps(draft, scenario)
    placed_scenario, _ = build_draft(placed)
    limited_by_axles = False
    if not _axles_legal(placed_scenario):
        shift = _axle_shift(placed_scenario)
        if shift is not None:
            xs = {
                u.id: u.position_m[0] + shift for u in placed_scenario.units if u.position_m[2] == 0
            }
            try:
                candidate = _with_positions(placed, xs)
                candidate_scenario, _ = build_draft(candidate)
                placed, placed_scenario = candidate, candidate_scenario
                limited_by_axles = True
            except BuildError:
                placed, placed_scenario = draft, scenario
        else:
            placed, placed_scenario = draft, scenario
    moves = [u.position_m[0] - original[u.id] for u in placed_scenario.units]
    net = max(moves, key=abs, default=0.0)
    if abs(net) <= 0.05:
        return draft, []
    loads = axle_loads(scenario)
    over = max(loads, key=lambda load: load.ratio) if loads else None
    if net < 0 or (over is not None and over.load_kg > over.limit_kg):
        assert over is not None
        change = Change(
            code="balance_axles",
            article="CONTRAN 882/2021 art. 6",
            values={"shift_m": round(net, 2), "load_kg": over.load_kg, "limit_kg": over.limit_kg},
            message=(
                f"Move the load {abs(net) * 100:.0f} cm {'forward' if net > 0 else 'back'}: "
                f"axle group {over.axle_group_id} carried {over.load_kg / 1000:.2f} t, "
                f"over its {over.limit_kg / 1000:.1f} t limit."
            ),
        )
    else:
        change = Change(
            code="close_gaps",
            article="CONTRAN 945/2022 art. 7",
            values={"moved_m": round(net, 2), "limited_by_axles": float(limited_by_axles)},
            message=(
                f"Push the load {net * 100:.0f} cm forward"
                + (
                    ", as far as the axle limits allow."
                    if limited_by_axles
                    else " against the headboard: with no room to travel, it stops the load."
                )
            ),
        )
    return placed, [change]


def _spread(draft: LoadDraft) -> tuple[LoadDraft, list[Change]] | None:
    """Unstack the load: every unit standing on another goes down on the floor, as far forward as
    there is room (in its stack's lane first, then anywhere across the bed).

    Lower cargo tips less and is no longer above the headboard (CONTRAN 945/2022 art. 8). None
    when nothing is stacked or the floor has no room for every unit.
    """
    stacked = [unit for unit in draft.units if unit.on is not None]
    if not stacked:
        return None
    try:
        scenario, _ = build_draft(draft)
    except BuildError:
        return None
    size = {unit.id: unit.size_m for unit in scenario.units}
    half_length, half_width = scenario.bed.length_m / 2, scenario.bed.width_m / 2
    gap = SPREAD_GAP_M
    placed = [
        (unit.x_m, unit.y_m, size[unit.id][0], size[unit.id][1])
        for unit in draft.units
        if unit.on is None
    ]

    def free(x: float, y: float, length: float, width: float) -> bool:
        if abs(x) + length / 2 > half_length + EPS or abs(y) + width / 2 > half_width + EPS:
            return False
        return all(
            abs(x - ox) >= (length + olength) / 2 + gap - EPS
            or abs(y - oy) >= (width + owidth) / 2 + gap - EPS
            for ox, oy, olength, owidth in placed
        )

    moved: dict[str, tuple[float, float]] = {}
    steps = int(scenario.bed.length_m / SPREAD_STEP_M) + 1
    for unit in stacked:
        length, width = size[unit.id][0], size[unit.id][1]
        lanes = [unit.y_m, 0.0, half_width - width / 2, -(half_width - width / 2)]
        spot = None
        for y in dict.fromkeys(round(lane, 2) for lane in lanes):
            for step in range(steps):
                x = round(half_length - length / 2 - step * SPREAD_STEP_M, 2)
                if x - length / 2 < -half_length - EPS:
                    break
                if free(x, y, length, width):
                    spot = (x, y)
                    break
            if spot:
                break
        if spot is None:
            return None
        moved[unit.id] = spot
        placed.append((spot[0], spot[1], length, width))
    units = [
        unit.model_copy(update={"on": None, "x_m": moved[unit.id][0], "y_m": moved[unit.id][1]})
        if unit.id in moved
        else unit
        for unit in draft.units
    ]
    spread = draft.model_copy(update={"units": units})
    try:
        build_draft(spread)
    except BuildError:
        return None
    change = Change(
        code="spread",
        values={"units": float(len(moved))},
        article="CONTRAN 945/2022 art. 8",
        message=(
            f"Unstack the load: set {len(moved)} unit{'s' if len(moved) != 1 else ''} down on the "
            "floor, forward where there is room. Lower cargo tips less and is not above the "
            "headboard."
        ),
    )
    return spread, [change]


# --- 3. Securing candidates ------------------------------------------------------------------


def _floor_ids(draft: LoadDraft) -> list[str]:
    return [u.id for u in draft.units if u.on is None]


def _lashed_ids(draft: LoadDraft) -> list[str]:
    """The unit of each stack that carries the straps: the top one."""
    top: dict[str, str] = {u.id: u.id for u in draft.units if u.on is None}
    base_of: dict[str, str] = {}
    for unit in draft.units:
        base = base_of.get(unit.on, unit.on) if unit.on else unit.id
        base_of[unit.id] = base
        top[base] = unit.id
    return list(top.values())


def _with_straps(draft: LoadDraft, straps: dict[str, int], restraint: Restraint) -> LoadDraft:
    units = [unit.model_copy(update={"straps": straps.get(unit.id, 0)}) for unit in draft.units]
    return draft.model_copy(update={"units": units, "restraint": restraint})


def _enough_diagonals(draft: LoadDraft) -> LoadDraft:
    """Add sets of diagonal lashings or chains to the units whose lashings, summed, are rated for
    less than twice their weight (CONTRAN 945/2022 art. 4), up to ``MAX_DIAGONAL_SETS`` each.

    Only for a load secured with diagonals or chains; a heavy unit gets as many sets as it takes.
    """
    if draft.restraint not in (Restraint.DIRECT, Restraint.CHAIN):
        return draft
    floor = set(_floor_ids(draft))
    base_of: dict[str, str] = {}
    for unit in draft.units:
        base_of[unit.id] = base_of.get(unit.on, unit.on) if unit.on else unit.id
    current = draft
    for _ in range(MAX_DIAGONAL_SETS):
        try:
            scenario, _ = build_draft(current)
        except BuildError:
            return current
        check = next(c for c in check_contran_945(scenario) if c.code == "safety_factor")
        if check.status != "fail":
            return current
        short = {base_of.get(uid, uid) for uid in check.unit_ids} & floor
        units = [
            unit.model_copy(update={"diagonal_sets": unit.diagonal_sets + 1})
            if unit.id in short and unit.diagonal_sets < MAX_DIAGONAL_SETS
            else unit
            for unit in current.units
        ]
        if units == list(current.units):
            return current  # every short unit already has the most sets that fit
        current = current.model_copy(update={"units": units})
    return current


def _room(draft: LoadDraft) -> dict[str, int]:
    scenario, _ = build_draft(_with_straps(draft, {}, Restraint.NONE))
    return {uid: min(strap_room(scenario, uid), MAX_STRAPS_PER_UNIT) for uid in _lashed_ids(draft)}


def _required_top_over(draft: LoadDraft, restraint: Restraint) -> dict[str, int] | None:
    """Straps per stack EN 12195-1 asks for (at least 2: CONTRAN art. 5).

    None when they do not fit over the units.
    """
    room = _room(draft)
    existing = {u.id: u.straps for u in draft.units}
    # Never fewer straps than were already there (the smallest change), and at least two.
    straps = {uid: min(max(2, existing.get(uid, 0)), room[uid]) for uid in room}
    for _ in range(MAX_STRAPS_PER_UNIT):
        trial = _with_straps(draft, straps, restraint)
        try:
            scenario, _ = build_draft(trial)
        except BuildError:
            return None
        short = False
        for check in check_scenario(scenario):
            if check.required_lashings is None or check.meets_standard:
                continue
            uid = check.unit_id
            if uid not in straps:
                continue
            wanted = min(max(check.required_lashings, straps[uid] + 1), MAX_STRAPS_PER_UNIT + 1)
            if wanted > room[uid]:
                return None
            straps[uid] = wanted
            short = True
        if not short:
            return straps
    return None


def _cargo_of(draft: LoadDraft) -> set[Cargo]:
    return {unit.cargo for unit in draft.units}


def _tall(draft: LoadDraft) -> bool:
    for unit in draft.units:
        length, width, height = unit.size_m or CARGO[unit.cargo].size_m
        if height > TALL_RATIO * min(length, width):
            return True
    return False


def _securing(draft: LoadDraft) -> list[_Candidate]:
    """Securing options on a placed load, each with the steps it takes (cheapest first)."""
    out: list[_Candidate] = []
    room = _room(draft)
    existing = {u.id: u.straps for u in draft.units}
    two = {uid: min(max(2, existing.get(uid, 0)), room[uid]) for uid in room}
    coil = Cargo.STEEL_COIL in _cargo_of(draft)
    scenario, _ = build_draft(draft)
    box = scenario.bed.body is BodyType.BOX
    rolling = any(
        u.shape is UnitShape.CYLINDER and u.axis is CylinderAxis.Y for u in scenario.units
    )
    if coil or rolling:
        # A cradle stops the roll; straps over the coil keep it from sliding sideways in it.
        out.append(
            _Candidate("cradle", _with_straps(draft, {}, Restraint.CRADLE), steps=("cradle",))
        )
        out.append(
            _Candidate(
                "cradle_straps",
                _with_straps(draft, two, Restraint.CRADLE),
                steps=("cradle", "straps"),
            )
        )
        out.append(
            _Candidate(
                "chain",
                _enough_diagonals(_with_straps(draft, {}, Restraint.CHAIN)),
                steps=("chain",),
            )
        )
        return out
    # The load as it is (after the rules): enough when only the placement was wrong.
    out.append(_Candidate("as_is", draft, steps=()))
    if box:
        out.append(
            _Candidate("blocking", _with_straps(draft, {}, Restraint.BLOCKING), steps=("blocking",))
        )
    for restraint, steps in ((Restraint.TOP_OVER, ("straps",)), (Restraint.MAT, ("straps", "mat"))):
        straps = _required_top_over(draft, restraint)
        if straps is None:
            continue
        added = any(straps.get(uid, 0) > existing.get(uid, 0) for uid in straps)
        if restraint is Restraint.TOP_OVER and not added and draft.restraint is restraint:
            continue  # the same as the load as it is
        out.append(
            _Candidate(
                restraint.value,
                _with_straps(draft, straps, restraint),
                steps=steps if added else tuple(s for s in steps if s != "straps"),
            )
        )
    # Diagonals hold by their strength, not by friction: they survive a dirty deck and loose
    # straps. Top-over straps stay on tall or stacked loads, which also tip.
    keep = (
        two
        if (_tall(draft) or any(u.on for u in draft.units))
        else {uid: n for uid, n in existing.items() if uid in room}
    )
    out.append(
        _Candidate(
            "direct",
            _enough_diagonals(_with_straps(draft, keep, Restraint.DIRECT)),
            steps=("direct",),
        )
    )
    out.append(
        _Candidate(
            "chain",
            _enough_diagonals(_with_straps(draft, keep, Restraint.CHAIN)),
            steps=("chain",),
        )
    )
    return out


def _candidates(draft: LoadDraft) -> list[_Candidate]:
    """Every candidate after the rule fixes, in order of effort (on the original ``draft``).

    Each securing option is tried on the load where it stands and, when the placement changes
    it, on the moved load. A move needed to bring an axle group within its limit is mandatory.
    """
    fixed, rule_changes = _rule_fixes(draft)
    scenario, _ = build_draft(fixed)
    moved, placement = _placement(fixed, scenario)
    mandatory_move = bool(placement) and placement[0].code == "balance_axles"
    bases: list[tuple[LoadDraft, list[Change], tuple[str, ...]]] = []
    if not mandatory_move:
        bases.append((fixed, [], ()))
    if placement:
        bases.append((moved, placement, ("move",) if not mandatory_move else ()))
    # A stacked load can also be spread over the floor (then pushed forward like any other).
    unstacked = _spread(fixed)
    if unstacked is not None:
        spread, spread_changes = unstacked
        spread_scenario, _ = build_draft(spread)
        spread_moved, spread_placement = _placement(spread, spread_scenario)
        bases.append((spread_moved, spread_changes + spread_placement, ("spread",)))
    out: list[_Candidate] = []
    seen: set[str] = set()
    for base, base_changes, base_steps in bases:
        for option in _securing(base):
            key = option.draft.model_dump_json()
            if key in seen:
                continue
            seen.add(key)
            steps = base_steps + option.steps
            if not steps and not rule_changes and not (mandatory_move and placement):
                continue  # nothing changed at all
            out.append(
                _Candidate(
                    "+".join(steps) or "rules",
                    option.draft,
                    rule_changes + base_changes + _securing_changes(base, option.draft),
                    steps=steps,
                )
            )
    out.sort(key=lambda c: c.effort)  # stable: the usual order on ties
    return out


def _edge_protectors(draft: LoadDraft) -> list[Change]:
    """Advice: protect the webbing and the cargo where straps cross fragile cargo."""
    fragile = [u.id for u in draft.units if u.cargo in FRAGILE_CARGO and u.straps > 0]
    if not fragile:
        return []
    return [
        Change(
            code="edge_protectors",
            values={"units": float(len(fragile))},
            article="EN 12195-1 (good practice)",
            message="Put edge protectors under the straps where they cross the cartons or sacks.",
        )
    ]


def _on_paper(candidate: _Candidate) -> bool:
    """EN 12195-1 (where it applies) and every CONTRAN 945 check, before any simulation."""
    try:
        scenario, _ = build_draft(candidate.draft)
    except BuildError:
        return False
    if any(c.status == "fail" for c in check_contran_945(scenario)):
        return False
    # In a box body the walls and the blocks hold unlashed cargo; EN 12195-1's friction check
    # of an "unsecured" unit does not apply there (the simulation decides).
    walls = scenario.bed.body is BodyType.BOX
    return all(
        check.meets_standard is not False or (walls and check.method == "unsecured")
        for check in check_scenario(scenario)
    )


def _securing_changes(before: LoadDraft, after: LoadDraft) -> list[Change]:
    changes: list[Change] = []
    if before.restraint != after.restraint:
        changes.append(
            Change(
                code="restraint",
                before=before.restraint.value,
                after=after.restraint.value,
                message=(
                    f"Secure the load with {after.restraint.value.replace('_', ' ')} "
                    f"instead of {before.restraint.value.replace('_', ' ')}."
                ),
            )
        )
    if after.restraint in (Restraint.DIRECT, Restraint.CHAIN):
        sets_before = {
            u.id: u.diagonal_sets if before.restraint in (Restraint.DIRECT, Restraint.CHAIN) else 0
            for u in before.units
        }
        device = "chains" if after.restraint is Restraint.CHAIN else "diagonal straps"
        for unit in after.units:
            if unit.diagonal_sets > 1 and unit.diagonal_sets != sets_before.get(unit.id, 0):
                changes.append(
                    Change(
                        code="diagonal_sets",
                        unit_id=unit.id,
                        before=float(4 * sets_before.get(unit.id, 0)),
                        after=float(4 * unit.diagonal_sets),
                        article="CONTRAN 945/2022 art. 4",
                        values={"chains": 1.0 if after.restraint is Restraint.CHAIN else 0.0},
                        message=(
                            f"{unit.id}: {4 * unit.diagonal_sets} {device}, so their working "
                            "capacity adds up to at least twice its weight."
                        ),
                    )
                )
    old = {u.id: u.straps for u in before.units}
    for unit in after.units:
        if old.get(unit.id, 0) != unit.straps:
            changes.append(
                Change(
                    code="straps",
                    unit_id=unit.id,
                    before=float(old.get(unit.id, 0)),
                    after=float(unit.straps),
                    article="EN 12195-1; CONTRAN 945/2022 art. 5",
                    message=f"{unit.id}: {old.get(unit.id, 0)} → {unit.straps} straps over it.",
                )
            )
    return changes


# --- 4. Proof --------------------------------------------------------------------------------


def _proof_order(original: BatteryResult | None = None) -> tuple[Situation, ...]:
    """What the load failed worst first (a weak candidate is rejected sooner), then the rest."""
    by_id = {s.id: s for s in SITUATIONS}
    order = list(_PROOF_ORDER)
    if original is not None:
        severity = {s.id: s.severity for s in original.situations}
        order.sort(key=lambda i: -severity.get(i, 0.0))  # stable: ties keep the usual order
    return tuple(by_id[i] for i in order)


def recommend(draft: LoadDraft) -> tuple[LoadDraft, list[Change]]:
    """The analytic recommendation, without simulating: the cheapest candidate on paper."""
    options = _candidates(draft)
    for candidate in options:
        if _on_paper(candidate):
            return candidate.draft, candidate.changes + _edge_protectors(candidate.draft)
    fixed, changes = _rule_fixes(draft)
    scenario, _ = build_draft(fixed)
    fixed, placement = _placement(fixed, scenario)
    return fixed, changes + placement


class Candidate(_Model):
    name: str
    draft: LoadDraft
    changes: list[Change]
    steps: list[str] = Field(default_factory=list, description="The optional steps it takes.")


class Candidates(_Model):
    """The planner's candidates in the order to prove them, for a proof run elsewhere.

    ``candidates`` are tried in order, at most ``MAX_ROUNDS``; ``subsets`` are the candidates
    with fewer steps than the first ones, for the minimality check after one passes.
    """

    candidates: list[Candidate]
    subsets: list[Candidate] = Field(default_factory=list)
    infeasible: Literal["overweight"] | None = None
    values: dict[str, float] = Field(default_factory=dict)


def overweight(draft: LoadDraft) -> tuple[float, float] | None:
    """(cargo mass, payload) when the cargo is heavier than the truck may carry, else None."""
    scenario, _ = build_draft(draft)
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    mass = sum(unit.mass_kg for unit in scenario.units)
    return (mass, payload) if payload is not None and mass > payload else None


def overweight_change(mass_kg: float, payload_kg: float) -> Change:
    return Change(
        code="overweight",
        values={"mass_kg": round(mass_kg), "payload_kg": round(payload_kg)},
        message=(
            f"The cargo weighs {mass_kg / 1000:.1f} t; this truck may carry "
            f"{payload_kg / 1000:.1f} t. Use a larger truck or split the load."
        ),
    )


def candidates(draft: LoadDraft) -> Candidates:
    """What `plan` would simulate, in order, without simulating: at most MAX_ROUNDS."""
    heavy = overweight(draft)
    if heavy:
        return Candidates(
            candidates=[],
            infeasible="overweight",
            values={"mass_kg": heavy[0], "payload_kg": heavy[1]},
        )
    order = proof_candidates(_candidates(draft))
    tried = order[:MAX_ROUNDS]
    keys = {c.draft.model_dump_json() for c in tried}
    subsets = [
        c
        for c in order[MAX_ROUNDS:]
        if c.draft.model_dump_json() not in keys and any(set(c.steps) < set(t.steps) for t in tried)
    ]

    def public(c: _Candidate) -> Candidate:
        return Candidate(
            name=c.name,
            draft=c.draft,
            changes=c.changes + _edge_protectors(c.draft),
            steps=list(c.steps),
        )

    return Candidates(candidates=[public(c) for c in tried], subsets=[public(c) for c in subsets])


def proof_candidates(options: list[_Candidate]) -> list[_Candidate]:
    """The order to prove candidates in.

    The ones that hold on paper, cheapest first. When none does (EN 12195-1 cannot be met by
    friction, say), the strongest first: they are the ones that may still hold in simulation,
    and the minimality check then drops what they do not need.
    """
    on_paper = [c for c in options if _on_paper(c)]
    if on_paper:
        return on_paper + [c for c in options if c not in on_paper]
    return list(reversed(options))


def _rules_ok(candidate: _Candidate) -> bool:
    """Every CONTRAN 945 check and every axle group within its limit (no simulation)."""
    try:
        scenario, _ = build_draft(candidate.draft)
    except BuildError:
        return False
    rules = check_contran_945(scenario, anchored_on_wood=candidate.draft.anchored_on_wood)
    return all(c.status != "fail" for c in rules) and _axles_legal(scenario)


def _holds(storage: Storage, draft: LoadDraft, order: tuple[Situation, ...]) -> bool:
    runs = run_situations(storage, draft, order, stop_at_first_failure=True)
    return len(runs) == len(SITUATIONS) and all(
        result.verdict.status != "fail" for _, result, _ in runs
    )


def plan(storage: Storage, draft: LoadDraft) -> Plan:
    """Find the smallest change that passes, and prove it through the whole battery."""
    original = run_battery(storage, draft)
    if original.verdict.state == "approved":
        return Plan(draft=draft, changes=[], verified=True, rounds=0, battery=original)

    heavy = overweight(draft)
    if heavy:
        # No securing makes a truck carry more than it may: say so instead of simulating.
        return Plan(
            draft=draft,
            changes=[overweight_change(*heavy)],
            verified=False,
            rounds=0,
            battery=original,
        )
    on_paper = proof_candidates(_candidates(draft))
    order = _proof_order(original)
    tried: dict[str, bool] = {}

    def holds(candidate: _Candidate) -> bool:
        """It holds in every situation, and breaks no rule (checked first, on paper)."""
        key = candidate.draft.model_dump_json()
        if key not in tried:
            tried[key] = _rules_ok(candidate) and _holds(storage, candidate.draft, order)
        return tried[key]

    rounds = 0
    winner: _Candidate | None = None
    physics_only: _Candidate | None = None
    for candidate in on_paper[:MAX_ROUNDS]:
        rounds += 1
        if holds(candidate):
            winner = candidate
            break
        if physics_only is None and _holds(storage, candidate.draft, order):
            physics_only = candidate  # cached run: it holds, but breaks a rule
    if winner is None:
        # Nothing both holds and complies: the best is a load that at least arrives intact.
        last = physics_only or on_paper[min(len(on_paper), MAX_ROUNDS) - 1]
        return Plan(
            draft=last.draft,
            changes=last.changes,
            verified=False,
            rounds=rounds,
            battery=run_battery(storage, last.draft),
        )
    # Minimality: drop each step in turn; a candidate that still holds without it wins.
    by_steps = {c.steps: c for c in on_paper}
    improved = True
    while improved and winner.steps:
        improved = False
        for step in winner.steps:
            fewer = tuple(s for s in winner.steps if s != step)
            smaller = by_steps.get(fewer)
            if smaller is None or smaller is winner:
                continue
            if smaller.draft.model_dump_json() not in tried:
                rounds += 1
            if holds(smaller):
                winner, improved = smaller, True
                break
    battery = run_battery(storage, winner.draft)  # cached: no new simulation
    return Plan(
        draft=winner.draft,
        changes=winner.changes + _edge_protectors(winner.draft),
        verified=battery.verdict.state == "approved",
        rounds=rounds,
        battery=battery,
    )
