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


def test_a_mat_with_diagonal_straps_keeps_the_mat_and_adds_the_diagonals() -> None:
    scenario = build(config("cargo=plastic_pallet&restraint=mat_direct&straps=2.2.2")).scenario
    assert {unit.material.value for unit in scenario.units} == {"rubber_mat"}
    routings = [lashing.routing for lashing in scenario.lashings]
    assert routings.count(LashingRouting.TOP_OVER) == 6
    assert routings.count(LashingRouting.DIRECT) == 12


def test_units_side_by_side_share_one_strap_over_the_row() -> None:
    # Two drums abreast in each row: a strap from rail to rail goes over both.
    scenario = build(
        config("body=curtain_sider&size=three_quarter&cargo=drum&position=side&n=4&straps=2.2.2.2")
    ).scenario
    over = [x for x in scenario.lashings if x.routing is LashingRouting.TOP_OVER]
    assert len(over) == 4  # two per row, not two per drum
    for lashing in over:
        assert len(lashing.unit_ids) == 2
    # Every drum is under two straps.
    for unit in scenario.units:
        assert sum(unit.id in x.unit_ids for x in over) == 2


def test_a_diagonal_never_runs_through_the_unit_beside_it() -> None:
    # Two drums abreast per row, diagonal chains: seen from above, no chain crosses a drum.
    scenario = build(
        config("body=curtain_sider&size=three_quarter&cargo=drum&position=side&restraint=chain")
    ).scenario
    anchors = {a.id: a.position_m for a in scenario.bed.anchor_points}
    direct = [x for x in scenario.lashings if x.routing is LashingRouting.DIRECT]
    assert direct
    for lashing in direct:
        unit = next(u for u in scenario.units if u.id == lashing.unit_id)
        assert lashing.attachment_point_m is not None
        start = [unit.position_m[k] + lashing.attachment_point_m[k] for k in (0, 1)]
        end = anchors[lashing.anchor_ids[0]]
        for step in range(1, 100):
            x = start[0] + (end[0] - start[0]) * step / 100
            y = start[1] + (end[1] - start[1]) * step / 100
            for other in scenario.units:
                if other.id == unit.id:
                    continue
                inside = all(
                    abs(p - other.position_m[k]) < other.size_m[k] / 2 - 0.02
                    for k, p in ((0, x), (1, y))
                )
                assert not inside, (lashing.id, other.id)


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


def test_the_query_the_frontend_writes_for_an_edited_load_is_canonical_here_too() -> None:
    # The same string as frontend/lib/explorer/explorer.test.ts ("writes the edits back").
    query = (
        "body=flatbed&size=toco&cargo=wood_pallet&position=gap&restraint=top_over&speed=80"
        "&road=straight&weather=dry&event=emergency_braking&straps=2.1.1&moves=2_-1.85_0.00"
    )
    edited = config(query)
    assert edited.to_query() == query
    draft = build(edited).draft
    assert [(unit.x_m, unit.straps) for unit in draft.units] == [(2.0, 2), (0.4, 1), (-1.85, 1)]


def _one_crate(lashings: list[dict[str, object]], **extra: object) -> LoadDraft:
    """A crate on a toco, centred at x = 0 (lashing points every 0.4 m, ids L/R from the rear)."""
    return LoadDraft.model_validate(
        {
            "restraint": "top_over",
            **extra,
            "units": [
                {"id": "crate-1", "cargo": "crate", "x_m": 0.0, "y_m": 0.0, "straps": 2},
                {"id": "crate-2", "cargo": "crate", "x_m": -2.0, "y_m": 0.0, "straps": 1},
            ]
            if not lashings
            else [
                {
                    "id": "crate-1",
                    "cargo": "crate",
                    "x_m": 0.0,
                    "y_m": 0.0,
                    "straps": 2,
                    "lashings": lashings,
                },
                {"id": "crate-2", "cargo": "crate", "x_m": -2.0, "y_m": 0.0, "straps": 1},
            ],
        }
    )


def _pair_along(scenario: Scenario, x: float) -> list[str]:
    left = min(
        (a for a in scenario.bed.anchor_points if a.position_m[1] > 0),
        key=lambda a: abs(a.position_m[0] - x),
    )
    right = next(
        a
        for a in scenario.bed.anchor_points
        if a.position_m[1] < 0 and a.position_m[0] == left.position_m[0]
    )
    return [left.id, right.id]


def test_lashings_set_by_hand_replace_the_usual_ones_on_their_unit() -> None:
    scenario, _ = build_draft(_one_crate([]))
    pair = _pair_along(scenario, 0.0)
    rear_left = _pair_along(scenario, -1.0)[0]
    draft = _one_crate(
        [
            {"kind": "chain", "routing": "top_over", "anchors": pair},
            {"kind": "rope", "routing": "direct", "anchors": [rear_left], "corner": "rear_left"},
        ],
        restraint="direct",
    )
    built, _ = build_draft(draft)
    mine = [lashing for lashing in built.lashings if lashing.unit_id == "crate-1"]
    assert [(item.kind, item.routing) for item in mine] == [
        (LashingKind.CHAIN, LashingRouting.TOP_OVER),
        (LashingKind.ROPE, LashingRouting.DIRECT),
    ]
    assert mine[0].anchor_ids == pair
    assert mine[1].attachment_point_m == (-0.6, 0.5, 0.4)
    # The other crate keeps its strap and the restraint's four diagonals.
    assert len([lashing for lashing in built.lashings if lashing.unit_id == "crate-2"]) == 5


@pytest.mark.parametrize(
    ("lashing", "code"),
    [
        ({"routing": "top_over", "anchors": ["L0", "R0"]}, "lashing_misplaced"),
        ({"routing": "top_over", "anchors": ["L5", "L6"]}, "lashing_misplaced"),
        ({"routing": "direct", "anchors": ["X9"], "corner": "front_left"}, "unknown_anchor"),
    ],
)
def test_a_lashing_set_by_hand_must_reach_its_unit(lashing: dict[str, object], code: str) -> None:
    with pytest.raises(BuildError) as error:
        build_draft(_one_crate([lashing]))
    assert error.value.code == code


def test_a_lashing_set_by_hand_names_its_route() -> None:
    with pytest.raises(ValueError):
        _one_crate([{"routing": "direct", "anchors": ["L0"]}])
    with pytest.raises(ValueError):
        _one_crate([{"routing": "top_over", "anchors": ["L0"]}])
