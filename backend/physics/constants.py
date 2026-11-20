"""Physical constants and solver settings shared by the physics modules.

Sources for every number are listed in ``docs/physics-model.md``.
"""

STANDARD_GRAVITY_MPS2 = 9.81  # the value EN 12195-1 uses in its formulas

# Fixed integration step. With a fixed step and a fixed seed the same input always gives
# the same output.
TIMESTEP_S = 0.002
REPLAY_FPS = 30
RANDOM_SEED = 20261104

# Bumped whenever a change to the model can change results; part of the cache key.
PHYSICS_MODEL_VERSION = "2"

# EN 12195-1:2010, Table 2: acceleration coefficients for road transport.
EN_CX_FORWARD = 0.8
EN_CX_REARWARD = 0.5
EN_CY_SLIDING = 0.5
EN_CZ = 1.0
# EN 12195-1:2010, safety factor for frictional lashing (forward / other directions).
EN_FS_FORWARD = 1.25
EN_FS_OTHER = 1.1
# EN 12195-1:2010, conversion factor applied to the friction factor in direct lashing.
EN_F_MU = 0.75
