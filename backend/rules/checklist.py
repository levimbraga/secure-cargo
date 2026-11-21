"""The checklist themes besides CONTRAN 945: weight and axles, protection and dimensions.

Every item has a stable ``code``, a ``status``, the article or standard behind it and the
numbers the page needs to explain it. ``kind`` says whether it is a legal **rule** (a failing
rule makes the load "out of compliance") or **advice** (good practice, shown but never a
violation). Sources: the workspace's ``notes/legal-limits.md``.

* Dimensions, CONTRAN Resolution 882/2021 art. 4 ("with or without cargo"): height 4.40 m from
  the road, width 2.60 m; cargo sticking out past the rear of the deck adds to the rear overhang
  and needs the special warning sign (art. 24).
* Weights, CONTRAN Resolution 882/2021: each axle group within its legal limit (art. 6; the
  12.5 % weighing tolerance of art. 50 is not part of the loading limit, art. 50 §3), the cargo
  within the truck's payload (art. 2: never above the manufacturer's figures) and the gross
  weight within 29 t for a rigid truck (art. 6, I, a).
* Balance (advice, our thresholds, ASSUMPTION documented in ``docs/inspection.md``): the
  centre of mass within 10 % of the deck width from the centre line, and at least 20 % of the
  modelled weight on the front axle group (steering).
* Protection (advice): an anti-slip mat under loads held by friction, edge protectors under
  straps over fragile cargo, and the headboard height (confirmed or "to confirm").
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.scenario import BodyType, LashingRouting, Scenario
from rules.axle_loads import WEIGHING_TOLERANCE_PER_AXLE, axle_loads

MAX_HEIGHT_M = 4.40  # CONTRAN 882/2021 art. 4, II
MAX_WIDTH_M = 2.60  # CONTRAN 882/2021 art. 4, I, b
MAX_GROSS_RIGID_KG = 29_000  # CONTRAN 882/2021 art. 6, I, a
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
    overhang = round(max(0.0, -bed.length_m / 2 - rear_end), 3)
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
            article="CONTRAN 882/2021 art. 4 §2, art. 24",
            values={"overhang_m": overhang},
        ),
    ]


def weight(scenario: Scenario) -> list[Item]:
    items: list[Item] = []
    cargo = round(sum(u.mass_kg for u in scenario.units), 1)
    loads = axle_loads(scenario)
    for load in loads:
        items.append(
            Item(
                code="axle",
                kind="rule",
                status="pass" if load.load_kg <= load.limit_kg else "fail",
                article="CONTRAN 882/2021 art. 6",
                values={
                    "load_kg": load.load_kg,
                    "limit_kg": load.limit_kg,
                    "tolerance_kg": round(load.limit_kg * (1 + WEIGHING_TOLERANCE_PER_AXLE)),
                    "ratio": load.ratio,
                },
                unit_ids=[load.axle_group_id],
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
    gross = round(sum(load.load_kg for load in loads), 1)
    articulated = bool(loads) and loads[0].axle_group_id == "tractor"
    if loads and not articulated:
        items.append(
            Item(
                code="gross",
                kind="rule",
                status="pass" if gross <= MAX_GROSS_RIGID_KG else "fail",
                article="CONTRAN 882/2021 art. 6, I, a",
                values={"gross_kg": gross, "limit_kg": MAX_GROSS_RIGID_KG},
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
        front_share = loads[0].load_kg / gross
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
    if restraint == "mat":
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
