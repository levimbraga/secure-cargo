-- The driver result experience (2026-11-21).
--
-- inspections.verdict / fixed_verdict now hold the three states of an inspection:
--   pass    = approved (arrives intact and complies)
--   warning = holds, but out of compliance (physics holds, a rule fails)
--   fail    = does not arrive intact (a physical failure in some situation)
--
-- truck_json: the truck as the driver confirmed it (size, body style, bed length, headboard
-- height, anchors, the saved truck it came from). truck_size keeps its old CHECK list, so a
-- "3/4" truck is only in truck_json (truck_size stays NULL for it).
ALTER TABLE inspections ADD COLUMN truck_json TEXT;
-- Where the cargo weight came from; an estimate is never shown as measured.
ALTER TABLE inspections ADD COLUMN weight_source TEXT
    CHECK (weight_source IN ('measured', 'invoice', 'estimated'));
-- For an estimated weight: {"low_kg": .., "high_kg": ..}; the battery runs at high_kg.
ALTER TABLE inspections ADD COLUMN weight_range_json TEXT;
-- The invoice (DANFE) reading: {"gross_kg": .., "text": "..", "photo_key": "..", "model": ".."}.
ALTER TABLE inspections ADD COLUMN invoice_json TEXT;
-- "I fixed it: take a new photo": the new inspection points to the one it re-checks.
ALTER TABLE inspections ADD COLUMN reinspection_of TEXT REFERENCES inspections (id) ON DELETE SET NULL;
CREATE INDEX inspections_reinspection ON inspections (reinspection_of);
-- A public summary link (no sign-in): an unguessable token, NULL when not shared.
ALTER TABLE inspections ADD COLUMN share_token TEXT;
CREATE UNIQUE INDEX inspections_share_token ON inspections (share_token);
-- Whether the public summary may show the driver's name (off unless the org allows it).
ALTER TABLE organizations ADD COLUMN share_driver_name INTEGER NOT NULL DEFAULT 0
    CHECK (share_driver_name IN (0, 1));

-- "My trucks": a driver saves a truck once and picks it before the photo. No plate required.
CREATE TABLE trucks (
    id                 TEXT PRIMARY KEY,
    owner_id           TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    org_id             TEXT REFERENCES organizations (id),
    nickname           TEXT NOT NULL DEFAULT '',
    size               TEXT NOT NULL CHECK (size IN ('vuc', 'three_quarter', 'toco', 'truck', 'semi')),
    style              TEXT NOT NULL
                       CHECK (style IN ('open_low_sides', 'open_tall_rack', 'platform', 'box', 'curtain_sider')),
    bed_length_m       REAL CHECK (bed_length_m BETWEEN 2 AND 15),
    headboard_height_m REAL CHECK (headboard_height_m > 0 AND headboard_height_m <= 4),
    anchors_per_side   INTEGER CHECK (anchors_per_side BETWEEN 2 AND 40),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);
CREATE INDEX trucks_owner ON trucks (owner_id, updated_at DESC);
