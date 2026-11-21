"""The rules layer: the same load checked against Brazil's or the United States' rules.

The physics does not change with the country; only the legal checks do. A battery carries the rule
set of both countries (``rule_sets``), so a page can switch country without a new simulation, and
``country`` (on the draft) says which one the inspection's verdict and the planner use.

* BR: CONTRAN Resolution 945/2022 (securing) and 882/2021 (weights, dimensions).
* US: 49 CFR 393 subpart I (securing), 23 CFR 658.17 (weights) and 658.15 / 393.87 (dimensions).
"""

from pydantic import BaseModel, ConfigDict

from app.explorer.config import Country
from app.explorer.draft import LoadDraft
from app.scenario import Scenario
from rules.checklist import Checklist, checklist
from rules.contran945 import check_contran_945
from rules.fmcsa393 import RuleCheck, check_fmcsa_393
from rules.us_checklist import us_checklist


class RuleSet(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    country: Country
    securing: list[RuleCheck]
    checklist: Checklist


def securing_checks(
    scenario: Scenario, draft: LoadDraft, country: Country, *, headboard_known: bool = True
) -> list[RuleCheck]:
    if country is Country.US:
        return check_fmcsa_393(
            scenario,
            draft,
            anchored_on_wood=draft.anchored_on_wood,
            headboard_known=headboard_known,
        )
    return [
        RuleCheck(
            code=c.code,
            article=f"CONTRAN 945/2022, {c.article}",
            status=c.status,
            unit_ids=c.unit_ids,
            message=c.message,
        )
        for c in check_contran_945(
            scenario, anchored_on_wood=draft.anchored_on_wood, headboard_known=headboard_known
        )
    ]


def rule_set(
    scenario: Scenario, draft: LoadDraft, country: Country, *, headboard_known: bool = True
) -> RuleSet:
    cargo = [u.cargo.value for u in draft.units]
    restraint = draft.restraint.value
    if country is Country.US:
        items = us_checklist(
            scenario,
            draft.truck.size,
            cargo=cargo,
            restraint=restraint,
            headboard_known=headboard_known,
        )
    else:
        items = checklist(
            scenario, cargo=cargo, restraint=restraint, headboard_known=headboard_known
        )
    return RuleSet(
        country=country,
        securing=securing_checks(scenario, draft, country, headboard_known=headboard_known),
        checklist=items,
    )


def rule_sets(
    scenario: Scenario, draft: LoadDraft, *, headboard_known: bool = True
) -> dict[Country, RuleSet]:
    return {
        country: rule_set(scenario, draft, country, headboard_known=headboard_known)
        for country in Country
    }


def breaks_a_rule(rules: RuleSet) -> bool:
    """A failing securing check or a failing legal item of the checklist."""
    if any(c.status == "fail" for c in rules.securing):
        return True
    themes = (rules.checklist.weight, rules.checklist.protection, rules.checklist.dimensions)
    return any(i.kind == "rule" and i.status == "fail" for items in themes for i in items)
