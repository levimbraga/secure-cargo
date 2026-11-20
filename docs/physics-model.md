# Physics model

How SecureCargo turns a loaded truck bed and a trip event into a verdict. The comparison with the
closed-form calculations of EN 12195-1 is in [validation.md](validation.md).

## Pipeline

```
scenario JSON ──► scene generator ──► MuJoCo model ──┐
(app/scenario)    (scene/mjcf.py)                    ├─► simulation ──► metrics ──► verdict + keyframes
trip event ─────► event profile ─────────────────────┘   (physics/simulate.py)     (physics/verdict.py)
                  (physics/conditions)
```

## Model

| Part | How it is modelled |
|---|---|
| Frame | X to the front of the truck, Y to its left, Z up; origin at the centre of the bed floor. SI units. |
| Truck bed | One body on three slide joints (X, Y, Z). Its motion is **prescribed**: at every step the simulation applies the force that gives the bed the acceleration of the event profile, cancelling the reaction of the cargo. The bed follows the profile within a micrometre (reported in every result as `bed_tracking_error_m`). |
| Cargo units | Free rigid boxes with uniform density, standing on the floor or on each other. |
| Contacts | MuJoCo soft contacts with an elliptic friction cone, one friction factor per material pair. Headboard and side rails block without friction. A frictionless road plane under the truck catches units that fall off; what happens to them on the road is not simulated. |
| Straps, chains, ropes | Spatial tendons with a tension-only spring. The rest length is shorter than the installed length, which creates the pretension; the stiffness is `LC / (elongation at LC x length)`. A rope is the same model with a lower capacity and more stretch. A lashing with a breaking strength snaps when it is exceeded. |
| Top-over lashing | Runs anchor, top edge, top edge, anchor. It presses the unit down and centres it sideways, and it is free to slide along the unit's length: it holds by friction only, which is the assumption of EN 12195-1. |
| Direct lashing | Runs from an anchor straight to a fixed point on the unit. |
| Pretensioning | Before the event the load settles and every lashing is tightened until it carries exactly the pretension of the scenario. |
| Integration | Fixed 2 ms step, implicit integrator, no randomness in the engine: the same input gives the same output. |
| Reference frame | The run happens in the inertial frame that moves with the truck's initial velocity, so only accelerations matter. A curve is a sideways acceleration of the bed; the truck's rotation is not modelled. A downhill grade is the equivalent constant forward pull `g sin(slope)`. |

## Numbers and where they come from

Confidence: **standard** = read in the standard or legal text, or in an official guide that reproduces
it; **published** = textbook, paper or manufacturer; **assumption** = a stated modelling choice with no
source.

### Design values and friction

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Design accelerations, road | 0.8 g forward, 0.5 g rearward, 0.5 g sideways, 1 g down | EN 12195-1:2010, Table 2 [1] | standard |
| Safety factor, frictional lashing | 1.25 forward, 1.1 otherwise | EN 12195-1:2010 [1], [2] | standard |
| Friction conversion for direct lashing | 0.75 | EN 12195-1:2010 [1] | standard |
| Friction factors | Annex B table (0.15 to 0.70; rubber mat 0.60) | EN 12195-1:2010 Annex B, as printed in [2] and [3] | standard |
| Wet surfaces | same factor as dry: the table holds for surfaces "dry or wet but clean" | Annex B footnote [2] | standard |
| Dirty surfaces | at most 0.2 | Annex B footnote [2] | standard |
| Material pair not in the table | at most 0.3 | CTU Code, Annex 7, Appendix 2 [4] | standard |

### Trip events

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Truck-tyre grip, dry / wet | 0.756 / 0.641 | Wong, *Theory of Ground Vehicles*, truck-tyre table [5] | published |
| Grip on gravel / wet earth road | 0.60 / 0.55 | Wong, general table [5] | published |
| Grip in heavy rain | 0.467 (wet sliding value) | no value found for standing water | assumption |
| Cargo friction on mud / gravel roads | capped at 0.2 / 0.3 (the deck is taken as not clean) | caps from [2] and [4]; that the deck is dirty is ours | assumption |
| Hardest braking | tyre grip, never above 0.8 g | [1], [5] | standard / published |
| Service braking | 0.35 g | road-design deceleration, FHWA [6] | standard |
| Brake build-up | 0.45 s | FMVSS 121, S5.3.3.1 [7] | standard |
| Fog | design reaction time (2.5 s instead of 1 s [6]), build-up in 0.22 s, emergency instead of service braking at obstacles | no source links fog to braking severity | assumption |
| Sideways limit | 0.5 g (loaded trucks roll over between 0.25 and 0.5 g) | [1]; Winkler, UMTRI [8] | standard / published |
| Lane change | one lane (3.66 m) in 61 m, one sine of sideways acceleration | geometry from FHWA [9] and SAE J2179; combination ours | assumption |
| Sharp curve | `v^2 / r`, radius 60 m unless given, 1 s to build up | radius and build-up ours | assumption |
| Pothole | 2.7 g vertical shock, 5 cm deep | shock measured on truck beds, FPL-22 [10]; depth ours | published / assumption |
| Speed bump | 3.70 m long, 0.10 m high (Type A); shock from the wheel path, capped at 5 g | Brazilian signalling manual, vol. VI [11]; cap from [10]; ignoring the suspension is ours | standard / assumption |
| Downhill grade | 8 % unless given | DNIT geometric design manual, 5.5.2 [12] | standard |
| Vibration, paved / unpaved | 0.17 g / 0.37 g RMS, 2 to 40 Hz | FPL-22 [10]; ASTM D4169 truck level III | published / assumption |
| Pretension left after long vibration | 50 % | no measured figure found; CONTRAN 945/2022 art. 4 §2 requires re-tightening [13] | assumption |

### Lashings

| Quantity | Value | Source | Confidence |
|---|---|---|---|
| Strap elongation at LC | 5 % (limit 7 %) | EN 12195-2 as quoted by UNECE and IRU [3] | standard |
| Chain elongation at LC | 1 % | none found | assumption |
| Rope elongation at working load | 15 % | none found | assumption |
| Axle load limits | 6 t, 10 t, 17 t, 25.5 t | CONTRAN Resolution 882/2021, art. 6 [14] | standard |

## What a result contains besides the verdict

- `margins`: largest slide against the fail limit, largest tilt, the largest share of the available
  friction any unit needed (`peak_friction_use`; 1.0 means sliding), and the busiest lashing's peak force
  as a fraction of its capacity LC, with the reserve left.
- `en_12195_1`: for each unit, the lashing EN 12195-1 asks for with its safety factor (1.25 forward,
  1.1 sideways and rearward for top-over lashing; `f_mu = 0.75` for direct lashing) against what is
  installed, per direction, for sliding and tipping. It is informative and does not change the verdict:
  the verdict says whether the load survived the simulated event, this says whether the lashing meets
  the standard. Computed in `backend/rules/en12195.py`.
- `axle_loads`: load per axle group against the legal limit, when the vehicle is described.
- `keyframes`: poses at 30 fps, plus what a replay needs to show the forces: the tension of every
  lashing, the solver's contact points with their normal forces, and the force of the floor on each
  unit. A sliding unit chatters on the floor (it leaves it and knocks back within milliseconds), so that
  force is exported as its average over each frame.

MuJoCo's own renderer can draw any run (`backend/scripts/render_demo_videos.py`): the frames are taken
during the run through a hook of the simulation, from the same model with a checkered ground and colours
added. A test compares the results with and without the hook and the visual additions: they are
identical.

## Verdict thresholds

EN 12195-1 designs for no movement. The thresholds separate real movement from elastic give and
numerical noise; they are engineering judgement.

| Metric | Warning | Fail |
|---|---|---|
| Slide on the bed | more than 1 cm | more than 5 cm |
| Tilt | more than 1° | more than 5° |
| Lashing force | above 90 % of LC | above LC, or the lashing broke |
| Unit left the bed, or slid into the headboard | | always |
| Headboard force | | above its rated capacity, when given |
| Axle group load | | above the legal limit |

A load that holds does not move in the simulation (0.0 mm in the validation runs), so the 1 cm line is
far from noise.

## Performance

CPU time per run, as reported by `POST /simulate` (`cpu_time_s`) on the production container
(Cloudflare Containers, instance type `basic`: a quarter of a vCPU), measured on 2026-11-20 with three
uncached runs each:

| Run | CPU time | Wall time of the request |
|---|---|---|
| The eight demo runs (3.2 to 5.4 s of simulated time) | 0.20 to 0.39 s | 0.6 to 1.6 s |
| Every event kind on the heaviest demo load (3 units, 10 lashings) | 0.20 to 0.62 s | 1.0 to 2.7 s |
| Longest event: mountain descent, 7.7 s of simulated time | 0.62 s | 2.7 s |
| A cached result | none | 0.3 s |

Wall time is longer than CPU time because the instance has a quarter of a core. A cold start of the
container adds about ten seconds once; the site replays the precomputed demo files, so visitors do not
wait for it. A test keeps the demo runs under one second of CPU (`tests/test_api_simulate.py`).

## Known limits

- Units are rigid, axis-aligned boxes with the centre of gravity in the middle.
- Top-over lashings do not restrain lengthwise (conservative, as in the standard).
- A lashing secures one unit; a strap over a stack is attached to the top unit.
- The truck does not roll, pitch or yaw; its suspension is not modelled.
- No published friction factor exists for cargo on cargo or for plank floors: the 0.3 fallback is used
  and reported in the result.
- The simulated bed is an idealisation of a real one: decision support, not certification.

## Sources

1. EN 12195-1:2010, *Load restraining on road vehicles. Safety. Part 1: Calculation of securing forces*
   (public preview: <https://cdn.standards.iteh.ai/samples/32961/4592590bcf194f1a8ffa917a5db7d258/SIST-EN-12195-1-2011.pdf>).
2. European Commission, *Cargo securing for road transport: 2014 European best practices guidelines*
   (<https://op.europa.eu/en/publication-detail/-/publication/30c7c1dc-f26e-44af-bd4c-2434b43edd7e>).
3. IRU, *International Guidelines on Safe Load Securing for Road Transport*
   (<https://www.iru.org/sites/default/files/2016-01/en-safe-load-securing-8th.pdf>).
4. IMO/ILO/UNECE, *CTU Code*, Annex 7, Appendix 2
   (<https://wiki.unece.org/spaces/TransportSustainableCTUCode/pages/23102057/Appendix+2.+Friction+factors>).
5. J. Y. Wong, *Theory of Ground Vehicles*, chapter 1
   (<https://catalogimages.wiley.com/images/db/pdf/9780470170380.excerpt.pdf>).
6. FHWA, *Speed Concepts: Informational Guide*, chapter 4
   (<https://highways.dot.gov/safety/speed-management/speed-concepts-informational-guide/chapter-4-engineering-and-technical>).
7. 49 CFR 571.121, *Air brake systems* (<https://www.ecfr.gov/current/title-49/section-571.121>).
8. C. Winkler, *Rollover of Heavy Commercial Vehicles*, UMTRI Research Review
   (<https://deepblue.lib.umich.edu/bitstreams/8b859107-0426-417c-83b3-2bfc6f633505/download>).
9. FHWA, *Comprehensive Truck Size and Weight Limits Study*, Appendix C
   (<https://ops.fhwa.dot.gov/freight/sw/map21tswstudy/technical_rpts/hstcanalysis/app_c_maneuv_stabl.htm>).
10. Ostrem and Godshall, *An Assessment of the Common Carrier Shipping Environment*, USDA FPL-22, 1979
    (<https://westpak.com/wp-content/uploads/2019/11/WESTPAK_FPL-22_Assessment_of_Common_Carrier_Shipping_Environment_Mar2015_v3.pdf>).
11. *Manual Brasileiro de Sinalização de Trânsito*, vol. VI, section 5.1
    (<https://www.gov.br/transportes/pt-br/assuntos/transito/arquivos-senatran/docs/copy_of___06___MBST_Vol._VI___Dispositivos_Auxiliares.pdf>).
12. DNER/DNIT, *Manual de Projeto Geométrico de Rodovias Rurais*, section 5.5.2
    (<https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-manuais/vigentes/706_manual_de_projeto_geometrico.pdf>).
13. CONTRAN Resolution 945/2022 (Brazilian rules for lashing cargo)
    (<https://www.in.gov.br/web/dou/-/resolucao-contran-n-945-de-28-de-marco-de-2022-390343667>).
14. CONTRAN Resolution 882/2021 (Brazilian limits for vehicle weights and dimensions), Diário Oficial
    da União, 2021-12-24.
