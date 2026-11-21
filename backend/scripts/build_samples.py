"""The sample photos of the inspection flow, ready to run without login, API key or API.

For each sample: the photograph (resized to the 1568 px the vision model uses, metadata
removed, plates blurred where needed), its Claude vision analysis as recorded by the perception
evaluation for the current prompt version (``backend/worker/scripts/eval-perception.ts``, never
re-billed), the load draft on the confirmed truck with the sample's invoice weight, the battery
of seven situations, the planner's proven fix, and every situation's run with keyframes for the
replays:

    uv run python -m scripts.build_samples

Inputs: the workspace's photo set (``photos/stock/loads/``, credits in its manifest), outside
the public repository. Outputs: ``frontend/public/demo/samples/`` and the Worker's copy of the
analyses (``backend/worker/src/perception/samples.json``).
"""

import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.explorer.draft import DraftTruck
from app.inspection.battery import SITUATIONS, run_battery, scenario_for
from app.simulation_service import simulate_cached
from app.storage import create_storage
from perception.draft import PhotoAnalysis, Weight, analysis_to_draft
from planner.plan import BatteryResponse, Recommendation, plan, recommend

ROOT = Path(__file__).resolve().parents[2]
PHOTOS = ROOT.parent / "photos" / "stock" / "loads"
OUT = ROOT / "frontend" / "public" / "demo" / "samples"
WORKER_COPY = ROOT / "backend" / "worker" / "src" / "perception" / "samples.json"
MODEL = "claude-opus-5-5"
MAX_EDGE = 1568


def _prompt_version() -> str:
    """The Worker's prompt version: the evaluation caches its answers per version."""
    schema = (ROOT / "backend" / "worker" / "src" / "perception" / "schema.ts").read_text()
    match = re.search(r'PROMPT_VERSION = "(\w+)"', schema)
    assert match, "PROMPT_VERSION not found in the Worker's schema.ts"
    return match.group(1)


@dataclass(frozen=True)
class SampleSpec:
    id: str
    file: str
    title: tuple[str, str]  # English, Brazilian Portuguese
    story: tuple[str, str]
    truck: DraftTruck
    # A made-up invoice weight, plausible for what the photo shows.
    weight_kg: int
    position: str = "rear"


SAMPLES: tuple[SampleSpec, ...] = (
    SampleSpec(
        "crates-ropes",
        "plastic-crates-ropes-32444472.jpg",
        ("Crates tied with ropes", "Caixas amarradas com corda"),
        (
            "Stacks of plastic crates held only by ropes, which Brazilian rules prohibit.",
            "Pilhas de caixas plásticas presas só com cordas, proibidas pelas regras brasileiras.",
        ),
        DraftTruck(body="flatbed", size="truck", style="open_low_sides"),
        4200,
        "left",
    ),
    SampleSpec(
        "steel-pipes",
        "green-pipes-straps-N53wfGqwtNQ.jpg",
        ("Steel pipes with straps", "Tubos de aço com cintas"),
        (
            "Long steel pipes under ratchet straps: do they hold in a hard stop?",
            "Tubos de aço longos sob cintas com catraca: aguentam uma frenagem forte?",
        ),
        DraftTruck(body="flatbed", size="semi", style="open_low_sides"),
        18000,
    ),
    SampleSpec(
        "backhoe-chains",
        "backhoe-lowbed-38095094.jpg",
        ("A backhoe on a low-bed", "Retroescavadeira em prancha"),
        (
            "A machine chained to a trailer: chains, axle loads and the rules.",
            "Uma máquina acorrentada à carreta: correntes, carga por eixo e as regras.",
        ),
        DraftTruck(body="flatbed", size="semi", style="platform"),
        8500,
        "left",
    ),
    SampleSpec(
        "lumber-straps",
        "lumber-strapped-semi-99HLgU4IHLY.jpg",
        ("Lumber, strapped", "Madeira serrada, com cintas"),
        (
            "Packages of lumber under straps on a semi-trailer.",
            "Pacotes de madeira serrada sob cintas numa carreta.",
        ),
        DraftTruck(body="flatbed", size="semi", style="open_low_sides"),
        12000,  # about 0.58 t/m³ over the packages the draft keeps: sawn pine
    ),
    # The three verdict states need a load that is approved and one that holds but is out of
    # compliance (2026-11-21).
    SampleSpec(
        "concrete-pipes",
        "concrete-pipes-crane-truck-DM5ZHQJvaE4.jpg",
        ("Concrete pipes, chained", "Tubos de concreto acorrentados"),
        (
            "Concrete pipes lying across a crane truck, held down with chains.",
            "Tubos de concreto deitados num caminhão com guindaste, presos com correntes.",
        ),
        DraftTruck(body="flatbed", size="truck", style="open_low_sides"),
        11200,  # four pipes of about 2.8 t: a 1.2 m reinforced pipe, 2.5 m long
        "left",
    ),
    SampleSpec(
        "steel-racks",
        "steel-posts-racks-semi-32126810.jpg",
        ("Steel racks on a semi-trailer", "Racks de aço numa carreta"),
        (
            "Five racks of steel posts, chained: they hold, but is the weight legal?",
            "Cinco racks de postes de aço com correntes: aguentam, mas o peso está dentro da lei?",
        ),
        DraftTruck(body="flatbed", size="semi", style="platform"),
        22400,  # about 4.5 t per rack of steel posts
        "left",
    ),
)


def _process_photo(source: Path, target: Path, blur: list[float] | None) -> tuple[int, int]:
    """Resize (long edge 1568 px), blur a region if asked, drop all metadata; JPEG q≈85."""
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            str(source),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    width, height = (int(v) for v in probe.stdout.strip().split(","))
    scale = min(1.0, MAX_EDGE / max(width, height))
    w, h = round(width * scale / 2) * 2, round(height * scale / 2) * 2
    chain = f"[0:v]scale={w}:{h}[base]"
    if blur:
        x0, y0, x1, y1 = blur
        bx, by = int(x0 * w), int(y0 * h)
        bw, bh = max(8, int((x1 - x0) * w)), max(8, int((y1 - y0) * h))
        chain += (
            f";[base]split[a][b];[b]crop={bw}:{bh}:{bx}:{by},boxblur=12:4[blur];"
            f"[a][blur]overlay={bx}:{by}[out]"
        )
        label = "[out]"
    else:
        label = "[base]"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-filter_complex",
            chain,
            "-map",
            label,
            "-map_metadata",
            "-1",
            "-q:v",
            "3",
            str(target),
        ],
        check=True,
    )
    return w, h


def _write(path: Path, document: object) -> None:
    path.write_text(json.dumps(document, separators=(",", ":"), ensure_ascii=False) + "\n")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {p["file"]: p for p in json.loads((PHOTOS / "manifest.json").read_text())}
    storage = create_storage("memory://")
    answers = PHOTOS / "analyses" / f"prompt-v{_prompt_version()}"
    index = []
    worker: dict[str, object] = {}
    for spec in SAMPLES:
        photo = manifest[spec.file]
        recorded = json.loads((answers / MODEL / f"{spec.file}.json").read_text())
        analysis = PhotoAnalysis.model_validate(recorded["analysis"])

        image = OUT / f"{spec.id}.jpg"
        blur = photo.get("blur_region") if photo.get("needs_blur") else None
        width, height = _process_photo(PHOTOS / spec.file, image, blur)
        sha256 = hashlib.sha256(image.read_bytes()).hexdigest()
        path = f"/demo/samples/{spec.id}.jpg"

        perception = analysis_to_draft(analysis, spec.truck, Weight(total_kg=spec.weight_kg))
        draft = perception.draft
        loaded = run_battery(storage, draft)
        fixed_draft, changes = recommend(draft)
        battery = BatteryResponse(
            **loaded.model_dump(), recommendation=Recommendation(draft=fixed_draft, changes=changes)
        )
        fix = plan(storage, draft)
        assert fix.battery is not None

        runs: dict[str, dict[str, str]] = {"as_loaded": {}, "fixed": {}}
        run_dir = OUT / spec.id
        run_dir.mkdir(exist_ok=True)
        for variant, variant_draft in (("as_loaded", draft), ("fixed", fix.draft)):
            for situation in SITUATIONS:
                scenario, event = scenario_for(variant_draft, situation)
                result = simulate_cached(storage, scenario, event).result
                file = run_dir / f"{variant}.{situation.id}.json"
                _write(file, {"result": result.model_dump(mode="json")})
                runs[variant][situation.id] = f"/demo/samples/{spec.id}/{file.name}"

        credit = {
            "photographer": photo["photographer"],
            "url": photo["photo_page_url"],
            "source": photo["source"],
            "license": photo["license"],
        }
        summary = {
            "id": spec.id,
            "title": spec.title[0],
            "title_pt": spec.title[1],
            "story": spec.story[0],
            "story_pt": spec.story[1],
            "photos": [{"position": spec.position, "path": path, "width": width, "height": height}],
            "credit": credit,
            "weight_kg": spec.weight_kg,
            "truck": spec.truck.model_dump(mode="json", exclude_none=True),
            "passed": loaded.passed,
            "fixed_passed": fix.battery.passed,
        }
        index.append(summary)
        _write(
            OUT / f"{spec.id}.json",
            {
                **summary,
                "analysis": recorded["analysis"],
                "model": recorded["model"],
                "perception": perception.model_dump(mode="json"),
                "battery": battery.model_dump(mode="json"),
                "plan": fix.model_dump(mode="json"),
                "runs": runs,
            },
        )
        worker[spec.id] = {
            "id": spec.id,
            "photos": [{"position": spec.position, "path": path, "sha256": sha256}],
            "analysis": recorded["analysis"],
        }
        print(f"{spec.id}: {len(draft.units)} units, {loaded.passed}/7 -> {fix.battery.passed}/7")
    _write(OUT / "index.json", {"samples": index})
    WORKER_COPY.write_text(json.dumps(worker, indent=1, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
