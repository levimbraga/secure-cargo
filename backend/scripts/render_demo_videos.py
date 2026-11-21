"""Render each demo run with MuJoCo's own renderer and write it as a short video.

The site shows these under the 3D replay as "Raw MuJoCo render": they come straight from the
physics engine, with its contact points, contact forces and tendons drawn by MuJoCo itself.
The frames are taken during the very run that produces the keyframes (same model, same
state), through the ``frame_hook`` of ``physics.simulate.simulate``.

    uv run python -m scripts.render_demo_videos

Needs an OpenGL backend for off-screen rendering (EGL by default; set ``MUJOCO_GL=osmesa``
otherwise) and ``ffmpeg`` with libx264 on the path. Output: ``frontend/public/demo/video/``.
"""

import os

os.environ.setdefault("MUJOCO_GL", "egl")

import subprocess
from pathlib import Path

import mujoco
import numpy as np

from app.demo import load_demo_scenarios
from app.demo.fixtures import VARIANTS
from physics.conditions import build_profile
from physics.constants import REPLAY_FPS, TIMESTEP_S
from physics.profile import MotionProfile
from physics.simulate import simulate
from scene.mjcf import BED_BODY, ROAD_GEOM

OUTPUT_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public" / "demo" / "video"
WIDTH, HEIGHT = 640, 400
# Camera azimuth per scenario [deg]: at 90 the camera is on the right side of the bed looking
# across it, at 0 it is behind looking forward. Side for braking, rear for sideways events.
AZIMUTH = {
    "emergency-braking": 62.0,
    "weigh-station": 62.0,
    "rope-lashing": 28.0,
    "sharp-curve": 28.0,
    "steel-coil": 62.0,
    "box-truck": 50.0,
    "dirt-road": 62.0,
    "anti-slip-mat": 62.0,
    "full-trip": 55.0,
    "curtain-sider": 28.0,
    "potholed-road": 62.0,
    "overloaded-strap": 62.0,
}
# Camera distance for the 6.2 m bed of a "toco"; longer beds are filmed from farther away.
DISTANCE_M = 8.6
REFERENCE_BED_M = 6.2


class Recorder:
    """Collects one rendered frame per keyframe, with the camera riding along with the bed."""

    def __init__(self, profile: MotionProfile, azimuth: float, distance: float) -> None:
        # Distance the truck has covered on the road at every time step [m].
        self.travelled = np.cumsum(profile.truck_speed_mps) * TIMESTEP_S
        self.azimuth = azimuth
        self.distance = distance
        self.renderer: mujoco.Renderer | None = None
        self.frames: list[bytes] = []

    def __call__(self, model: mujoco.MjModel, data: mujoco.MjData, t: float) -> None:
        if self.renderer is None:
            self.renderer = mujoco.Renderer(model, HEIGHT, WIDTH)
            self.camera = mujoco.MjvCamera()
            self.camera.type = mujoco.mjtCamera.mjCAMERA_TRACKING
            self.camera.trackbodyid = model.body(BED_BODY).id
            self.camera.distance = self.distance
            self.camera.azimuth = self.azimuth
            self.camera.elevation = -24.0
            self.options = mujoco.MjvOption()
            self.options.flags[mujoco.mjtVisFlag.mjVIS_CONTACTPOINT] = True
            self.options.flags[mujoco.mjtVisFlag.mjVIS_CONTACTFORCE] = True
            self.road = model.geom(ROAD_GEOM).id
            self.bed = model.body(BED_BODY).id
        self.renderer.update_scene(data, camera=self.camera, scene_option=self.options)

        # The simulation runs in the frame that moves with the truck's initial speed, where
        # the road plane stands still. For the picture, slide the (infinite, frictionless)
        # plane so that its checker passes under the truck at the truck's real speed. Only
        # the drawing changes: the plane of the physics model is not touched.
        step = min(round(t / TIMESTEP_S), len(self.travelled) - 1)
        scene = self.renderer.scene
        for index in range(scene.ngeom):
            geom = scene.geoms[index]
            if geom.objtype == mujoco.mjtObj.mjOBJ_GEOM and geom.objid == self.road:
                geom.pos[0] = data.xpos[self.bed][0] - self.travelled[step]
        self.frames.append(self.renderer.render().tobytes())


def encode(frames: list[bytes], path: Path) -> None:
    """H.264 in an MP4 container plays in every current browser, including on phones."""
    command = [
        "ffmpeg", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(REPLAY_FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "veryslow", "-crf", "31", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", "-an", str(path),
    ]  # fmt: skip
    subprocess.run(command, input=b"".join(frames), check=True)
    poster = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(path), "-frames:v", "1", "-q:v", "6"]
    subprocess.run([*poster, str(path.with_suffix(".jpg"))], check=True)


def main(only: list[str] | None = None) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for demo in load_demo_scenarios():
        if only and demo.id not in only:
            continue
        profile, surface = build_profile(demo.event)
        length = demo.as_loaded.bed.length_m
        distance = DISTANCE_M * max(1.0, length / REFERENCE_BED_M) ** 0.8
        for variant in VARIANTS:
            recorder = Recorder(profile, AZIMUTH[demo.id], distance)
            simulate(
                demo.variant(variant),
                profile,
                surface_friction_cap=surface.cargo_friction_cap,
                visual=True,
                frame_hook=recorder,
            )
            path = OUTPUT_DIR / f"{demo.id}.{variant}.mp4"
            encode(recorder.frames, path)
            size = path.stat().st_size / 1024
            print(f"wrote {path.name}: {len(recorder.frames)} frames, {size:.0f} kB")


if __name__ == "__main__":
    import sys

    main(sys.argv[1:] or None)
