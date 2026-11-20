"""Mechanical properties of lashing devices used when the scenario does not give them.

Sources and their confidence are listed in ``docs/physics-model.md``. Only the strap value
comes from a published figure; the chain and rope values are stated assumptions.
"""

from app.scenario import LashingKind

# Elongation at the lashing capacity LC, as a fraction of the length.
DEFAULT_ELONGATION_AT_LC: dict[LashingKind, float] = {
    # Web lashings stretch "generally around 5 %" at LC and may not exceed 7 % (EN 12195-2,
    # as quoted by UNECE and the IRU guidelines).
    LashingKind.STRAP: 0.05,
    # ASSUMPTION: no published elongation at LC was found for lashing chains. Steel chain is
    # far stiffer than webbing; 1 % is used (the discard limit is 3 % permanent elongation).
    LashingKind.CHAIN: 0.01,
    # ASSUMPTION: no published elongation was found for the polypropylene and sisal ropes
    # sold for trucks in Brazil. 15 % at the working load makes a rope three times as
    # stretchy as a strap, which is the qualitative behaviour ("medium" elongation on the
    # manufacturer's data sheet).
    LashingKind.ROPE: 0.15,
}

# Damping ratio of a lashing, relative to the mass of the unit it holds. Webbing and rope
# dissipate energy when stretched; this keeps the tension from ringing. Modelling choice.
LASHING_DAMPING_RATIO = 0.1
