"""The EU checklist themes besides securing: weight and axles, protection and dimensions.

The same ``Item`` shape as the Brazilian checklist (``checklist.py``). Sources:
``notes/eu-rules.md``.

* Weight (Directive 96/53/EC Annex I): each axle group against its limit (3.1 to 3.5), the gross
  weight of the vehicle's class (2.2.2, 2.3.1, 2.3.2) and the driving axle's share (4.1). The
  truck's payload is the manufacturer's plate: advice here (national law enforces the plate).
* Protection: the same themes, EU sources cited (EN 12195-1 friction for mats; Annex III Table 1
  item 20.3.5 for edge protection, a major deficiency when it is missing and needed).
* Dimensions (96/53/EC Annex I point 1): height 4.00 m, width 2.55 m and, on the EU presets, the
  overall length of the vehicle's class plus any cargo past the rear (12.00 m rigid, 16.50 m
  articulated). The headboard height is a securing check in EU mode (Table 1 item 10.1.2).
"""

from app.explorer.build import EU_OVERALL_LENGTH_M
from app.explorer.config import EU_SIZES, Size
from app.scenario import BodyType, LashingRouting, Scenario
from rules.checklist import (
    FRAGILE,
    FRICTION_RESTRAINTS,
    LATERAL_OFFSET_SHARE,
    Checklist,
    Item,
    Status,
)
from rules.eu_weights import MIN_DRIVING_SHARE, eu_axles, gross_limit

MAX_HEIGHT_M = 4.00  # 96/53/EC Annex I 1.3
MAX_WIDTH_M = 2.55  # 1.2 (a)
MAX_LENGTH_RIGID_M = 12.00  # 1.1, motor vehicle
MAX_LENGTH_ARTICULATED_M = 16.50  # 1.1, articulated vehicle
DIRECTIVE = "Directive 96/53/EC Annex I"


def _top(scenario: Scenario) -> float:
    return max((u.position_m[2] + u.size_m[2] for u in scenario.units), default=0.0)


def weight(scenario: Scenario, size: Size | None) -> list[Item]:
    items: list[Item] = []
    cargo = round(sum(u.mass_kg for u in scenario.units), 1)
    axles = eu_axles(scenario, size)
    for axle in axles:
        items.append(
            Item(
                code="eu_axle",
                kind="rule",
                status="pass" if axle.load_kg <= axle.limit_kg + 0.5 else "fail",
                article=f"{DIRECTIVE} {axle.point}",
                values={
                    "load_kg": axle.load_kg,
                    "limit_kg": axle.limit_kg,
                    "axles": float(axle.axles),
                    "spread_m": round(axle.spread_m, 3),
                    "driving": float(axle.driving),
                    "ratio": round(axle.load_kg / axle.limit_kg, 4),
                },
                unit_ids=[axle.group],
            )
        )
    if axles:
        gross = round(sum(a.load_kg for a in axles), 1)
        limit, point = gross_limit(scenario, size)
        items.append(
            Item(
                code="eu_gross",
                kind="rule",
                status="pass" if gross <= limit + 0.5 else "fail",
                article=f"{DIRECTIVE} {point}",
                values={"gross_kg": gross, "limit_kg": limit},
            )
        )
        driving = sum(a.load_kg for a in axles if a.driving)
        share = driving / gross if gross else 1.0
        items.append(
            Item(
                code="eu_driving_share",
                kind="rule",
                status="pass" if share >= MIN_DRIVING_SHARE - 1e-9 else "fail",
                article=f"{DIRECTIVE} 4.1",
                values={
                    "share": round(share, 4),
                    "minimum": MIN_DRIVING_SHARE,
                    "driving_kg": round(driving, 1),
                },
            )
        )
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    if payload is not None:
        items.append(
            Item(
                code="payload",
                kind="advice",
                status="pass" if cargo <= payload else "advice",
                article="Manufacturer's plate (national law)",
                values={"cargo_kg": cargo, "payload_kg": payload},
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
                article="Directive 2014/47/EU Annex III I.2 (load distribution)",
                values={"offset_m": round(y, 3), "share": round(share, 3), "x_m": round(x, 3)},
            )
        )
    return items


def protection(scenario: Scenario, *, cargo: list[str], restraint: str) -> list[Item]:
    box = scenario.bed.body is BodyType.BOX
    straps = [x for x in scenario.lashings if x.routing is LashingRouting.TOP_OVER]
    if restraint in ("mat", "mat_direct"):
        mat: Status = "pass"
    elif box or restraint not in FRICTION_RESTRAINTS:
        mat = "not_applicable"
    else:
        mat = "advice"
    fragile = sorted({c for c in cargo if c in FRAGILE})
    edges: Status = "advice" if fragile and straps else "not_applicable"
    return [
        Item(
            code="anti_slip_mat",
            kind="advice",
            status=mat,
            article="EN 12195-1 Annex B; Annex III Table 1 item 20.4",
        ),
        Item(
            code="edge_protectors",
            kind="advice",
            status=edges,
            article="Directive 2014/47/EU Annex III, Table 1 item 20.3.5",
        ),
    ]


def dimensions(scenario: Scenario, size: Size | None) -> list[Item]:
    bed = scenario.bed
    height = round(bed.floor_height_m + _top(scenario), 3)
    width = round(
        max((abs(u.position_m[1]) + u.size_m[1] / 2 for u in scenario.units), default=0.0) * 2, 3
    )
    rear_end = min((u.position_m[0] - u.size_m[0] / 2 for u in scenario.units), default=0.0)
    overhang = round(max(0.0, -bed.length_m / 2 - rear_end), 3)
    items = [
        Item(
            code="eu_height",
            kind="rule",
            status="pass" if height <= MAX_HEIGHT_M + 1e-6 else "fail",
            article=f"{DIRECTIVE} 1.3",
            values={"height_m": height, "limit_m": MAX_HEIGHT_M},
        ),
        Item(
            code="eu_width",
            kind="rule",
            status="pass" if width <= MAX_WIDTH_M + 1e-6 else "fail",
            article=f"{DIRECTIVE} 1.2",
            values={"width_m": width, "limit_m": MAX_WIDTH_M},
        ),
    ]
    vehicle = scenario.vehicle
    articulated = vehicle is not None and vehicle.axle_groups[0].id == "tractor"
    limit = MAX_LENGTH_ARTICULATED_M if articulated else MAX_LENGTH_RIGID_M
    if size in EU_SIZES:
        length = round(EU_OVERALL_LENGTH_M[size] + overhang, 3)
        items.append(
            Item(
                code="eu_length",
                kind="rule",
                status="pass" if length <= limit + 1e-6 else "fail",
                article=f"{DIRECTIVE} 1.1",
                values={"length_m": length, "limit_m": limit, "overhang_m": overhang},
            )
        )
    else:
        items.append(
            Item(
                code="eu_length",
                kind="rule",
                status="to_confirm" if overhang > 0 else "not_applicable",
                article=f"{DIRECTIVE} 1.1",
                values={"limit_m": limit, "overhang_m": overhang},
            )
        )
    return items


def eu_checklist(
    scenario: Scenario, size: Size | None, *, cargo: list[str], restraint: str
) -> Checklist:
    return Checklist(
        weight=weight(scenario, size),
        protection=protection(scenario, cargo=cargo, restraint=restraint),
        dimensions=dimensions(scenario, size),
    )
