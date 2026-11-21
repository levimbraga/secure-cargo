"""The planner: the smallest change to a load that passes the rules and the whole battery.

1. **Rules first.** Ropes become straps (CONTRAN 945 art. 4 §3); lashings tied to the wooden
   floor go to the metal frame (art. 6).
2. **Placement.** Units slide forward until the load is one block against the headboard (no
   room to travel, art. 7; the headboard stops the forward push), then the whole load shifts
   back if an axle group would exceed its limit (CONTRAN 882/2021).
3. **Securing, cheapest first.** Candidates in order of cost: top-over straps in the number
   EN 12195-1 asks for, an anti-slip mat under the same straps, diagonal lashings, chains
   (and a cradle for a coil, blocking in a box body). A candidate is tried only if it meets
   EN 12195-1 and every CONTRAN check on paper.
4. **Proof.** The first candidate that holds on paper is simulated through the battery,
   stopping at the first failure; if it fails, the next one is tried. The plan that passes
   is then reported with its full battery.

Every change carries a stable code (translated by the UI), the article behind it when there
is one, and the numbers that explain it.
"""

import math
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer import BuildError, build_draft
from app.explorer.build import CARGO, strap_room
from app.explorer.config import MAX_STRAPS_PER_UNIT, Cargo, Restraint
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
MAX_ROUNDS = 4
# Placement tolerance [m].
EPS = 1e-6
# A unit counts as tall when it is more than this times higher than its narrowest side.
TALL_RATIO = 1.6

ChangeCode = Literal[
    "replace_rope",
    "reanchor",
    "close_gaps",
    "balance_axles",
    "straps",
    "restraint",
]

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


def _candidates(draft: LoadDraft) -> list[_Candidate]:
    """Securing options, cheapest first."""
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
        out.append(_Candidate("cradle", _with_straps(draft, {}, Restraint.CRADLE)))
        out.append(_Candidate("cradle_straps", _with_straps(draft, two, Restraint.CRADLE)))
        out.append(_Candidate("chain", _with_straps(draft, {}, Restraint.CHAIN)))
        return out
    if box:
        out.append(_Candidate("blocking", _with_straps(draft, {}, Restraint.BLOCKING)))
    for restraint in (Restraint.TOP_OVER, Restraint.MAT):
        straps = _required_top_over(draft, restraint)
        if straps is not None:
            out.append(_Candidate(restraint.value, _with_straps(draft, straps, restraint)))
    # Diagonals hold by their strength, not by friction: they survive a dirty deck and loose
    # straps. Top-over straps stay on tall or stacked loads, which also tip.
    keep = (
        two
        if (_tall(draft) or any(u.on for u in draft.units))
        else {uid: n for uid, n in existing.items() if uid in room}
    )
    out.append(_Candidate("direct", _with_straps(draft, keep, Restraint.DIRECT)))
    out.append(_Candidate("chain", _with_straps(draft, keep, Restraint.CHAIN)))
    return out


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
    """The analytic recommendation, without simulating: rules, placement, first candidate."""
    fixed, changes = _rule_fixes(draft)
    scenario, _ = build_draft(fixed)
    fixed, placement = _placement(fixed, scenario)
    changes += placement
    for candidate in _candidates(fixed):
        if _on_paper(candidate):
            return candidate.draft, changes + _securing_changes(fixed, candidate.draft)
    return fixed, changes


def plan(storage: Storage, draft: LoadDraft) -> Plan:
    """Find the smallest change that passes, and prove it through the whole battery."""
    original = run_battery(storage, draft)
    passes_rules = all(c.status != "fail" for c in original.contran_945)
    if original.passed == original.total and passes_rules:
        return Plan(draft=draft, changes=[], verified=True, rounds=0, battery=original)

    fixed, changes = _rule_fixes(draft)
    scenario, _ = build_draft(fixed)
    fixed, placement = _placement(fixed, scenario)
    changes += placement
    candidates = [c for c in _candidates(fixed) if _on_paper(c)] or _candidates(fixed)
    rounds = 0
    for candidate in candidates[:MAX_ROUNDS]:
        rounds += 1
        runs = run_situations(
            storage, candidate.draft, _proof_order(original), stop_at_first_failure=True
        )
        if all(result.verdict.status != "fail" for _, result, _ in runs) and len(runs) == len(
            SITUATIONS
        ):
            battery = run_battery(storage, candidate.draft)  # cached: no new simulation
            return Plan(
                draft=candidate.draft,
                changes=changes + _securing_changes(fixed, candidate.draft),
                verified=battery.passed == battery.total,
                rounds=rounds,
                battery=battery,
            )
    last = candidates[min(len(candidates), MAX_ROUNDS) - 1].draft
    return Plan(
        draft=last,
        changes=changes + _securing_changes(fixed, last),
        verified=False,
        rounds=rounds,
        battery=run_battery(storage, last),
    )
