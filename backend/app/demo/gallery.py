"""The gallery: ready-made examples, each loaded the way it arrived and the way we fix it.

Every example is two explorer configurations that share the trip (speed, road, weather,
event) and the cargo, and differ in how the cargo is placed and secured. "Open in explorer"
opens exactly these configurations. The stories are written in ``frontend/messages``.
"""

from dataclasses import dataclass

from app.explorer import ExplorerConfig

_TRIP_FIELDS = ("speed_kmh", "road", "weather", "event", "size", "body", "cargo", "mass_kg")


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
            "they slide forward and the first one hits the headboard. With two straps each "
            "they stay put."
        ),
        as_loaded_name="Three pallets, one strap each",
        fixed_name="Three pallets, two straps each",
        as_loaded=_config(
            "cargo=wood_pallet&position=gap&restraint=top_over&speed=80&event=emergency_braking"
            "&straps=1.1.1"
        ),
        fixed=_config(
            "cargo=wood_pallet&position=gap&restraint=top_over&speed=80&event=emergency_braking"
            "&straps=2.2.2"
        ),
    ),
    GalleryExample(
        id="sharp-curve",
        title="Sharp curve",
        summary=(
            "Two tall cabinets standing free behind the headboard: in a sharp curve at 60 km/h "
            "they tip over. Two straps over each one keep them upright."
        ),
        as_loaded_name="Cabinets standing free",
        fixed_name="Cabinets under two straps each",
        as_loaded=_config(
            "cargo=tall_cabinet&position=headboard&restraint=none&speed=60&road=curvy"
            "&event=sharp_curve"
        ),
        fixed=_config(
            "cargo=tall_cabinet&position=headboard&restraint=top_over&speed=60&road=curvy"
            "&event=sharp_curve&straps=2.2"
        ),
    ),
    GalleryExample(
        id="rope-lashing",
        title="Rope lashing",
        summary=(
            "Three stacks on plastic pallets tied down with rope: rope stretches and cannot be "
            "tightened enough, so the stacks slide in a sudden lane change. Rope is also "
            "prohibited as cargo lashing (CONTRAN Resolution 945/2022). Anti-slip mats under "
            "the pallets and two ratchet straps per stack hold them."
        ),
        as_loaded_name="Stacks tied with rope",
        fixed_name="Stacks on anti-slip mats under ratchet straps",
        as_loaded=_config(
            "cargo=plastic_pallet&position=gap&restraint=rope&speed=80&event=lane_change"
            "&straps=2.2.2"
        ),
        fixed=_config(
            "cargo=plastic_pallet&position=gap&restraint=mat&speed=80&event=lane_change"
            "&straps=2.2.2"
        ),
    ),
    GalleryExample(
        id="steel-coil",
        title="Steel coil",
        summary=(
            "A 10 t steel coil lying across the bed with nothing in front of it: when the truck "
            "brakes on a wet road it rolls forward into the headboard. A cradle of two 20 cm "
            "chocks holds it."
        ),
        as_loaded_name="Coil standing free",
        fixed_name="Coil in a cradle",
        as_loaded=_config(
            "size=truck&cargo=steel_coil&position=gap&restraint=none&speed=60&weather=wet"
            "&event=emergency_braking&moves=0_0.00_0.00"
        ),
        fixed=_config(
            "size=truck&cargo=steel_coil&position=gap&restraint=cradle&speed=60&weather=wet"
            "&event=emergency_braking&moves=0_0.00_0.00"
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
            "rubber anti-slip mats (0.6) the same two straps hold them."
        ),
        as_loaded_name="Plastic pallets on the bare floor",
        fixed_name="Plastic pallets on anti-slip mats",
        as_loaded=_config(
            "size=truck&cargo=plastic_pallet&position=gap&restraint=top_over&speed=60"
            "&weather=wet&event=emergency_braking"
        ),
        fixed=_config(
            "size=truck&cargo=plastic_pallet&position=gap&restraint=mat&speed=60&weather=wet"
            "&event=emergency_braking"
        ),
    ),
    GalleryExample(
        id="full-trip",
        title="Full trip",
        summary=(
            "Six crates of parts left unlashed because they are heavy, on a semi-trailer going "
            "down the mountain to the port in heavy rain: braking on the descent they creep "
            "forward, and the emergency stop at the end throws them on. Three straps per crate, "
            "as EN 12195-1 asks, hold them for the whole trip."
        ),
        as_loaded_name="Crates without lashings",
        fixed_name="Crates under three straps each",
        as_loaded=_config(
            "size=semi&cargo=crate&position=gap&restraint=none&speed=60&road=mountain"
            "&weather=heavy_rain&event=full_trip&n=6"
        ),
        fixed=_config(
            "size=semi&cargo=crate&position=gap&restraint=top_over&speed=60&road=mountain"
            "&weather=heavy_rain&event=full_trip&n=6&straps=3.3.3.3.3.3"
        ),
    ),
)
