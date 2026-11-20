"""The explorer: configuration -> load draft -> scenario, and its API."""

import itertools

import pytest
from fastapi.testclient import TestClient

from app.demo import load_demo_scenarios
from app.explorer import (
    BuildError,
    Cargo,
    ExplorerConfig,
    LoadDraft,
    Position,
    Restraint,
    Size,
    build,
    build_draft,
    draft_from_config,
)
from app.explorer.config import UnitMove
from app.scenario import (
    BodyType,
    EventKind,
    LashingKind,
    LashingRouting,
    RoadSurface,
    Scenario,
)


def config(query: str) -> ExplorerConfig:
    return ExplorerConfig.from_query(dict(item.split("=", 1) for item in query.split("&")))


def test_the_default_configuration_has_a_short_canonical_query() -> None:
    assert ExplorerConfig().to_query() == (
        "body=flatbed&size=toco&cargo=wood_pallet&position=gap&restraint=top_over&speed=80"
        "&road=straight&weather=dry&event=emergency_braking"
    )


def test_the_query_round_trips_with_edits() -> None:
    edited = ExplorerConfig(
        cargo=Cargo.CRATE,
        count=2,
        mass_kg=1200,
        straps=(3, 0),
        moves=(UnitMove(index=0, x_m=-0.4, y_m=0.0), UnitMove(index=1, x_m=1.25, y_m=-0.004)),
    )
    query = edited.to_query()
    assert query.endswith("&n=2&kg=1200&straps=3.0&moves=0_-0.40_0.00*1_1.25_0.00")
    # Every character survives URL encoding unchanged.
    assert all(char.isalnum() or char in "=&_.-*" for char in query)
    assert config(query) == edited.model_copy(
        update={"moves": (edited.moves[0], UnitMove(index=1, x_m=1.25, y_m=0.0))}
    )


def test_unknown_parameters_are_refused() -> None:
    with pytest.raises(ValueError, match="unknown parameter"):
        config("cargo=crate&colour=red")


def test_every_combination_loads_or_says_why_not() -> None:
    reasons: set[str] = set()
    for body, size, cargo, position, restraint in itertools.product(
        BodyType, Size, Cargo, Position, Restraint
    ):
        try:
            built = build(
                ExplorerConfig(
                    body=body, size=size, cargo=cargo, position=position, restraint=restraint
                )
            )
        except BuildError as error:
            reasons.add(error.code)
            continue
        assert built.scenario.units
    # Six-metre pipes on short trucks, and stacking on round cargo.
    assert reasons == {"does_not_fit", "cannot_stack"}


def test_a_configuration_expands_to_a_draft_unit_by_unit() -> None:
    draft = draft_from_config(config("cargo=wood_pallet&position=gap&straps=1.2.0"))
    assert [(unit.id, unit.x_m, unit.straps) for unit in draft.units] == [
        ("pallet-1", 2.0, 1),
        ("pallet-2", 0.4, 2),
        ("pallet-3", -1.2, 0),
    ]


def test_a_stack_moves_as_one_and_its_straps_go_over_the_top() -> None:
    draft = draft_from_config(
        config("body=box&size=vuc&cargo=stacked_boxes&position=stacked&n=3&moves=1_0.50_0.00")
    )
    by_id = {unit.id: unit for unit in draft.units}
    assert by_id["carton-5"].on == "carton-2"
    assert (by_id["carton-5"].x_m, by_id["carton-2"].x_m) == (0.5, 0.5)
    assert by_id["carton-2"].straps == 0 and by_id["carton-5"].straps == 2


def test_each_restraint_secures_the_load_its_way() -> None:
    def scenario(restraint: str, cargo: str = "crate") -> Scenario:
        return build(config(f"cargo={cargo}&restraint={restraint}")).scenario

    rope = scenario("rope")
    assert {lashing.kind for lashing in rope.lashings} == {LashingKind.ROPE}
    chains = scenario("chain")
    assert {(item.kind, item.routing) for item in chains.lashings} == {
        (LashingKind.CHAIN, LashingRouting.DIRECT)
    }
    assert scenario("blocking").bed.blocks
    mats = scenario("mat")
    assert {unit.material.value for unit in mats.units} == {"rubber_mat"}
    cradle = scenario("cradle", "steel_coil")
    assert {block.kind.value for block in cradle.bed.blocks} == {"cradle"}


def test_the_road_and_weather_become_the_trip_event() -> None:
    event = build(config("road=dirt&weather=wet&event=full_trip&speed=50")).event
    assert event.road_surface is RoadSurface.MUD
    assert event.segments == [
        EventKind.LONG_VIBRATION,
        EventKind.POTHOLE,
        EventKind.EMERGENCY_BRAKING,
    ]
    fog = build(config("weather=fog&road=mountain&event=mountain_descent")).event
    assert fog.fog and fog.road_surface is RoadSurface.DRY
    assert fog.grade_percent == 8.0 and fog.curve_radius_m == 40.0


def test_a_draft_from_a_photo_can_mix_cargo_and_sizes() -> None:
    draft = LoadDraft.model_validate(
        {
            "source": "photo",
            "truck": {"size": "toco"},
            "restraint": "top_over",
            "units": [
                {"id": "a", "cargo": "machine", "x_m": 0.4, "y_m": 0.0, "straps": 0},
                {
                    "id": "b",
                    "cargo": "crate",
                    "size_m": [1.0, 1.0, 0.8],
                    "mass_kg": 600,
                    "x_m": -1.4,
                    "y_m": 0.0,
                    "straps": 2,
                },
            ],
        }
    )
    scenario, _ = build_draft(draft)
    assert [unit.size_m for unit in scenario.units] == [(2.0, 1.6, 1.2), (1.0, 1.0, 0.8)]
    assert len(scenario.lashings) == 2


@pytest.mark.parametrize(
    ("units", "code"),
    [
        ([{"x_m": 0.0}, {"x_m": 0.5}], "units_overlap"),
        ([{"x_m": 2.9}], "off_the_bed"),
        ([{"x_m": 0.0, "straps": 6}], "not_enough_anchors"),
    ],
)
def test_a_draft_that_cannot_be_loaded_says_why(units: list[dict[str, object]], code: str) -> None:
    draft = LoadDraft.model_validate(
        {
            "units": [
                {"id": f"u{index}", "cargo": "crate", "y_m": 0.0, **unit}
                for index, unit in enumerate(units)
            ]
        }
    )
    with pytest.raises(BuildError) as error:
        build_draft(draft)
    assert error.value.code == code


def test_the_gallery_examples_are_explorer_configurations() -> None:
    for demo in load_demo_scenarios():
        for variant in ("as_loaded", "fixed"):
            built = build(config(demo.explorer[variant]))
            assert built.scenario.units == demo.variant(variant).units
            assert built.scenario.lashings == demo.variant(variant).lashings
            assert built.event == demo.event


def test_get_explorer_returns_the_draft_scenario_and_live_model(client: TestClient) -> None:
    response = client.get("/explorer?cargo=crate&position=headboard&restraint=chain&speed=60")

    assert response.status_code == 200
    assert "max-age" in response.headers["cache-control"]
    body = response.json()
    assert body["query"].startswith("body=flatbed&size=toco&cargo=crate&position=headboard")
    assert [unit["id"] for unit in body["draft"]["units"]] == ["crate-1", "crate-2"]
    assert body["event"]["speed_kmh"] == 60
    assert body["live"]["mjcf"].startswith("<mujoco")


def test_get_explorer_explains_a_load_that_does_not_fit(client: TestClient) -> None:
    response = client.get("/explorer?size=vuc&cargo=long_pipes")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "does_not_fit"
    response = client.get("/explorer?cargo=anvil")
    assert response.json()["detail"]["code"] == "invalid_config"


def test_post_explorer_draft_builds_an_edited_load(client: TestClient) -> None:
    draft = draft_from_config(ExplorerConfig()).model_dump(mode="json")
    draft["units"][0]["x_m"] = 1.6  # moved back, against the second pallet's gap
    draft["units"][0]["straps"] = 3

    response = client.post("/explorer/draft", json={"draft": draft})

    assert response.status_code == 200
    body = response.json()
    assert body["query"] is None
    assert body["scenario"]["units"][0]["position_m"][0] == 1.6
    assert (
        len([item for item in body["scenario"]["lashings"] if item["unit_id"] == "pallet-1"]) == 3
    )
