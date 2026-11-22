"""The US checklist themes besides securing: weight and axles, protection and dimensions.

The same ``Item`` shape as the Brazilian checklist (``checklist.py``), so the page and the verdict
read both alike. Values stay SI (kg, m); the pound values the page shows for the federal limits are
added (``*_lb``) so a limit written in pounds is shown exactly. Sources: ``notes/us-rules.md``.

* Weight (23 CFR 658.17): each axle group (single 20,000 lb, tandem 34,000 lb), the gross weight
  (80,000 lb) and the bridge formula over every group of consecutive axles (the worst one is
  shown). The truck's payload is the manufacturer's rating: advice here (no federal rule we
  checked says it), a rule in Brazil.
* Protection: unchanged themes, US sections cited (393.108(g) friction mats, 393.104(f)(4) edge
  protection, 393.114(b) the headboard's height).
* Dimensions: width 102 in (23 CFR 658.15); no federal height limit (advice above 13 ft 6 in, the
  lowest state limit FHWA quotes); cargo more than 4 ft past the rear needs flags (393.87).
"""

from app.explorer.config import Size
from app.scenario import BodyType, LashingRouting, Scenario
from rules.checklist import (
    FRAGILE,
    FRICTION_RESTRAINTS,
    LATERAL_OFFSET_SHARE,
    MIN_FRONT_SHARE,
    Checklist,
    Item,
    Status,
)
from rules.us_weights import (
    GROSS_LB,
    bridge_groups,
    group_loads,
    kg,
    pounds,
    us_axles,
)

MAX_WIDTH_M = 102 * 0.0254  # 23 CFR 658.15(a): 102 in
ADVISED_HEIGHT_M = 13.5 * 0.3048  # 13 ft 6 in: the lowest state height limit FHWA quotes
FLAG_PROJECTION_M = 4 * 0.3048  # 49 CFR 393.87(a): more than 4 ft beyond the rear


def _top(scenario: Scenario) -> float:
    return max((u.position_m[2] + u.size_m[2] for u in scenario.units), default=0.0)


def weight(scenario: Scenario, size: Size | None) -> list[Item]:
    items: list[Item] = []
    cargo = round(sum(u.mass_kg for u in scenario.units), 1)
    axles = us_axles(scenario, size)
    groups = group_loads(axles)
    for group in groups:
        limit_kg = kg(group.limit_lb)
        items.append(
            Item(
                code="us_axle",
                kind="rule",
                status="pass" if group.load_kg <= limit_kg + 0.5 else "fail",
                article="23 CFR 658.17(d)" if group.tandem else "23 CFR 658.17(c)",
                values={
                    "load_kg": group.load_kg,
                    "limit_kg": round(limit_kg, 1),
                    "load_lb": round(pounds(group.load_kg)),
                    "limit_lb": group.limit_lb,
                    "axles": float(group.axles),
                    "ratio": round(group.load_kg / limit_kg, 4),
                },
                unit_ids=[group.group],
            )
        )
    if axles:
        gross = round(sum(a.load_kg for a in axles), 1)
        items.append(
            Item(
                code="us_gross",
                kind="rule",
                status="pass" if gross <= kg(GROSS_LB) + 0.5 else "fail",
                article="23 CFR 658.17(b)",
                values={
                    "gross_kg": gross,
                    "limit_kg": round(kg(GROSS_LB), 1),
                    "gross_lb": round(pounds(gross)),
                    "limit_lb": float(GROSS_LB),
                },
            )
        )
        tandems = {g.group for g in groups if g.tandem}
        bridges = bridge_groups(axles, tandems)
        if bridges:
            worst = max(bridges, key=lambda b: b.load_kg / kg(b.limit_lb))
            over = [b for b in bridges if b.load_kg > kg(b.limit_lb) + 0.5]
            items.append(
                Item(
                    code="bridge",
                    kind="rule",
                    status="fail" if over else "pass",
                    article="23 CFR 658.17(e)",
                    values={
                        "load_kg": worst.load_kg,
                        "limit_kg": round(kg(worst.limit_lb), 1),
                        "load_lb": round(pounds(worst.load_kg)),
                        "limit_lb": worst.limit_lb,
                        "axles": float(worst.axles),
                        "length_ft": worst.length_ft,
                        "first": float(worst.first + 1),
                        "last": float(worst.last + 1),
                        "groups": float(len(bridges)),
                        "ratio": round(worst.load_kg / kg(worst.limit_lb), 4),
                    },
                    unit_ids=[axles[worst.first].group, axles[worst.last].group],
                )
            )
    payload = scenario.vehicle.payload_kg if scenario.vehicle else None
    if payload is not None:
        items.append(
            Item(
                code="payload",
                kind="advice",
                status="pass" if cargo <= payload else "advice",
                article="Manufacturer's rating (GVWR label)",
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
                article="Good practice (load distribution)",
                values={"offset_m": round(y, 3), "share": round(share, 3), "x_m": round(x, 3)},
            )
        )
    if axles:
        gross = sum(a.load_kg for a in axles)
        front_share = sum(a.load_kg for a in axles if a.group == axles[0].group) / gross
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
        Item(code="anti_slip_mat", kind="advice", status=mat, article="49 CFR 393.108(g)"),
        Item(code="edge_protectors", kind="advice", status=edges, article="49 CFR 393.104(f)(4)"),
    ]
    headboard = bed.headboard
    if bed.body is BodyType.FLATBED and headboard is not None:
        items.append(
            Item(
                code="headboard_height",
                kind="rule",
                status="pass" if headboard_known else "to_confirm",
                article="49 CFR 393.114(b)",
                values={"height_m": headboard.height_m, "load_top_m": round(_top(scenario), 3)},
            )
        )
    return items


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
            code="width",
            kind="rule",
            status="pass" if width <= MAX_WIDTH_M + 1e-6 else "fail",
            article="23 CFR 658.15(a)",
            values={"width_m": width, "limit_m": round(MAX_WIDTH_M, 4)},
        ),
        Item(
            code="us_height",
            kind="advice",
            status="pass" if height <= ADVISED_HEIGHT_M + 1e-6 else "advice",
            article="No federal height limit (FHWA); states: 13 ft 6 in to 14 ft 6 in",
            values={"height_m": height, "limit_m": round(ADVISED_HEIGHT_M, 4)},
        ),
        Item(
            code="rear_projection",
            kind="rule",
            status="pass" if overhang <= FLAG_PROJECTION_M + 1e-6 else "to_confirm",
            article="49 CFR 393.87",
            values={"overhang_m": overhang, "limit_m": round(FLAG_PROJECTION_M, 4)},
        ),
    ]


def us_checklist(
    scenario: Scenario,
    size: Size | None,
    *,
    cargo: list[str],
    restraint: str,
    headboard_known: bool,
) -> Checklist:
    return Checklist(
        weight=weight(scenario, size),
        protection=protection(
            scenario, cargo=cargo, restraint=restraint, headboard_known=headboard_known
        ),
        dimensions=dimensions(scenario),
    )
