"""Smoke test: the MuJoCo wheel loads a model and steps it on this platform."""

import mujoco
import pytest

_FALLING_BOX = """
<mujoco>
  <option timestep="0.002"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <body name="box" pos="0 0 1">
      <freejoint/>
      <geom type="box" size="0.1 0.1 0.1" mass="10"/>
    </body>
  </worldbody>
</mujoco>
"""


def test_a_box_dropped_from_one_metre_comes_to_rest_on_the_floor() -> None:
    model = mujoco.MjModel.from_xml_string(_FALLING_BOX)
    data = mujoco.MjData(model)

    for _ in range(1500):  # 3 s at a 2 ms timestep
        mujoco.mj_step(model, data)

    box_height = float(data.body("box").xpos[2])
    assert box_height == pytest.approx(0.1, abs=5e-3)
