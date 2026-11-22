"""US cargo securement, 49 CFR 393 subpart I (FMCSA), as explicit checks on a scenario.

Every check carries its CFR section, a stable ``code`` the UI translates and an English message.
The text, the worked examples and our readings are in the workspace's ``notes/us-rules.md``
(section 1). Readings of ours (the text gives no number for them):

* A device's working load limit (WLL) is its marked rating (393.108(b)). A strap is the usual
  US 2 in ratchet strap, marked WLL 3,335 lb with a breaking strength of 10,000 lb (one third,
  the WSTDA T-1 practice; rules audit item 8). A chain or a rope: the rated capacity (LC) the
  model uses, with a breaking strength of 4 x WLL for chain (NACM grade 70 practice) and the
  model's figure for rope. ASSUMPTION: the simulation keeps the model's EN 12195-2 strap; only
  the US limits change.
* 393.102(a) has two criteria (rules audit item 3): forces below the *breaking strength* at
  0.8 g forward, 0.5 g rearward and 0.5 g lateral, which the simulation checks (the battery's
  events reach those values), and forces below the *WLL* at 0.435 g / 0.5 g / 0.25 g, which
  ``wll_criterion`` checks by a static force balance: friction ``mu`` plus each top-over
  tiedown's clamping ``2 mu sin(a) T`` (T its pretension) plus each direct tiedown at its WLL,
  ``WLL (mu sin(a) + cos(a) cos(b))``, no safety factor (393.102 gives none).
* "In contact with" the front end structure, "blocked forward" and "close to a wall": within
  ``CONTACT_M`` (the same 15 cm the CONTRAN 945 art. 7 check uses).
* A tiedown over the top, side to side, is "indirect" (full WLL); one from the vehicle to the
  article is "direct" (half its WLL, 393.106(d)(1)). Each counts as one tiedown for 393.110.
"""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.explorer.config import Cargo
from app.explorer.draft import LoadDraft
from app.scenario import (
    BlockKind,
    BodyType,
    CargoUnit,
    CylinderAxis,
    Lashing,
    LashingKind,
    LashingRouting,
    Scenario,
    UnitShape,
)
from physics.constants import STANDARD_GRAVITY_MPS2
from physics.friction import resolve_friction
from rules.contran945 import _blocked, _lashings_of, _stacks

CONTACT_M = 0.15
FOOT_M = 0.3048
LB_KG = 0.45359237
AGGREGATE_SHARE = 0.5  # 393.106(d): aggregate WLL at least one-half the weight
FRONT_END_MIN_HEIGHT_M = 4 * FOOT_M  # 393.114(b)(1)
FRONT_END_TALL_M = 6 * FOOT_M  # 393.114(c)
SHORT_ARTICLE_M = 5 * FOOT_M  # 393.110(b)(1): 5 ft (1.52 m)
LIGHT_ARTICLE_KG = 1_100 * LB_KG  # 393.110(b)(1): 1,100 lb (500 kg)
TEN_FEET_M = 10 * FOOT_M  # 393.110: 10 ft (3.04 m)
COIL_MIN_KG = 5_000 * LB_KG  # 393.120(a): 5,000 lb (2,268 kg)
MACHINE_MIN_KG = 10_000 * LB_KG  # 393.130(a): 10,000 lb (4,536 kg)
MACHINE_MIN_TIEDOWNS = 4  # 393.130(c)(1)
LBF_N = 4.4482216152605  # one pound-force [N]
US_STRAP_WLL_N = 3_335 * LBF_N  # a 2 in ratchet strap (rules audit item 8)
US_STRAP_BREAKING_N = 10_000 * LBF_N
CHAIN_BREAKING_FACTOR = 4.0
# 393.102(a)(2): the working-load-limit criterion.
WLL_ACCELERATION: dict[str, float] = {"forward": 0.435, "rearward": 0.5, "sideways": 0.25}
# 393.102(a)(1): the breaking-strength criterion (the battery's events).
BREAKING_ACCELERATION: dict[str, float] = {"forward": 0.8, "rearward": 0.5, "sideways": 0.5}

Status = Literal["pass", "fail", "not_applicable", "to_confirm"]


class RuleCheck(BaseModel):
    """One legal check, of either country: what the securing theme of the checklist lists."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    article: str
    status: Status
    unit_ids: list[str] = []
    values: dict[str, float] = Field(default_factory=dict)
    message: str
    # EU only: the class a roadside inspection gives a failing check (2014/47/EU Annex III).
    deficiency: Literal["minor", "major", "dangerous"] | None = None


def _weight_n(units: list[CargoUnit]) -> float:
    return sum(u.mass_kg for u in units) * STANDARD_GRAVITY_MPS2


def _tiedowns(scenario: Scenario, stack: list[CargoUnit]) -> list[Lashing]:
    return _lashings_of(scenario, stack)


def us_wll_n(lashing: Lashing) -> float:
    """The working load limit of a modelled device in US mode (393.108(b): as marked)."""
    if lashing.kind is LashingKind.STRAP:
        return US_STRAP_WLL_N
    return lashing.lashing_capacity_n


def us_breaking_n(lashing: Lashing) -> float:
    """The breaking strength of a modelled device in US mode (393.102(a)(1))."""
    if lashing.kind is LashingKind.STRAP:
        return US_STRAP_BREAKING_N
    if lashing.breaking_strength_n is not None:
        return lashing.breaking_strength_n
    return CHAIN_BREAKING_FACTOR * lashing.lashing_capacity_n


def _aggregate_wll_n(lashings: list[Lashing]) -> float:
    """393.106(d): full WLL side to side over the article, half the WLL for a direct tiedown."""
    # A tiedown over a row of articles side by side shares its WLL among them.
    return sum(
        us_wll_n(x) * (1.0 / len(x.unit_ids) if x.routing is LashingRouting.TOP_OVER else 0.5)
        for x in lashings
    )


def _gap_ahead(scenario: Scenario, stack: list[CargoUnit]) -> tuple[float, CargoUnit | None]:
    """Room in front of a stack: to the headboard (None) or to the unit ahead in its lane."""
    base = stack[0]
    half = scenario.bed.length_m / 2
    front = base.position_m[0] + base.size_m[0] / 2
    ahead, blocker = half, None
    for other in scenario.units:
        if other is base or other.position_m[2] > 0:
            continue
        lane = (
            abs(other.position_m[1] - base.position_m[1])
            < (other.size_m[1] + base.size_m[1]) / 2 - 0.01
        )
        back = other.position_m[0] - other.size_m[0] / 2
        if lane and back >= front - 0.01 and back < ahead:
            ahead, blocker = back, other
    return ahead - front, blocker


def _top(stack: list[CargoUnit]) -> float:
    return max(u.position_m[2] + u.size_m[2] for u in stack)


def _contained(scenario: Scenario) -> bool:
    return scenario.bed.body is BodyType.BOX


def _blocked_forward(scenario: Scenario, stack: list[CargoUnit], headboard_known: bool) -> bool:
    """393.110(c): held forward by the headerboard, blocking, or other secured cargo."""
    if _blocked(scenario, stack):
        return True
    gap, blocker = _gap_ahead(scenario, stack)
    if gap > CONTACT_M:
        return False
    if blocker is not None:
        return bool(_lashings_of(scenario, [blocker])) or _blocked(scenario, [blocker])
    headboard = scenario.bed.headboard
    if headboard is None:
        return False
    if _contained(scenario):
        return True
    needed = min(FRONT_END_MIN_HEIGHT_M, _top(stack))
    return headboard_known and headboard.height_m + 0.01 >= needed


def required_tiedowns(length_m: float, mass_kg: float, blocked_forward: bool) -> int:
    """The minimum number of tiedowns of 393.110 for one article (or group of articles)."""
    if blocked_forward:  # (c): one per 10 ft of length, or fraction
        return max(1, math.ceil(length_m / TEN_FEET_M - 1e-9))
    if length_m <= SHORT_ARTICLE_M + 1e-9:  # (b)(1) and (b)(2)(i)
        return 1 if mass_kg <= LIGHT_ARTICLE_KG + 1e-9 else 2
    if length_m <= TEN_FEET_M + 1e-9:  # (b)(2)(ii)
        return 2
    return 2 + math.ceil((length_m - TEN_FEET_M) / TEN_FEET_M - 1e-9)  # (b)(3)


def _cargo_of(draft: LoadDraft | None) -> dict[str, Cargo]:
    return {u.id: u.cargo for u in draft.units} if draft else {}


def _is_coil(unit: CargoUnit) -> bool:
    return unit.shape is UnitShape.CYLINDER and unit.axis is CylinderAxis.Y


def _is_machine(unit: CargoUnit, cargo: dict[str, Cargo]) -> bool:
    return cargo.get(unit.id) is Cargo.MACHINE and unit.mass_kg >= MACHINE_MIN_KG - 1e-6


def _assessed(scenario: Scenario) -> list[list[CargoUnit]]:
    """Stacks secured by tiedowns: every stack on an open body; in a box, only lashed ones."""
    stacks = _stacks(scenario)
    if not _contained(scenario):
        return stacks
    return [s for s in stacks if _tiedowns(scenario, s)]


def aggregate_wll(scenario: Scenario) -> RuleCheck:
    article = "49 CFR 393.106(d)"
    stacks = _assessed(scenario)
    if not stacks:
        return RuleCheck(
            code="aggregate_wll",
            article=article,
            status="not_applicable",
            message="The van's walls contain the load; no tiedowns are used.",
        )
    failing: list[str] = []
    worst: tuple[float, float, float] | None = None  # (ratio, aggregate, required)
    direct = indirect = 0
    for stack in stacks:
        lashings = _tiedowns(scenario, stack)
        direct += sum(1 for x in lashings if x.routing is LashingRouting.DIRECT)
        indirect += sum(1 for x in lashings if x.routing is LashingRouting.TOP_OVER)
        aggregate = _aggregate_wll_n(lashings)
        required = AGGREGATE_SHARE * _weight_n(stack)
        ratio = aggregate / required if required else math.inf
        if worst is None or ratio < worst[0]:
            worst = (ratio, aggregate, required)
        if aggregate + 1e-6 < required:
            failing += [u.id for u in stack]
    assert worst is not None
    values = {
        "aggregate_kg": round(worst[1] / STANDARD_GRAVITY_MPS2, 1),
        "required_kg": round(worst[2] / STANDARD_GRAVITY_MPS2, 1),
        "direct": float(direct),
        "indirect": float(indirect),
    }
    if failing:
        return RuleCheck(
            code="aggregate_wll",
            article=article,
            status="fail",
            unit_ids=failing,
            values=values,
            message="The tiedowns' aggregate working load limit is less than half the weight.",
        )
    return RuleCheck(
        code="aggregate_wll",
        article=article,
        status="pass",
        values=values,
        message="Every article's tiedowns add up to at least half its weight.",
    )


def min_tiedowns(scenario: Scenario, draft: LoadDraft | None, headboard_known: bool) -> RuleCheck:
    article = "49 CFR 393.110"
    cargo = _cargo_of(draft)
    stacks = [
        s for s in _assessed(scenario) if not any(_is_machine(u, cargo) for u in s)
    ]  # 393.130 sets the count for heavy machinery
    if not stacks:
        return RuleCheck(
            code="min_tiedowns",
            article=article,
            status="not_applicable",
            message="No articles are secured by tiedowns.",
        )
    failing: list[str] = []
    worst: tuple[int, int, float, bool] | None = None  # (short by, installed, required, blocked)
    for stack in stacks:
        length = max(u.size_m[0] for u in stack)
        blocked = _blocked_forward(scenario, stack, headboard_known)
        required = required_tiedowns(length, sum(u.mass_kg for u in stack), blocked)
        installed = len(_tiedowns(scenario, stack))
        short = required - installed
        if worst is None or short > worst[0]:
            worst = (short, installed, required, blocked)
        if short > 0:
            failing += [u.id for u in stack]
    assert worst is not None
    values = {
        "installed": float(worst[1]),
        "required": float(worst[2]),
        "blocked": float(worst[3]),
    }
    if failing:
        return RuleCheck(
            code="min_tiedowns",
            article=article + ("(c)" if worst[3] else "(b)"),
            status="fail",
            unit_ids=failing,
            values=values,
            message="Fewer tiedowns than 393.110 asks for the article's length and weight.",
        )
    return RuleCheck(
        code="min_tiedowns",
        article=article,
        status="pass",
        values=values,
        message="Every article has the tiedowns 393.110 asks for its length and weight.",
    )


def front_end_structure(
    scenario: Scenario, headboard_known: bool, declared_kg: float | None = None
) -> RuleCheck:
    """393.114: height against the cargo it blocks, and the forward rating of (c).

    The model knows no US rating (an EN 12642 code is an EU standard US vans and headerboards are
    not built to: rules audit item 4). Without a declared rating the structure is "to confirm",
    never failed; the battery reports the simulated wall load next to the minimum. With a
    declared rating (``front_end_rating_kg`` from the maker's plate) it passes when it meets
    the minimum, and the simulation fails a run whose wall load exceeds it (``battery.py``).
    """
    article = "49 CFR 393.114"
    headboard = scenario.bed.headboard
    touching = []
    for stack in _stacks(scenario):
        gap, blocker = _gap_ahead(scenario, stack)
        if headboard is not None and blocker is None and gap <= CONTACT_M:
            touching.append(stack)
    if headboard is None or not touching:
        return RuleCheck(
            code="front_end_structure",
            article=article,
            status="not_applicable",
            message="No cargo is in contact with the front end structure.",
        )
    height = headboard.height_m
    needed = min(FRONT_END_MIN_HEIGHT_M, max(_top(s) for s in touching))
    share = 0.4 if height >= FRONT_END_TALL_M - 1e-9 else 0.5
    demand_n = share * _weight_n(list(scenario.units))
    ids = [u.id for s in touching for u in s]
    values: dict[str, float] = {
        "height_m": round(height, 3),
        "required_height_m": round(needed, 3),
        "share": share,
        "demand_kg": round(demand_n / STANDARD_GRAVITY_MPS2, 1),
    }
    if not headboard_known and not _contained(scenario):
        return RuleCheck(
            code="front_end_structure",
            article=article + "(b)",
            status="to_confirm",
            unit_ids=ids,
            values=values,
            message="Confirm the headboard's height and rating.",
        )
    if not _contained(scenario) and height + 0.01 < needed:
        return RuleCheck(
            code="front_end_structure",
            article=article + "(b)",
            status="fail",
            unit_ids=ids,
            values=values,
            message="The front end structure is below 4 ft and below the cargo it blocks.",
        )
    if declared_kg is not None:
        values["declared_kg"] = round(declared_kg, 1)
        below = declared_kg * STANDARD_GRAVITY_MPS2 + 1e-6 < demand_n
        return RuleCheck(
            code="front_end_structure",
            article=article + "(c)",
            status="fail" if below else "pass",
            unit_ids=ids if below else [],
            values=values,
            message=(
                "The declared rating of the front end structure is below 393.114(c)."
                if below
                else "The declared rating of the front end structure meets 393.114(c)."
            ),
        )
    return RuleCheck(
        code="front_end_structure",
        article=article + "(c)",
        status="to_confirm",
        unit_ids=ids,
        values=values,
        message="Confirm the front end structure is rated for the forward load of 393.114(c).",
    )


def front_end_rating_n(scenario: Scenario) -> float | None:
    """The forward load a 393.114(c) front end structure holds: 0.5 W (below 6 ft) or 0.4 W."""
    headboard = scenario.bed.headboard
    if headboard is None:
        return None
    share = 0.4 if headboard.height_m >= FRONT_END_TALL_M - 1e-9 else 0.5
    return share * _weight_n(list(scenario.units))


def _sine_over(scenario: Scenario, unit: CargoUnit, lashing: Lashing) -> float:
    anchors = {a.id: a.position_m for a in scenario.bed.anchor_points}
    top = unit.position_m[2] + unit.size_m[2]
    sines = []
    for anchor_id in lashing.anchor_ids:
        anchor = anchors[anchor_id]
        side = 1.0 if anchor[1] > unit.position_m[1] else -1.0
        edge_y = unit.position_m[1] + side * unit.size_m[1] / 2
        rise = top - anchor[2]
        sines.append(rise / math.hypot(rise, anchor[1] - edge_y))
    return min(sines)


_MOVES: dict[str, tuple[tuple[float, float], ...]] = {
    "forward": ((1.0, 0.0),),
    "rearward": ((-1.0, 0.0),),
    "sideways": ((0.0, 1.0), (0.0, -1.0)),
}


def _restraint_n(scenario: Scenario, stack: list[CargoUnit], mu: float, direction: str) -> float:
    """What the tiedowns of a stack hold against a move: top-over clamping and direct at WLL."""
    anchors = {a.id: a.position_m for a in scenario.bed.anchor_points}
    units = {u.id: u for u in stack}
    lashings = _tiedowns(scenario, stack)
    clamping = sum(
        2
        * mu
        * _sine_over(scenario, next(units[u] for u in x.unit_ids if u in units), x)
        * x.pretension_n
        / len(x.unit_ids)
        for x in lashings
        if x.routing is LashingRouting.TOP_OVER
    )
    worst = math.inf
    for move in _MOVES[direction]:
        total = 0.0
        for x in lashings:
            if x.routing is not LashingRouting.DIRECT or x.attachment_point_m is None:
                continue
            unit = units[x.unit_id]
            point = [unit.position_m[k] + x.attachment_point_m[k] for k in range(3)]
            anchor = anchors[x.anchor_ids[0]]
            pull = [anchor[k] - point[k] for k in range(3)]
            span = math.hypot(*pull)
            against = -(pull[0] * move[0] + pull[1] * move[1]) / span
            if against <= 0:
                continue
            down = max(-pull[2] / span, 0.0)
            total += us_wll_n(x) * (mu * down + against)
        worst = min(worst, total)
    return clamping + worst


def wll_criterion(scenario: Scenario, headboard_known: bool = True) -> RuleCheck:
    """393.102(a)(2): at 0.435 g forward, 0.5 g rearward and 0.25 g lateral, no tiedown above
    its WLL. Static: the article must be held by friction, clamping and direct tiedowns at WLL."""
    from rules.eu_annex3 import _rolls  # the directions a cylinder rolls in (no friction)

    article = "49 CFR 393.102(a)(2)"
    if _contained(scenario):
        return RuleCheck(
            code="wll_criterion",
            article=article,
            status="not_applicable",
            message="The van's walls contain the load (393.102(c)(2)).",
        )
    failing: list[str] = []
    worst: tuple[float, str] | None = None
    for stack in _stacks(scenario):
        base = stack[0]
        mu = resolve_friction(
            base.material, scenario.bed.floor_material, override=base.friction_coefficient
        ).coefficient
        weight = _weight_n(stack)
        rolls = _rolls(base)
        for direction, c in WLL_ACCELERATION.items():
            if direction != "sideways" and _blocked(scenario, stack):
                continue
            if direction == "forward" and _blocked_forward(scenario, stack, headboard_known):
                continue  # held by the front end structure (393.114) or blocking
            friction = 0.0 if direction in rolls else mu
            demand = max(0.0, c - friction) * weight
            if demand <= 0:
                continue
            held = _restraint_n(scenario, stack, friction, direction)
            ratio = held / demand
            if worst is None or ratio < worst[0]:
                worst = (ratio, direction)
            if held + 1e-6 < demand and base.id not in failing:
                failing += [u.id for u in stack]
    values = {"worst_ratio": round(worst[0], 3)} if worst else {}
    if failing:
        return RuleCheck(
            code="wll_criterion",
            article=article,
            status="fail",
            unit_ids=failing,
            values=values,
            message=(
                "At 0.435 g braking, 0.5 g rearward or 0.25 g sideways the tiedowns would go "
                "above their working load limit."
            ),
        )
    return RuleCheck(
        code="wll_criterion",
        article=article,
        status="pass",
        values=values,
        message="At the 393.102(a)(2) accelerations every tiedown stays within its WLL.",
    )


def _cradled(scenario: Scenario, stack: list[CargoUnit]) -> bool:
    base = stack[0]
    return any(
        block.kind is BlockKind.CRADLE
        and abs(block.position_m[0] - base.position_m[0]) <= base.size_m[0]
        and abs(block.position_m[1] - base.position_m[1]) <= base.size_m[1] / 2 + 0.01
        for block in scenario.bed.blocks
    )


def rolling_articles(scenario: Scenario) -> RuleCheck:
    article = "49 CFR 393.106(c)(1)"
    coils_rule = sum(u.mass_kg for u in scenario.units if _is_coil(u)) >= COIL_MIN_KG - 1e-6
    rolling = [
        s
        for s in _stacks(scenario)
        if s[0].shape is UnitShape.CYLINDER
        and s[0].axis is not CylinderAxis.Z
        and not (coils_rule and _is_coil(s[0]))  # 393.120 sets its own rule
    ]
    if not rolling:
        return RuleCheck(
            code="rolling_articles",
            article=article,
            status="not_applicable",
            message="No article on the deck is likely to roll.",
        )
    loose = [u.id for s in rolling if not _blocked(scenario, s) for u in s]
    if loose:
        return RuleCheck(
            code="rolling_articles",
            article=article,
            status="fail",
            unit_ids=loose,
            message="Articles likely to roll need chocks, wedges or a cradle.",
        )
    return RuleCheck(
        code="rolling_articles",
        article=article,
        status="pass",
        message="Every article likely to roll is chocked or cradled.",
    )


def metal_coils(scenario: Scenario) -> RuleCheck:
    article = "49 CFR 393.120"
    coils = [u for u in scenario.units if _is_coil(u)]
    if not coils or sum(u.mass_kg for u in coils) < COIL_MIN_KG - 1e-6:
        return RuleCheck(
            code="metal_coils",
            article=article,
            status="not_applicable",
            message="No metal coils of 5,000 lb or more.",
        )
    anchors = {a.id: a.position_m for a in scenario.bed.anchor_points}
    failing: list[str] = []
    missing_cradle = missing_ties = 0
    for coil in coils:
        direct = [
            x
            for x in scenario.lashings
            if x.unit_id == coil.id
            and x.routing is LashingRouting.DIRECT
            and x.kind is not LashingKind.ROPE
        ]
        # A tiedown to an anchor behind the coil restricts forward motion; ahead, rearward.
        forward = any(anchors[x.anchor_ids[0]][0] < coil.position_m[0] for x in direct)
        rearward = any(anchors[x.anchor_ids[0]][0] > coil.position_m[0] for x in direct)
        cradle = _cradled(scenario, [coil])
        if not cradle:
            missing_cradle += 1
        if not (forward and rearward):
            missing_ties += 1
        if not (cradle and forward and rearward):
            failing.append(coil.id)
    values = {
        "coils": float(len(coils)),
        "no_cradle": float(missing_cradle),
        "no_ties": float(missing_ties),
    }
    if failing:
        return RuleCheck(
            code="metal_coils",
            article=article + "(c)",
            status="fail",
            unit_ids=failing,
            values=values,
            message=(
                "A coil with its eye crosswise needs a cradle and tiedowns through the eye "
                "against forward and rearward motion."
            ),
        )
    return RuleCheck(
        code="metal_coils",
        article=article + "(c)",
        status="pass",
        values=values,
        message="Every coil is cradled and chained through its eye forward and rearward.",
    )


def machinery(scenario: Scenario, draft: LoadDraft | None) -> RuleCheck:
    article = "49 CFR 393.130"
    cargo = _cargo_of(draft)
    machines = [u for u in scenario.units if _is_machine(u, cargo)]
    if not machines:
        return RuleCheck(
            code="machinery",
            article=article,
            status="not_applicable",
            message="No machinery of 10,000 lb or more.",
        )
    failing = [
        m.id
        for m in machines
        if sum(
            1 for x in scenario.lashings if x.unit_id == m.id and x.routing is LashingRouting.DIRECT
        )
        < MACHINE_MIN_TIEDOWNS
    ]
    if failing:
        return RuleCheck(
            code="machinery",
            article=article + "(c)",
            status="fail",
            unit_ids=failing,
            values={"required": float(MACHINE_MIN_TIEDOWNS)},
            message="Heavy machinery needs at least four tiedowns at its front and rear.",
        )
    return RuleCheck(
        code="machinery",
        article=article + "(c)",
        status="pass",
        values={"required": float(MACHINE_MIN_TIEDOWNS)},
        message="Every machine has at least four tiedowns at its front and rear.",
    )


def anchor_points(scenario: Scenario, anchored_on_wood: bool) -> RuleCheck:
    article = "49 CFR 393.104(c)"
    if anchored_on_wood:
        return RuleCheck(
            code="anchor_points",
            article=article,
            status="fail",
            message="Tiedowns are fixed to the wooden floor or rails, not rated anchor points.",
        )
    if not scenario.lashings:
        return RuleCheck(
            code="anchor_points", article=article, status="not_applicable", message="No tiedowns."
        )
    return RuleCheck(
        code="anchor_points",
        article=article,
        status="pass",
        message="Tiedowns are hooked to the truck's anchor points.",
    )


def rope_tiedowns(scenario: Scenario) -> RuleCheck:
    article = "49 CFR 393.104(f), 393.112"
    ropes = sorted({x.unit_id for x in scenario.lashings if x.kind is LashingKind.ROPE})
    if not ropes:
        return RuleCheck(
            code="rope_tiedowns",
            article=article,
            status="not_applicable",
            message="No ropes.",
        )
    return RuleCheck(
        code="rope_tiedowns",
        article=article,
        status="to_confirm",
        unit_ids=ropes,
        message="Ropes are allowed without knots and if the driver can re-tighten them.",
    )


def van_contained(scenario: Scenario) -> RuleCheck:
    article = "49 CFR 393.102(c)(2)"
    if not _contained(scenario):
        return RuleCheck(
            code="van_contained",
            article=article,
            status="not_applicable",
            message="Applies to cargo inside a van's walls.",
        )
    loose = [
        u.id
        for s in _stacks(scenario)
        if not _tiedowns(scenario, s)
        and not _blocked(scenario, s)
        and _gap_ahead(scenario, s)[0] > CONTACT_M
        for u in s
    ]
    if loose:
        return RuleCheck(
            code="van_contained",
            article=article,
            status="fail",
            unit_ids=loose,
            message="Cargo with room to move inside the van needs blocking, bracing or tiedowns.",
        )
    return RuleCheck(
        code="van_contained",
        article=article,
        status="pass",
        message="Every article touches the front wall or the cargo ahead of it.",
    )


def check_fmcsa_393(
    scenario: Scenario,
    draft: LoadDraft | None = None,
    *,
    anchored_on_wood: bool = False,
    headboard_known: bool = True,
) -> list[RuleCheck]:
    """The US securing checks, in the order of the sections."""
    return [
        wll_criterion(scenario, headboard_known),
        aggregate_wll(scenario),
        min_tiedowns(scenario, draft, headboard_known),
        front_end_structure(
            scenario, headboard_known, draft.truck.front_end_rating_kg if draft else None
        ),
        van_contained(scenario),
        rolling_articles(scenario),
        metal_coils(scenario),
        machinery(scenario, draft),
        anchor_points(scenario, anchored_on_wood),
        rope_tiedowns(scenario),
    ]
