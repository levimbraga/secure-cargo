"""The rules audit's remaining rows, listed in ``docs/coverage.md`` by ``scripts/coverage.py``."""

# ruff: noqa: E501

# What the rules audit of 2026-11-21 (workspace ``notes/rules-audit-matrix.csv``) found and the
# code does not do, or does by a reading of ours: (row, kind, what it means, source). Every one
# was checked against the gallery examples and the sample photos: none changes their verdicts.
RULE_LIMITATIONS: tuple[tuple[str, str, str, str], ...] = (
    (
        "BR-02",
        "assumption",
        "Brazil's law gives no design accelerations. We use the EN 12195-1 road values (0.8 g forward, 0.5 g back and sideways) for the simulation and for a lashing's limit (its LC).",
        "CONTRAN 945/2022 art. 3; EN 12195-1:2010 Table 2",
    ),
    (
        "BR-04",
        "assumption",
        "Art. 4's factor of 2: we add up the rated capacity of every strap and chain on a unit, and skip units held by blocking or a van's walls. The text says \"in the longitudinal direction\" and has no blocking exemption.",
        "CONTRAN 945/2022 art. 4",
    ),
    (
        "BR-05",
        "known limitation",
        "Whether straps are in good condition and can be re-tightened en route is not checked: a photo cannot show it.",
        "CONTRAN 945/2022 art. 4 §1",
    ),
    (
        "BR-11",
        "known limitation",
        "Straps passing outside the folding side rails are not checked.",
        "CONTRAN 945/2022 art. 6",
    ),
    (
        "BR-13",
        "assumption",
        'A load "does not fill the body length" when it has more than 15 cm to travel.',
        "CONTRAN 945/2022 art. 7",
    ),
    (
        "BR-14",
        "assumption",
        "Art. 7 sole paragraph applies to every open body we model (low sides, tall rack, platform): their rails and tailgate are not rated as containment.",
        "CONTRAN 945/2022 art. 7 sole paragraph",
    ),
    (
        "BR-15",
        "assumption",
        'Art. 8 gives no strength for a headboard. An unrated one is "to confirm"; a rated one is compared with the EN 12195-1 forward push, (0.8 - friction) x weight.',
        "CONTRAN 945/2022 art. 8",
    ),
    (
        "BR-19",
        "known limitation",
        "The number and spacing of the truck's lashing points are not checked (a property of the truck).",
        "CONTRAN 945/2022 Annex 3.2",
    ),
    (
        "BR-20",
        "known limitation",
        "The strength of each lashing point (800 / 1,000 / 2,000 daN) is checked in EU mode only.",
        "CONTRAN 945/2022 Annex 3.3",
    ),
    (
        "BR-22",
        "known limitation",
        "The CTB penalty of each failing check is not shown.",
        "CONTRAN 945/2022 art. 11",
    ),
    (
        "BR-23",
        "known limitation",
        "Loads under their own rule (indivisible cargo, dedicated vehicles) are not recognised as outside Resolution 945.",
        "CONTRAN 945/2022 art. 2 sole paragraph",
    ),
    (
        "BR-31",
        "assumption",
        "A Brazilian semi's tractor: steer axle 4.0 m ahead of the drive tandem, fifth wheel 0.30 m ahead of it, empty 4.8 t on the steer axle and 3.7 t on the tandem. No published figure for a typical 6x2 tractor was found.",
        "CONTRAN 882/2021 art. 6, II and V",
    ),
    (
        "BR-26",
        "assumption",
        "A semi is 4.0 m longer than its trailer's deck, so the preset (12.4 m) is above 16 m: PBTC 54.5 t.",
        "CONTRAN 882/2021 art. 6, I, c and d",
    ),
    (
        "BR-32",
        "known limitation",
        "The 7 t front axle and +1 t for trucks on gas, hybrid, electric or hydrogen power are not applied.",
        "CONTRAN 1015/2024",
    ),
    (
        "BR-39",
        "known limitation",
        "Vehicle length (14 m rigid, 19.3 m with a semi-trailer) is not checked; cargo past the deck already fails.",
        "CONTRAN 882/2021 art. 4, III",
    ),
    (
        "US-04",
        "known limitation",
        "The downward force of at least 20 % of the weight is not checked: it needs the tiedowns' installed tension.",
        "49 CFR 393.102(b)",
    ),
    (
        "US-03",
        "assumption",
        "The 0.435 g / 0.5 g / 0.25 g WLL case is a static force balance with the model's friction; the 0.8 g case uses the simulated tension against the breaking strength.",
        "49 CFR 393.102(a)",
    ),
    (
        "US-14",
        "assumption",
        "A US strap is a 2 in ratchet strap, WLL 3,335 lb, breaking at 10,000 lb; a chain breaks at 4 x its WLL. The simulation keeps the model's EN strap.",
        "49 CFR 393.108(b); WSTDA T-1 and NACM practice",
    ),
    (
        "US-21",
        "assumption",
        "A van's or headerboard's 393.114(c) rating is always \"to confirm\"; the simulation's wall finding uses 0.5 or 0.4 times the cargo's weight.",
        "49 CFR 393.114(c)",
    ),
    (
        "US-10",
        "assumption",
        "Edge protection is advice only: sharp edges do not show on a photo.",
        "49 CFR 393.104(f)(4)",
    ),
    (
        "US-12",
        "known limitation",
        "Articles side by side under the same tiedowns are not checked for a gap between them.",
        "49 CFR 393.106(c)(2)",
    ),
    (
        "US-15",
        "assumption",
        "Our rope is rated 225 lb, below the 625 lb the table gives an unmarked 1/2 in polypropylene rope.",
        "49 CFR 393.108(c)",
    ),
    (
        "US-16",
        "known limitation",
        "An unrated friction mat's credit (50 % of the weight on it) is not counted.",
        "49 CFR 393.108(g)",
    ),
    (
        "US-20",
        "known limitation",
        "The front end structure's width and penetration resistance are not checked.",
        "49 CFR 393.114(b)(2), (d)",
    ),
    (
        "US-23",
        "known limitation",
        "Dressed lumber in bundles: the spacer rules for two or more tiers are not checked (a photo cannot show them).",
        "49 CFR 393.118(d)",
    ),
    (
        "US-26",
        "known limitation",
        "An X pattern of chains through a coil's eye is not checked (the model has no such routing).",
        "49 CFR 393.120(c)(2)",
    ),
    (
        "US-27",
        "known limitation",
        "The specific rules for concrete pipe are not applied; the general ones are.",
        "49 CFR 393.124",
    ),
    (
        "US-42",
        "known limitation",
        "The lamps a projecting load needs at night are not mentioned.",
        "49 CFR 393.11 Table 1, footnotes 9-10",
    ),
    (
        "EU-07",
        "assumption",
        "Which column (minor, major, dangerous) each line of Table 1 falls in is our reading; an inspector decides case by case.",
        "Directive 2014/47/EU Annex III, II",
    ),
    (
        "EU-09",
        "assumption",
        "Friction alone towards an open side is classed dangerous: the cargo can leave the loading surface.",
        "Directive 2014/47/EU Art. 13(1)",
    ),
    (
        "EU-13",
        "assumption",
        "A fibre rope used as a lashing is an unsuitable device (major); no EU text bans ropes.",
        "Directive 2014/47/EU Annex III Table 1, 20.3.1",
    ),
    (
        "EU-14",
        "assumption",
        "Edge protection is advice only: sharp edges do not show on a photo.",
        "Directive 2014/47/EU Annex III Table 1, 20.3.5",
    ),
    (
        "EU-17",
        "assumption",
        "EN 12642 wall strengths come from the EU's 2014 guidelines; the standard itself is paywalled.",
        "EN 12642 via the European best practice guidelines (2014)",
    ),
    ("EU-18", "assumption", "A body with no EN 12642 code given is taken as code L.", "EN 12642"),
    (
        "EU-23",
        "assumption",
        "A tri-axle more than 1.4 m apart keeps the 24 t limit; the Directive stops at 1.4 m.",
        "Directive 96/53/EC Annex I 3.3",
    ),
    (
        "X-03",
        "assumption",
        "In Brazil and the US a box or curtain-sider's front wall is simulated as an EN 12642 code L wall (Brazil gives no figure; US mode re-judges it by 393.114(c)).",
        "EN 12642; CONTRAN 945/2022 art. 8",
    ),
    (
        "explorer",
        "known limitation",
        "The explorer and the live lab show the physics against EN 12195-1 ratings in every country; the inspection result uses each country's ratings.",
        "49 CFR 393.102(a), 393.114(c)",
    ),
)
