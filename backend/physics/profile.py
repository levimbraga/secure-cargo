"""Prescribed motion of the truck bed during a trip event."""

from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from physics.constants import TIMESTEP_S

FloatArray = NDArray[np.float64]


@dataclass(frozen=True)
class Marker:
    """A moment worth showing on the replay timeline."""

    t: float
    kind: str


@dataclass(frozen=True)
class MotionProfile:
    """Bed acceleration over time, sampled every ``TIMESTEP_S``.

    ``acceleration_mps2`` has one row per time step with the bed's acceleration along X
    (forward), Y (left) and Z (up), in m/s^2. Braking is a negative X acceleration; the cargo
    then tends to move forward. The simulation runs in the inertial frame that moves with the
    truck's initial velocity, so only accelerations matter; ``truck_speed_mps`` is kept for
    the replay.
    """

    acceleration_mps2: FloatArray
    truck_speed_mps: FloatArray
    markers: tuple[Marker, ...] = ()
    # Fraction of the installed pretension still present at each step (vibration loosens
    # lashings). ``None`` means the pretension does not change.
    pretension_factor: FloatArray | None = None
    # Numbers the profile was built from, for the report (e.g. peak deceleration and why).
    parameters: dict[str, float | str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        steps = self.acceleration_mps2.shape[0]
        if self.acceleration_mps2.shape != (steps, 3) or self.truck_speed_mps.shape != (steps,):
            raise ValueError("profile arrays must have one row per time step")
        if self.pretension_factor is not None and self.pretension_factor.shape != (steps,):
            raise ValueError("pretension_factor must have one value per time step")

    @property
    def steps(self) -> int:
        return int(self.acceleration_mps2.shape[0])

    @property
    def duration_s(self) -> float:
        return self.steps * TIMESTEP_S


def constant_pulse(
    *,
    acceleration_mps2: tuple[float, float, float],
    hold_s: float,
    rise_s: float = 0.2,
    lead_in_s: float = 0.3,
    initial_speed_mps: float = 0.0,
) -> MotionProfile:
    """A ramp to a constant acceleration that is then held: the test pulse of the validation."""
    steps = round((lead_in_s + rise_s + hold_s) / TIMESTEP_S)
    t = np.arange(steps) * TIMESTEP_S
    envelope = np.clip((t - lead_in_s) / rise_s, 0.0, 1.0) if rise_s > 0 else (t >= lead_in_s) * 1.0
    acceleration = np.outer(envelope, np.asarray(acceleration_mps2, dtype=np.float64))
    speed = initial_speed_mps + np.cumsum(acceleration[:, 0]) * TIMESTEP_S
    return MotionProfile(
        acceleration_mps2=acceleration,
        truck_speed_mps=np.maximum(speed, 0.0),
        markers=(Marker(t=lead_in_s, kind="pulse_start"),),
    )
