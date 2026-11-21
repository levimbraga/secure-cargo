"""The three-state verdict: approved, holds but out of compliance, does not arrive intact."""

from app.inspection.verdict import verdict_of


def _situation(sid: str, *findings: dict) -> dict:
    return {"id": sid, "severity": 1.0 if findings else 0.0, "findings": list(findings)}


SLID = {"code": "unit_slid", "severity": "fail", "unit_id": "pallet-2", "value": 0.4, "limit": 0.05}
AXLE = {"code": "axle_overloaded", "severity": "fail", "axle_group_id": "rear"}
CREPT = {"code": "unit_slid", "severity": "warning", "unit_id": "pallet-1"}
ROPE = {"code": "devices_allowed", "status": "fail", "article": "Art. 4 §3", "unit_ids": ["c-1"]}
PASS = {"code": "devices_allowed", "status": "pass", "article": "Art. 4", "unit_ids": []}


def test_everything_holds_and_complies_is_approved() -> None:
    battery = {"situations": [_situation("emergency_braking", CREPT)], "contran_945": [PASS]}
    verdict = verdict_of(battery)
    assert verdict.state == "approved"
    assert verdict.main_problem is None


def test_a_rule_failure_on_a_load_that_holds_is_yellow_not_red() -> None:
    battery = {"situations": [_situation("emergency_braking")], "contran_945": [ROPE]}
    verdict = verdict_of(battery)
    assert verdict.state == "holds_noncompliant"
    assert verdict.main_problem is not None
    assert verdict.main_problem.code == "devices_allowed"
    assert verdict.main_problem.kind == "rule"


def test_an_axle_overload_is_a_rule_never_a_physics_failure() -> None:
    battery = {
        "situations": [_situation(s, AXLE) for s in ("emergency_braking", "lane_change")],
        "contran_945": [PASS],
        "axle_loads": [{"axle_group_id": "rear", "load_kg": 11_000, "limit_kg": 10_000}],
    }
    verdict = verdict_of(battery)
    assert verdict.state == "holds_noncompliant"
    assert verdict.physics_passed == 2
    assert verdict.main_problem is not None and verdict.main_problem.code == "axle"


def test_checklist_rules_count_and_advice_does_not() -> None:
    advice = {"code": "anti_slip_mat", "kind": "advice", "status": "advice"}
    too_tall = {"code": "height", "kind": "rule", "status": "fail", "article": "art. 4, II"}
    base = {"situations": [_situation("pothole")], "contran_945": [PASS]}
    assert verdict_of({**base, "checklist": {"protection": [advice]}}).state == "approved"
    assert (
        verdict_of({**base, "checklist": {"dimensions": [too_tall]}}).state == "holds_noncompliant"
    )


def test_any_physical_failure_is_red_and_names_the_situation_and_unit() -> None:
    battery = {
        "situations": [_situation("lane_change"), _situation("emergency_braking", SLID)],
        "contran_945": [ROPE],
    }
    verdict = verdict_of(battery)
    assert verdict.state == "fails"
    assert verdict.physics_passed == 1
    problem = verdict.main_problem
    assert problem is not None
    assert (problem.situation, problem.unit_id, problem.code) == (
        "emergency_braking",
        "pallet-2",
        "unit_slid",
    )


def test_a_to_confirm_headboard_is_not_a_violation() -> None:
    art8 = {"code": "above_headboard", "status": "to_confirm", "article": "Art. 8"}
    battery = {"situations": [_situation("pothole")], "contran_945": [art8]}
    assert verdict_of(battery).state == "approved"
