"""The constants and profiles the 3D scene rebuilds the truck's motion from are current.

Run ``uv run python -m scripts.export_scene_motion`` after changing an event profile.
"""

from scripts.export_scene_motion import (
    CONSTANTS_FILE,
    PROFILES_FILE,
    render_constants,
    render_profiles,
)


def test_scene_constants_are_current() -> None:
    assert CONSTANTS_FILE.read_text() == render_constants()


def test_scene_profile_fixture_is_current() -> None:
    assert PROFILES_FILE.read_text() == render_profiles()
