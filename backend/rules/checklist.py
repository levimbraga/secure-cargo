"""The checklist themes besides CONTRAN 945: weight and axles, protection and dimensions.

Every item has a stable ``code``, a ``status``, the article or standard behind it and the
numbers the page needs to explain it. ``kind`` says whether it is a legal **rule** (a failing
rule makes the load "out of compliance") or **advice** (good practice, shown but never a
violation). Sources: the workspace's ``notes/legal-limits.md``.

* Dimensions, CONTRAN Resolution 882/2021 art. 4 ("with or without cargo"): height 4.40 m from
  the road, width 2.60 m. Cargo sticking out past the vehicle's sides, front or rear is an
  infraction even within those limits: art. 60, XI, which sends it to CTB art. 235 (rules audit
  item 9). The special rear sign of art. 24 belongs to authorised oversize loads, not to this.
* Weights, CONTRAN Resolution 882/2021: each axle group within its legal limit (art. 6; the
  12.5 % weighing tolerance of art. 50 is not part of the loading limit, art. 50 §3), the cargo
  within the truck's payload (art. 2: never above the manufacturer's figures) and the gross
  weight within 29 t for a rigid truck (art. 6, I, a) or the PBTC of a tractor and semi-trailer:
  45 t below 16 m, 54.5 t with a triple tandem above 16 m (art. 6, I, c and d; unchanged by
  Resolutions 994/2023, 1005/2024 and 1015/2024). On a semi the trailer's load on the kingpin is
  shared between the tractor's steer axle (6 t, art. 6, II) and its drive tandem (rules audit
  item 5; tractor geometry ``BR_TRACTOR_*``, an ASSUMPTION).
* Art. 50 §1: a vehicle whose regulatory PBT or PBTC is 50 t or less is weighed on its total only;
  its axles are fined only when the total is over its 5 % tolerance (§2). The axle limit is still
  the law (art. 6, art. 51), so an axle over it still fails, with ``weighed_on_gross_only`` set
  (rules audit item 10). The regulatory gross is the lower of art. 6, I and the axle limits' sum.
* Balance (advice, our thresholds, ASSUMPTION documented in ``docs/inspection.md``): the
  centre of mass within 10 % of the deck width from the centre line, and at least 20 % of the
  modelled weight on the front axle group (steering).
* Protection (advice): an anti-slip mat under loads held by friction, edge protectors under
  straps over fragile cargo, and the headboard height (confirmed or "to confirm").
"""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.scenario import AxleGroupKind, BodyType, LashingRouting, Scenario
from rules.axle_loads import LEGAL_LIMIT_KG, WEIGHING_TOLERANCE_PER_AXLE, axle_loads

MAX_HEIGHT_M = 4.40  # CONTRAN 882/2021 art. 4, II
MAX_WIDTH_M = 2.60  # CONTRAN 882/2021 art. 4, I, b
MAX_GROSS_RIGID_KG = 29_000  # CONTRAN 882/2021 art. 6, I, a
MAX_GROSS_SEMI_SHORT_KG = 45_000  # art. 6, I, c: tractor + semi-trailer, below 16 m
MAX_GROSS_SEMI_LONG_KG = 54_500  # art. 6, I, d: tractor + semi-trailer, triple tandem, above 16 m
SEMI_LONG_M = 16.0
GROSS_ONLY_UP_TO_KG = 50_000  # art. 50 §1
STEER_LIMIT_KG = LEGAL_LIMIT_KG[AxleGroupKind.SINGLE_2_TYRES]  # art. 6, II

# ASSUMPTION (no published figure for "the" Brazilian tractor; rules audit item 5): a 6x2 road
# tractor, steer axle to drive-tandem centre 4.0 m, fifth wheel 0.30 m ahead of the tandem centre,
# empty tractor 4,800 kg on the steer axle and 3,700 kg on the drive tandem. The model's tare on
# the kingpin group (6.5 t) is the drive tandem's 3.7 t plus 2.8 t of the trailer's own front.
# From the front of the tractor to the front of the trailer: 4.0 m (the combination's length is
# that plus the trailer's bed).
BR_TRACTOR_WHEELBASE_M = 4.0
BR_FIFTH_WHEEL_AHEAD_M = 0.30
BR_STEER_TARE_KG = 4_800.0
BR_DRIVE_TARE_KG = 3_700.0
BR_TRACTOR_AHEAD_OF_TRAILER_M = 4.0
LATERAL_OFFSET_SHARE = 0.10  # advice: centre of mass off the centre line, share of deck width
MIN_FRONT_SHARE = 0.20  # advice: share of the modelled weight on the front axle group

FRAGILE = {"stacked_boxes", "sacks", "plastic_pallet"}
FRICTION_RESTRAINTS = {"top_over", "rope", "none"}

Status = Literal["pass", "fail", "not_applicable", "to_confirm", "advice"]


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    kind: Literal["rule", "advice"]
    status: Status
    article: str
    values: dict[str, float] = Field(default_factory=dict)
    unit_ids: list[str] = []


class Checklist(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    weight: list[Item]
    protection: list[Item]
    dimensions: list[Item]


def _top(scenario: Scenario) -> float:
    return max((u.position_m[2] + u.size_m[2] for u in scenario.units), default=0.0)


def dimensions(scenario: Scenario) -> list[Item]:
    bed = scenario.bed
    height = round(bed.floor_height_m + _top(scenario), 3)
    width = round(
        max((abs(u.position_m[1]) + u.size_m[1] / 2 for u in scenario.units), default=0.0) * 2, 3
    )
    rear_end = min((u.position_m[0] - u.size_m[0] / 2 for u in scenario.units), default=0.0)
    front_end = max((u.position_m[0] + u.size_m[0] / 2 for u in scenario.units), default=0.0)
    rear = round(max(0.0, -bed.length_m / 2 - rear_end), 3)
    front = round(max(0.0, front_end - bed.length_m / 2), 3)
    side = round(max(0.0, width / 2 - bed.width_m / 2), 3)
    overhang = max(rear, front, side)
    return [
        Item(
            code="height",
            kind="rule",
            status="pass" if height <= MAX_HEIGHT_M else "fail",
            article="CONTRAN 882/2021 art. 4, II",
            values={"height_m": height, "limit_m": MAX_HEIGHT_M},
        ),
        Item(
            code="width",
            kind="rule",
            status="pass" if width <= MAX_WIDTH_M else "fail",
            article="CONTRAN 882/2021 art. 4, I",
            values={"width_m": width, "limit_m": MAX_WIDTH_M},
        ),
        Item(
            code="overhang",
            kind="rule",
            status="pass" if overhang <= 0.0 else "fail",
            article="CONTRAN 882/2021 art. 60, XI (CTB art. 235)",
            values={"overhang_m": overhang, "rear_m": rear, "front_m": front, "side_m": side},
        ),
    ]


@dataclass(frozen=True)
class BrAxle:
    group: str  # "steer", "front", "rear", "tractor" (drive tandem), "trailer"
    load_kg: float
    limit_kg: float


def articulated(scenario: Scenario) -> bool:
    return scenario.vehicle is not None and scenario.vehicle.axle_groups[0].id == "tractor"


def br_axles(scenario: Scenario) -> list[BrAxle]:
    """Each axle group against CONTRAN 882 art. 6, with the tractor's steer axle on a semi."""
    loads = axle_loads(scenario)
    if not loads or scenario.vehicle is None:
        return []
    out: list[BrAxle] = []
    for load, group in zip(loads, scenario.vehicle.axle_groups, strict=True):
        if group.id == "tractor":
            kingpin = load.load_kg - BR_DRIVE_TARE_KG
            to_steer = BR_FIFTH_WHEEL_AHEAD_M / BR_TRACTOR_WHEELBASE_M
            out.append(
                BrAxle("steer", round(BR_STEER_TARE_KG + kingpin * to_steer, 1), STEER_LIMIT_KG)
            )
            out.append(
                BrAxle(
                    "tractor", round(BR_DRIVE_TARE_KG + kingpin * (1 - to_steer), 1), load.limit_kg
                )
            )
        else:
            out.append(BrAxle(group.id, load.load_kg, load.limit_kg))
    return out


def br_group_limits_kg(scenario: Scenario) -> list[float]:
    """The limit of each modelled group: on a semi, the kingpin group's load that keeps both the
    steer axle (6 t) and the drive tandem within theirs (for the planner's axle moves)."""
    loads = axle_loads(scenario)
    if not articulated(scenario):
        return [load.limit_kg for load in loads]
    to_steer = BR_FIFTH_WHEEL_AHEAD_M / BR_TRACTOR_WHEELBASE_M
    by_steer = (STEER_LIMIT_KG - BR_STEER_TARE_KG) / to_steer
    by_drive = (loads[0].limit_kg - BR_DRIVE_TARE_KG) / (1 - to_steer)
    return [BR_DRIVE_TARE_KG + min(by_steer, by_drive), loads[1].limit_kg]


def gross_limit(scenario: Scenario) -> tuple[float, str]:
    """The PBT or PBTC of art. 6, I, and its item."""
    if not articulated(scenario) or scenario.vehicle is None:
        return MAX_GROSS_RIGID_KG, "a"
    trailer = scenario.vehicle.axle_groups[1]
    length = scenario.bed.length_m + BR_TRACTOR_AHEAD_OF_TRAILER_M
    if trailer.kind is AxleGroupKind.TANDEM_3_AXLES and length > SEMI_LONG_M:
        return MAX_GROSS_SEMI_LONG_KG, "d"
    return MAX_GROSS_SEMI_SHORT_KG, "c"


def weight(scenario: Scenario) -> list[Item]:
    items: list[Item] = []
    cargo = round(sum(u.mass_kg for u in scenario.units), 1)
    loads = axle_loads(scenario)
    axles = br_axles(scenario)
    limit, item = gross_limit(scenario)
    regulatory = min(limit, sum(a.limit_kg for a in axles)) if axles else limit
    gross_only = regulatory <= GROSS_ONLY_UP_TO_KG
    for axle in axles:
        values = {
            "load_kg": axle.load_kg,
            "limit_kg": axle.limit_kg,
            "tolerance_kg": round(axle.limit_kg * (1 + WEIGHING_TOLERANCE_PER_AXLE)),
            "ratio": round(axle.load_kg / axle.limit_kg, 4),
        }
        if gross_only:
            values["weighed_on_gross_only"] = 1.0
            values["regulatory_gross_kg"] = regulatory
        items.append(
            Item(
                code="axle",
                kind="rule",
                status="pass" if axle.load_kg <= axle.limit_kg else "fail",
                article="CONTRAN 882/2021 art. 6" + (", art. 50 §1" if gross_only else ""),
                values=values,
                unit_ids=[axle.group],
            )
        )
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    if payload is not None:
        items.append(
            Item(
                code="payload",
                kind="rule",
                status="pass" if cargo <= payload else "fail",
                article="CONTRAN 882/2021 art. 2",
                values={"cargo_kg": cargo, "payload_kg": payload},
            )
        )
    gross = round(sum(a.load_kg for a in axles), 1)
    if axles:
        items.append(
            Item(
                code="gross",
                kind="rule",
                status="pass" if gross <= limit else "fail",
                article=f"CONTRAN 882/2021 art. 6, I, {item}",
                values={"gross_kg": gross, "limit_kg": limit},
            )
        )
    if cargo > 0:
        x = sum(u.mass_kg * u.position_m[0] for u in scenario.units) / cargo
        y = sum(u.mass_kg * u.position_m[1] for u in scenario.units) / cargo
        share = abs(y) / scenario.bed.width_m
        items.append(
            Item(
                code="lateral_balance",
                kind="advice",
                status="pass" if share <= LATERAL_OFFSET_SHARE else "advice",
                article="Good practice (load distribution)",
                values={"offset_m": round(y, 3), "share": round(share, 3), "x_m": round(x, 3)},
            )
        )
    if loads and gross > 0:
        # A semi's tractor (steer and drive) against the whole: the model's front group.
        front_share = loads[0].load_kg / sum(load.load_kg for load in loads)
        items.append(
            Item(
                code="front_axle_share",
                kind="advice",
                status="pass" if front_share >= MIN_FRONT_SHARE else "advice",
                article="Good practice (steering)",
                values={"share": round(front_share, 3), "minimum": MIN_FRONT_SHARE},
            )
        )
    return items


def protection(
    scenario: Scenario, *, cargo: list[str], restraint: str, headboard_known: bool
) -> list[Item]:
    bed = scenario.bed
    box = bed.body is BodyType.BOX
    straps = [x for x in scenario.lashings if x.routing is LashingRouting.TOP_OVER]
    if restraint in ("mat", "mat_direct"):
        mat: Status = "pass"
    elif box or restraint not in FRICTION_RESTRAINTS:
        mat = "not_applicable"
    else:
        mat = "advice"
    fragile = sorted({c for c in cargo if c in FRAGILE})
    edges: Status = "advice" if fragile and straps else "not_applicable"
    items = [
        Item(code="anti_slip_mat", kind="advice", status=mat, article="CONTRAN 945/2022 art. 4"),
        Item(
            code="edge_protectors",
            kind="advice",
            status=edges,
            article="EN 12195-1 (good practice)",
        ),
    ]
    headboard = bed.headboard
    if bed.body is BodyType.FLATBED and headboard is not None:
        items.append(
            Item(
                code="headboard_height",
                kind="rule",
                status="pass" if headboard_known else "to_confirm",
                article="CONTRAN 945/2022 art. 8",
                values={
                    "height_m": headboard.height_m,
                    "load_top_m": round(_top(scenario), 3),
                },
            )
        )
    return items


def checklist(
    scenario: Scenario, *, cargo: list[str], restraint: str, headboard_known: bool
) -> Checklist:
    return Checklist(
        weight=weight(scenario),
        protection=protection(
            scenario, cargo=cargo, restraint=restraint, headboard_known=headboard_known
        ),
        dimensions=dimensions(scenario),
    )
