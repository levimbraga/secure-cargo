"""Pass / warning / fail thresholds and the verdict built from the metrics.

EN 12195-1 designs for no movement at all, so any real sliding is a failure. The thresholds
below only separate real movement from what a simulation with elastic contacts and elastic
lashings shows for a load that holds. They are engineering judgement, documented in
``docs/physics-model.md``.
"""

from physics.results import Finding, LashingResult, Status, UnitResult, Verdict

# Sliding below the first value is treated as "did not move": a load that holds by friction
# creeps well under a millimetre in the simulation.
SLIDE_WARNING_M = 0.010
# Beyond this the load has shifted: lashing angles and axle loads are no longer as planned.
SLIDE_FAIL_M = 0.050

TILT_WARNING_DEG = 1.0
TILT_FAIL_DEG = 5.0
# A cylinder lying on its side that moved and turned more than this about itself rolled
# rather than slid. 10 degrees of a 1.6 m coil is 14 cm of rolling.
ROLL_FAIL_DEG = 10.0

# A lashing must not be loaded beyond its rated capacity LC.
LASHING_WARNING_RATIO = 0.9
LASHING_FAIL_RATIO = 1.0


def build_verdict(
    units: list[UnitResult],
    lashings: list[LashingResult],
    *,
    headboard_capacity_n: float | None,
    extra_findings: list[Finding] | None = None,
) -> Verdict:
    findings: list[Finding] = []
    for unit in units:
        if unit.left_bed:
            findings.append(
                Finding(
                    code="unit_left_bed",
                    severity="fail",
                    unit_id=unit.id,
                    value=unit.max_slide_m,
                    limit=0.0,
                    message=f"Unit {unit.id} left the truck bed.",
                )
            )
        rolled = (
            unit.can_roll
            and unit.max_rotation_deg > ROLL_FAIL_DEG
            and unit.max_slide_m > SLIDE_FAIL_M
        )
        if rolled:
            findings.append(
                Finding(
                    code="unit_rolled",
                    severity="fail",
                    unit_id=unit.id,
                    value=unit.max_slide_m,
                    limit=SLIDE_FAIL_M,
                    message=f"Unit {unit.id} rolled {unit.max_slide_m * 100:.1f} cm.",
                )
            )
        elif unit.max_slide_m > SLIDE_WARNING_M:
            failed = unit.max_slide_m > SLIDE_FAIL_M
            findings.append(
                Finding(
                    code="unit_slid",
                    severity="fail" if failed else "warning",
                    unit_id=unit.id,
                    value=unit.max_slide_m,
                    limit=SLIDE_FAIL_M if failed else SLIDE_WARNING_M,
                    message=f"Unit {unit.id} slid {unit.max_slide_m * 100:.1f} cm.",
                )
            )
        if unit.max_tilt_deg > TILT_WARNING_DEG:
            failed = unit.max_tilt_deg > TILT_FAIL_DEG
            findings.append(
                Finding(
                    code="unit_tilted",
                    severity="fail" if failed else "warning",
                    unit_id=unit.id,
                    value=unit.max_tilt_deg,
                    limit=TILT_FAIL_DEG if failed else TILT_WARNING_DEG,
                    message=f"Unit {unit.id} tilted {unit.max_tilt_deg:.1f} degrees.",
                )
            )
        if unit.hit_headboard:
            findings.append(
                Finding(
                    code="unit_hit_headboard",
                    severity="fail",
                    unit_id=unit.id,
                    value=unit.peak_headboard_force_n,
                    limit=0.0,
                    message=(
                        f"Unit {unit.id} slid into the headboard with "
                        f"{unit.peak_headboard_force_n / 1000:.1f} kN."
                    ),
                )
            )
    if headboard_capacity_n is not None:
        total = sum(unit.peak_headboard_force_n for unit in units)
        if total > headboard_capacity_n:
            findings.append(
                Finding(
                    code="headboard_overloaded",
                    severity="fail",
                    value=total,
                    limit=headboard_capacity_n,
                    message=(
                        f"The headboard took {total / 1000:.1f} kN; it is rated for "
                        f"{headboard_capacity_n / 1000:.1f} kN."
                    ),
                )
            )
    for lashing in lashings:
        if lashing.broke_at_s is not None:
            findings.append(
                Finding(
                    code="lashing_broke",
                    severity="fail",
                    lashing_id=lashing.id,
                    unit_id=lashing.unit_id,
                    value=lashing.peak_force_n,
                    limit=lashing.lashing_capacity_n,
                    message=f"Lashing {lashing.id} broke at {lashing.broke_at_s:.2f} s.",
                )
            )
        elif lashing.peak_force_ratio > LASHING_WARNING_RATIO:
            failed = lashing.peak_force_ratio > LASHING_FAIL_RATIO
            findings.append(
                Finding(
                    code="lashing_overloaded",
                    severity="fail" if failed else "warning",
                    lashing_id=lashing.id,
                    unit_id=lashing.unit_id,
                    value=lashing.peak_force_n,
                    limit=lashing.lashing_capacity_n
                    * (LASHING_FAIL_RATIO if failed else LASHING_WARNING_RATIO),
                    message=(
                        f"Lashing {lashing.id} reached {lashing.peak_force_ratio * 100:.0f} % "
                        "of its rated capacity."
                    ),
                )
            )
    findings.extend(extra_findings or [])

    status: Status = "pass"
    if any(finding.severity == "fail" for finding in findings):
        status = "fail"
    elif findings:
        status = "warning"
    return Verdict(status=status, findings=findings)
