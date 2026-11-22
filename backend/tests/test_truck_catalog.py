"""The truck drawings of the frontend come from the simulation's trucks."""

from app.explorer.build import TRUCKS
from scripts.export_truck_catalog import OUT, catalog, render


def test_frontend_catalog_is_up_to_date() -> None:
    assert OUT.read_text() == render(), "run: uv run python -m scripts.export_truck_catalog"


def test_drawn_axles_match_the_simulation() -> None:
    expected = {"vuc": 2, "three_quarter": 2, "toco": 2, "truck": 3, "semi": 6}
    expected |= {"us_box": 2, "us_straight": 3, "us_flatbed_48": 5, "us_dry_van_53": 5}
    expected |= {"us_step_deck": 5, "eu_7_5t": 2, "eu_18t": 2, "eu_26t": 3}
    expected |= {"eu_semi_136": 5, "eu_flatbed_136": 5}
    trucks = catalog()
    assert {size: truck["axle_count"] for size, truck in trucks.items()} == expected
    for size, spec in TRUCKS.items():
        truck = trucks[size.value]
        deck = truck["deck"]
        assert deck["length_m"] == spec.length_m
        assert deck["floor_m"] == spec.floor_height_m
        # The deck ends at the rear of the vehicle; the wheels are under the vehicle.
        assert truck["length_m"] == round(deck["front_x_m"] + spec.length_m, 3)
        xs = [axle["x_m"] for axle in truck["axles"]]
        assert xs == sorted(xs) and xs[0] > 0 and xs[-1] < truck["length_m"]


def test_gross_weights_are_the_presets_of_the_rules() -> None:
    trucks = catalog()
    # notes/eu-rules.md section 4 and notes/us-rules.md section 4.
    assert trucks["eu_7_5t"]["gvw_kg"] == 7500
    assert trucks["eu_18t"]["gvw_kg"] == 18000
    assert trucks["eu_26t"]["gvw_kg"] == 26000
    assert trucks["us_box"]["gvw_lb"] == 24900
    assert trucks["us_dry_van_53"]["gvw_lb"] == 79000
