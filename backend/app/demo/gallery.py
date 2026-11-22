"""The gallery: ready-made examples, each loaded the way it arrived and the way we fix it.

Every example is two explorer configurations that share the trip (speed, road, weather,
event) and the cargo, and differ in how the cargo is placed and secured. "Open in explorer"
opens exactly these configurations. The stories are written in ``frontend/messages``.
"""

from dataclasses import dataclass

from app.explorer import ExplorerConfig

_TRIP_FIELDS = (
    "speed_kmh",
    "road",
    "weather",
    "event",
    "size",
    "body",
    "cargo",
    "mass_kg",
    "country",
)


@dataclass(frozen=True)
class GalleryExample:
    id: str
    title: str
    summary: str
    as_loaded_name: str
    fixed_name: str
    as_loaded: ExplorerConfig
    fixed: ExplorerConfig

    def __post_init__(self) -> None:
        for field in _TRIP_FIELDS:
            if getattr(self.as_loaded, field) != getattr(self.fixed, field):
                raise ValueError(f"{self.id}: as loaded and fixed differ in {field}")


def _config(query: str) -> ExplorerConfig:
    return ExplorerConfig.from_query(dict(item.split("=", 1) for item in query.split("&")))


GALLERY: tuple[GalleryExample, ...] = (
    GalleryExample(
        id="emergency-braking",
        title="Emergency braking",
        summary=(
            "Three 900 kg pallets with one strap each: under emergency braking from 80 km/h "
            "they slide forward and the first one hits the headboard. With diagonal straps at "
            "each pallet's corners as well, which CONTRAN Resolution 945/2022 asks for on a "
            "flatbed, they stay put."
        ),
        as_loaded_name="Three pallets, one strap each",
        fixed_name="Three pallets, one strap over and four diagonal straps each",
        as_loaded=_config(
            "cargo=wood_pallet&position=gap&restraint=top_over&speed=80&event=emergency_braking"
            "&straps=1.1.1"
        ),
        fixed=_config(
            "cargo=wood_pallet&position=gap&restraint=direct&speed=80&event=emergency_braking"
            "&straps=1.1.1"
        ),
    ),
    GalleryExample(
        id="sharp-curve",
        title="Sharp curve",
        summary=(
            "Two tall cabinets standing free behind the headboard: in a sharp curve at 60 km/h "
            "they tip over. A strap over each one keeps it upright, and diagonal straps at its "
            "corners keep it from sliding over the headboard, which it stands above."
        ),
        as_loaded_name="Cabinets standing free",
        fixed_name="Cabinets under a strap each, with diagonal straps",
        as_loaded=_config(
            "cargo=tall_cabinet&position=headboard&restraint=none&speed=60&road=curvy"
            "&event=sharp_curve"
        ),
        fixed=_config(
            "cargo=tall_cabinet&position=headboard&restraint=direct&speed=60&road=curvy"
            "&event=sharp_curve&straps=1.1"
        ),
    ),
    GalleryExample(
        id="rope-lashing",
        title="Rope lashing",
        summary=(
            "Three stacks on plastic pallets tied down with rope: rope stretches and cannot be "
            "tightened enough, so the stacks slide in a sudden lane change. Rope is also "
            "prohibited as cargo lashing (CONTRAN Resolution 945/2022). Two ratchet straps over "
            "each stack and diagonal straps at its corners hold them."
        ),
        as_loaded_name="Stacks tied with rope",
        fixed_name="Stacks under ratchet straps, with diagonal straps",
        as_loaded=_config(
            "cargo=plastic_pallet&position=gap&restraint=rope&speed=80&event=lane_change"
            "&straps=2.2.2"
        ),
        fixed=_config(
            "cargo=plastic_pallet&position=gap&restraint=direct&speed=80&event=lane_change"
            "&straps=2.2.2"
        ),
    ),
    GalleryExample(
        id="steel-coil",
        title="Steel coil",
        summary=(
            "A 10 t steel coil lying across the bed with nothing in front of it: when the truck "
            "brakes on a wet road it rolls forward into the headboard. A cradle of two 20 cm "
            "chocks stops the roll, and four chains through the eye, forward and back, give it "
            "the lashing every unit needs."
        ),
        as_loaded_name="Coil standing free",
        fixed_name="Coil in a cradle, chained through the eye",
        as_loaded=_config(
            "size=truck&cargo=steel_coil&position=gap&restraint=none&speed=60&weather=wet"
            "&event=emergency_braking&moves=0_0.00_0.00"
        ),
        fixed=_config(
            "size=truck&cargo=steel_coil&position=gap&restraint=cradle_chain&speed=60"
            "&weather=wet&event=emergency_braking&straps=0&moves=0_0.00_0.00"
        ),
    ),
    GalleryExample(
        id="weigh-station",
        title="Weigh station",
        summary=(
            "An 8 t machine chained near the back: it holds over the speed bump, but the rear "
            "axle carries 11.9 t, above the 10 t legal limit, and the steering axle is left "
            "with 2.1 t. Moved forward, over the middle of the wheelbase, both axles are within "
            "their limits."
        ),
        as_loaded_name="Machine at the rear",
        fixed_name="Machine moved forward",
        as_loaded=_config(
            "cargo=machine&position=rear&restraint=chain&speed=20&road=urban&event=speed_bump"
            "&kg=8000&moves=0_-1.60_0.00"
        ),
        fixed=_config(
            "cargo=machine&position=rear&restraint=chain&speed=20&road=urban&event=speed_bump"
            "&kg=8000&moves=0_0.40_0.00"
        ),
    ),
    GalleryExample(
        id="box-truck",
        title="Box truck",
        summary=(
            "Six loose cartons at the back of a box truck: braking hard in the fog, they slide "
            "2.6 m and slam into the front wall far harder than it is built to take. Stacked "
            "against the front wall with a load bar behind them, they stay put."
        ),
        as_loaded_name="Loose cartons at the back",
        fixed_name="Cartons stacked against the front wall, load bar behind",
        as_loaded=_config(
            "body=box&size=vuc&cargo=stacked_boxes&position=rear&restraint=none&speed=50"
            "&road=urban&weather=fog&event=emergency_braking&n=6"
        ),
        fixed=_config(
            "body=box&size=vuc&cargo=stacked_boxes&position=stacked&restraint=blocking&speed=50"
            "&road=urban&weather=fog&event=emergency_braking&n=3"
        ),
    ),
    GalleryExample(
        id="dirt-road",
        title="Dirt road",
        summary=(
            "Pallets of sacks under three straps each: enough for an emergency stop on this "
            "dusty deck while the straps are tight. But the dirt road's vibration halves their "
            "tension, and the pallets slide when the truck brakes at the end. Diagonal straps, "
            "which hold by their strength rather than their tension, keep them in place."
        ),
        as_loaded_name="Three straps over each pallet",
        fixed_name="Diagonal straps at the corners",
        as_loaded=_config(
            "cargo=sacks&position=gap&restraint=top_over&speed=40&road=dirt"
            "&event=long_vibration&straps=3.3.3"
        ),
        fixed=_config(
            "cargo=sacks&position=gap&restraint=direct&speed=40&road=dirt&event=long_vibration"
        ),
    ),
    GalleryExample(
        id="anti-slip-mat",
        title="Anti-slip mat",
        summary=(
            "Plastic pallets on a plywood floor under two straps each: braking on a wet road, "
            "they slide, because plastic on plywood has a friction factor of only 0.2. On "
            "rubber anti-slip mats (0.6) the same two straps hold them, and diagonal straps at "
            "the corners, which Brazil asks for on a flatbed, keep the load within the rules."
        ),
        as_loaded_name="Plastic pallets on the bare floor",
        fixed_name="Plastic pallets on anti-slip mats, with diagonal straps",
        as_loaded=_config(
            "size=truck&cargo=plastic_pallet&position=gap&restraint=top_over&speed=60"
            "&weather=wet&event=emergency_braking"
        ),
        fixed=_config(
            "size=truck&cargo=plastic_pallet&position=gap&restraint=mat_direct&speed=60"
            "&weather=wet&event=emergency_braking&straps=2.2.2"
        ),
    ),
    GalleryExample(
        id="full-trip",
        title="Full trip",
        summary=(
            "Six crates of parts left unlashed because they are heavy, on a semi-trailer going "
            "down the mountain to the port in heavy rain: braking on the descent they creep "
            "forward, and the emergency stop at the end throws them on. Four diagonal straps "
            "per crate, forward and back on both sides, hold them for the whole trip."
        ),
        as_loaded_name="Crates without lashings",
        fixed_name="Crates with four diagonal straps each",
        as_loaded=_config(
            "size=semi&cargo=crate&position=gap&restraint=none&speed=60&road=mountain"
            "&weather=heavy_rain&event=full_trip&n=6"
        ),
        fixed=_config(
            "size=semi&cargo=crate&position=gap&restraint=direct&speed=60&road=mountain"
            "&weather=heavy_rain&event=full_trip&n=6&straps=0.0.0.0.0.0"
        ),
    ),
    GalleryExample(
        id="curtain-sider",
        title="Curtain-sider",
        summary=(
            "Drums of oil standing against one side of a light (3/4) curtain-sider with nothing "
            "over them: in a sharp curve at 60 km/h they slide across the deck, because the "
            "curtain is weather protection, not a restraint. In one row down the middle, just "
            "behind the headboard, each drum gets a strap over it and four diagonal straps to the "
            "rails on both sides, and no strap has to cross another drum."
        ),
        as_loaded_name="Drums against the curtain, no lashing",
        fixed_name="Drums in one row, a strap over and four diagonal straps each",
        as_loaded=_config(
            "body=curtain_sider&size=three_quarter&cargo=drum&position=side&restraint=none"
            "&speed=60&road=curvy&event=sharp_curve&n=6"
        ),
        fixed=_config(
            "body=curtain_sider&size=three_quarter&cargo=drum&position=side&restraint=direct"
            "&speed=60&road=curvy&event=sharp_curve&n=6&straps=1.1.1.1.1.1"
            "&moves=0_2.20_0.00*1_1.45_0.00*2_0.70_0.00*3_-0.05_0.00*4_-0.80_0.00*5_-1.55_0.00"
        ),
    ),
    GalleryExample(
        id="potholed-road",
        title="Potholed road",
        summary=(
            "Long steel pipes lying loose on a muddy deck, on a potholed road after rain: the "
            "pothole throws them up, they roll and slide into the headboard. Chains, forward "
            "and back on both sides of each pipe, hold them on any deck."
        ),
        as_loaded_name="Pipes lying loose",
        fixed_name="Pipes chained",
        as_loaded=_config(
            "size=truck&cargo=long_pipes&position=gap&restraint=none&speed=60&road=potholed"
            "&weather=mud&event=pothole"
        ),
        fixed=_config(
            "size=truck&cargo=long_pipes&position=gap&restraint=chain&speed=60&road=potholed"
            "&weather=mud&event=pothole"
        ),
    ),
    GalleryExample(
        id="overloaded-strap",
        title="Overloaded strap",
        summary=(
            "A 10 t steel coil held only by two straps over the top, on a semi-trailer: in an "
            "emergency stop from 80 km/h it rolls against the straps and pulls them past their "
            "rated capacity. A cradle stops the roll, and the same two straps only keep it in "
            "place."
        ),
        as_loaded_name="Coil under two straps",
        fixed_name="Coil in a cradle, two straps",
        as_loaded=_config(
            "size=semi&cargo=steel_coil&position=gap&restraint=top_over&speed=80"
            "&event=emergency_braking"
        ),
        fixed=_config(
            "size=semi&cargo=steel_coil&position=gap&restraint=cradle&speed=80"
            "&event=emergency_braking&straps=2"
        ),
    ),
    # US mode (2026-11-21): checked against 49 CFR 393 and 23 CFR 658 instead of CONTRAN.
    GalleryExample(
        id="us-steel-coils",
        title="Steel coils on a 48 ft flatbed (US rules)",
        summary=(
            "Two 9 t (19,800 lb) steel coils on a 48 ft flatbed, eyes crosswise, each under two "
            "straps over the top: in an emergency stop from 50 mph they roll, and 49 CFR 393.120 "
            "asks for a cradle and chains through the eye. In a cradle with four chains each, "
            "they hold in every situation and the load complies."
        ),
        as_loaded_name="Coils under two straps each",
        fixed_name="Coils in cradles, chained through the eye",
        as_loaded=_config(
            "size=us_flatbed_48&cargo=steel_coil&position=gap&restraint=top_over&speed=80"
            "&event=emergency_braking&n=2&kg=9000&moves=0_1.00_0.00*1_-1.00_0.00&country=US"
        ),
        fixed=_config(
            "size=us_flatbed_48&cargo=steel_coil&position=gap&restraint=cradle_chain&speed=80"
            "&event=emergency_braking&n=2&kg=9000&straps=0.0&moves=0_1.00_0.00*1_-1.00_0.00"
            "&country=US"
        ),
    ),
    # EU mode (2026-11-21): Directive 2014/47/EU Annex III and EN 12642 instead of CONTRAN.
    GalleryExample(
        id="eu-curtain-pallets",
        title="Pallets in a code L curtain-sider (EU rules)",
        summary=(
            "Eleven 700 kg pallets against the headboard of a 13.6 m code L curtain-sider, no "
            "lashing: in a sharp curve at 70 km/h they slide through the curtain and off the "
            "trailer. A code L curtain holds nothing (EN 12642), so a roadside check would class "
            "it a dangerous deficiency. On anti-slip mats with two straps over each pallet they "
            "hold in all seven situations and the load complies; a code XL body holds them only "
            "if the load fills its width."
        ),
        as_loaded_name="Eleven pallets, no lashing, code L curtains",
        fixed_name="Eleven pallets on mats, two straps each",
        as_loaded=_config(
            "body=curtain_sider&size=eu_semi_136&cargo=wood_pallet&position=headboard"
            "&restraint=none&speed=70&road=curvy&event=sharp_curve&n=11&kg=700&country=EU"
        ),
        fixed=_config(
            "body=curtain_sider&size=eu_semi_136&cargo=wood_pallet&position=headboard"
            "&restraint=mat&speed=70&road=curvy&event=sharp_curve&n=11&kg=700"
            "&straps=2.2.2.2.2.2.2.2.2.2.2&country=EU"
        ),
    ),
)
