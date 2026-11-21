"""The verdict of an inspection, in three states, and the one sentence that names its problem.

* ``approved``: every situation holds and every legal rule passes.
* ``holds_noncompliant``: every situation holds, but a rule fails (CONTRAN 945/2022, the axle
  or weight limits or the dimensions of CONTRAN 882/2021).
* ``fails``: the load does not arrive intact: some situation fails for a physical reason
  (it slides, tips, rolls, hits the headboard, a lashing breaks or is overloaded).

An axle overload is a rule, not physics: a simulation that fails only because an axle group is
over its limit still "holds". So the page is never red when every situation holds.

The same function exists in the Worker (``worker/src/verdict.ts``) and the site
(``frontend/lib/inspection/verdict.ts``), each with the same tests.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

Json = dict[str, Any]

VerdictState = Literal["approved", "holds_noncompliant", "fails"]

# Findings that are rule checks reported inside a run, not movement of the load.
RULE_FINDINGS = {"axle_overloaded"}
# The order in which a situation's findings name its problem: the worst consequence first.
FINDING_ORDER = (
    "unit_left_bed",
    "lashing_broke",
    "unit_tilted",
    "unit_rolled",
    "unit_hit_headboard",
    "headboard_overloaded",
    "unit_slid",
    "lashing_overloaded",
)


class MainProblem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: Literal["physics", "rule"]
    code: str
    situation: str | None = None
    unit_id: str | None = None
    article: str | None = None


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    state: VerdictState
    physics_passed: int
    total: int
    main_problem: MainProblem | None


def physical_failures(findings: list[Json]) -> list[Json]:
    return [
        f for f in findings if f.get("severity") == "fail" and f.get("code") not in RULE_FINDINGS
    ]


def _first_finding(findings: list[Json]) -> Json:
    def rank(f: Json) -> int:
        code = f.get("code", "")
        return FINDING_ORDER.index(code) if code in FINDING_ORDER else len(FINDING_ORDER)

    return min(findings, key=rank)


def verdict_of(battery: Json) -> Verdict:
    """The verdict of a battery as the API answers it (a dict, from Python or JSON)."""
    situations = battery.get("situations", [])
    physics = [(s, physical_failures(s.get("findings", []))) for s in situations]
    failing = [(s, f) for s, f in physics if f]
    total = len(situations)
    if failing:
        situation, findings = max(failing, key=lambda pair: pair[0].get("severity", 0.0))
        first = _first_finding(findings)
        problem = MainProblem(
            kind="physics",
            code=first.get("code", "unit_slid"),
            situation=situation.get("id"),
            unit_id=first.get("unit_id"),
        )
        return Verdict(
            state="fails", physics_passed=total - len(failing), total=total, main_problem=problem
        )
    rule = _first_rule_failure(battery)
    return Verdict(
        state="holds_noncompliant" if rule else "approved",
        physics_passed=total,
        total=total,
        main_problem=rule,
    )


def active_rules(battery: Json) -> tuple[list[Json], Json]:
    """The securing checks and checklist the verdict uses: the battery's country's, if it has the
    rule sets of both countries (since 2026-11-21); else the Brazilian ones it always carried."""
    country = battery.get("country") or "BR"
    rules = (battery.get("rules") or {}).get(country)
    if rules:
        return rules.get("securing", []), rules.get("checklist") or {}
    return battery.get("contran_945", []), battery.get("checklist") or {}


def _first_rule_failure(battery: Json) -> MainProblem | None:
    securing, checklist = active_rules(battery)
    for check in securing:
        if check.get("status") == "fail":
            ids = check.get("unit_ids") or [None]
            return MainProblem(
                kind="rule", code=check["code"], unit_id=ids[0], article=check.get("article")
            )
    for theme in ("weight", "dimensions", "protection"):
        for item in checklist.get(theme, []):
            if item.get("kind") == "rule" and item.get("status") == "fail":
                ids = item.get("unit_ids") or [None]
                return MainProblem(
                    kind="rule", code=item["code"], unit_id=ids[0], article=item.get("article")
                )
    # Batteries stored before the checklist existed: the axle loads alone.
    if not checklist:
        for load in battery.get("axle_loads", []):
            if load.get("load_kg", 0) > load.get("limit_kg", float("inf")):
                return MainProblem(
                    kind="rule",
                    code="axle",
                    unit_id=load.get("axle_group_id"),
                    article="CONTRAN 882/2021 art. 6",
                )
    return None
