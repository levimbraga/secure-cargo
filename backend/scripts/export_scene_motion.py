"""Export what the 3D scene needs to rebuild the truck's motion from a simulation run.

The replay draws the truck on a road: it integrates the run's sideways acceleration into a
path, and rebuilds the vertical motion of the bed (pothole, speed bump, vibration) from the
same constants and markers the event profiles use. Those constants live here, in Python;
this script writes them for the frontend, together with a fixture of sampled event profiles
the frontend tests check the scene against:

    uv run python -m scripts.export_scene_motion

Output:

* ``frontend/lib/scene/sim-constants.json``: the constants (shipped with the site);
* ``frontend/lib/scene/__fixtures__/profiles.json``: every event on every surface, sampled
  at the replay's keyframe instants exactly as ``physics/simulate.py`` samples them (test only).

``tests/test_scene_motion_export.py`` fails when either file is out of date.
"""

import json
import math
from pathlib import Path

import numpy as np

from app.explorer.build import CURVE_RADIUS_M, TRIP_SEGMENTS
from app.scenario import EventKind, RoadSurface, TripEvent
from physics.conditions import events
from physics.conditions.events import build_profile
from physics.conditions.surfaces import SURFACES
from physics.constants import RANDOM_SEED, REPLAY_FPS, STANDARD_GRAVITY_MPS2, TIMESTEP_S
from physics.profile import MotionProfile

ROOT = Path(__file__).resolve().parents[2]
SCENE_DIR = ROOT / "frontend" / "lib" / "scene"
CONSTANTS_FILE = SCENE_DIR / "sim-constants.json"
PROFILES_FILE = SCENE_DIR / "__fixtures__" / "profiles.json"

SINGLE_EVENTS = [kind for kind in EventKind if kind is not EventKind.FULL_TRIP]


def vibration_tones() -> tuple[list[float], list[float]]:
    """Frequencies and phases of ``events._vibration``: the same generator and seed."""
    generator = np.random.default_rng(RANDOM_SEED)
    low, high = events.VIBRATION_BAND_HZ
    frequencies = np.geomspace(low, high, 24)
    phases = generator.uniform(0.0, 2 * math.pi, size=frequencies.size)
    return [float(f) for f in frequencies], [float(p) for p in phases]


def constants() -> dict[str, object]:
    frequencies, phases = vibration_tones()
    return {
        "source": "backend/physics/conditions (written by scripts/export_scene_motion.py)",
        "gravity_mps2": STANDARD_GRAVITY_MPS2,
        "timestep_s": TIMESTEP_S,
        "replay_fps": REPLAY_FPS,
        "lead_in_s": events.LEAD_IN_S,
        "lane_width_m": events.LANE_WIDTH_M,
        "lane_change_length_m": events.LANE_CHANGE_LENGTH_M,
        "default_curve_radius_m": events.DEFAULT_CURVE_RADIUS_M,
        "pothole": {
            "peak_g": events.POTHOLE_PEAK_G,
            "depth_m": events.POTHOLE_DEPTH_M,
            "length_m": events.POTHOLE_LENGTH_M,
        },
        "speed_bump": {
            "length_m": events.SPEED_BUMP_LENGTH_M,
            "height_m": events.SPEED_BUMP_HEIGHT_M,
            "ceiling_g": events.SHOCK_CEILING_G,
        },
        "long_vibration": {
            "duration_s": 3.0,
            "ramp_s": 0.3,
            "grms": events.ROAD_VIBRATION_GRMS,
        },
        "vibration": {"frequencies_hz": frequencies, "phases_rad": phases},
        "surfaces": {
            surface.value: {
                "tyre_friction": condition.tyre_friction,
                "cargo_friction_cap": condition.cargo_friction_cap,
                "roughness_grms": condition.roughness_grms,
            }
            for surface, condition in SURFACES.items()
        },
    }


def sampled_doc(profile: MotionProfile) -> dict[str, object]:
    """The parts of a keyframes document that come from the profile, at the same instants.

    Stored as columns to keep the fixture small: frame ``n`` is at ``n / fps``; the test
    turns the columns back into keyframes.
    """
    steps_per_frame = 1.0 / (REPLAY_FPS * TIMESTEP_S)
    indices = [0]
    frame = 1
    while round(frame * steps_per_frame) <= profile.steps:
        indices.append(round(frame * steps_per_frame) - 1)
        frame += 1
    speed = profile.truck_speed_mps[indices]
    accel = profile.acceleration_mps2[indices]
    return {
        "fps": REPLAY_FPS,
        "duration_s": round(profile.duration_s, 3),
        "events": [{"t": round(m.t, 4), "kind": m.kind} for m in profile.markers],
        "speed": [round(float(v), 3) for v in speed],
        "accel": [[round(float(a), 3) for a in accel[:, axis]] for axis in range(3)],
    }


def cases() -> list[tuple[str, TripEvent]]:
    found: list[tuple[str, TripEvent]] = []
    for kind in SINGLE_EVENTS:
        for surface in RoadSurface:
            event = TripEvent(kind=kind, speed_kmh=80, road_surface=surface)
            found.append((f"{kind.value}/{surface.value}/80", event))
        found.append((f"{kind.value}/dry/80/fog", TripEvent(kind=kind, speed_kmh=80, fog=True)))
    found.append(("speed_bump/dry/30", TripEvent(kind=EventKind.SPEED_BUMP, speed_kmh=30)))
    wet = TripEvent(kind=EventKind.LANE_CHANGE, speed_kmh=40, road_surface=RoadSurface.WET)
    found.append(("lane_change/wet/40", wet))
    found.append(
        (
            "sharp_curve/dry/40/r30",
            TripEvent(kind=EventKind.SHARP_CURVE, speed_kmh=40, curve_radius_m=30.0),
        )
    )
    found.append(("full_trip/dry/80/default", TripEvent(kind=EventKind.FULL_TRIP, speed_kmh=80)))
    for road, segments in TRIP_SEGMENTS.items():
        surface = RoadSurface.GRAVEL if road.value == "dirt" else RoadSurface.DRY
        found.append(
            (
                f"full_trip/{surface.value}/60/{road.value}",
                TripEvent(
                    kind=EventKind.FULL_TRIP,
                    speed_kmh=60,
                    road_surface=surface,
                    segments=segments,
                    curve_radius_m=CURVE_RADIUS_M[road],
                    grade_percent=8.0 if road.value == "mountain" else 3.0,
                ),
            )
        )
    return found


def profiles() -> list[dict[str, object]]:
    documents: list[dict[str, object]] = []
    for name, event in cases():
        profile, _ = build_profile(event)
        documents.append(
            {
                "name": name,
                "event": event.model_dump(mode="json", exclude_none=True),
                "profile": profile.parameters,
                "doc": sampled_doc(profile),
            }
        )
    return documents


# Significant digits written for the constants. numpy's geomspace and the trigonometry behind it
# differ in the last bit or two between machines (a laptop and a GitHub Actions runner wrote
# 7.356906069803281 and 7.356906069803285), so the file keeps 12 digits: far below anything the
# scene can show, and the same on every machine.
SIGNIFICANT_DIGITS = 12


def _stable(value: object) -> object:
    """``value`` with every float rounded to ``SIGNIFICANT_DIGITS`` significant digits."""
    if isinstance(value, float):
        return float(f"{value:.{SIGNIFICANT_DIGITS}g}")
    if isinstance(value, dict):
        return {key: _stable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_stable(item) for item in value]
    return value


def render_constants() -> str:
    return json.dumps(_stable(constants()), indent=2) + "\n"


def render_profiles() -> str:
    return json.dumps(profiles(), separators=(",", ":")) + "\n"


def main() -> None:
    PROFILES_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONSTANTS_FILE.write_text(render_constants())
    PROFILES_FILE.write_text(render_profiles())
    print(f"wrote {CONSTANTS_FILE.relative_to(ROOT)} and {PROFILES_FILE.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
