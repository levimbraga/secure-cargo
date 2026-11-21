-- The manager dashboard and the certificate (Phase 7, 2026-11-21).

-- Organization policies, set by the organization's managers (org_admin):
--   require_two_photos: an inspection needs at least 2 photos before its load is confirmed;
--   certificate_requires_compliance: no certificate for a load that holds but breaks a rule
--     (on by default; off, such a load gets a certificate that says it is out of compliance);
--   alert_after_hours: a load that fails or is out of compliance and has no proven fix after
--     this many hours is listed under the dashboard's alerts.
ALTER TABLE organizations ADD COLUMN require_two_photos INTEGER NOT NULL DEFAULT 0
    CHECK (require_two_photos IN (0, 1));
ALTER TABLE organizations ADD COLUMN certificate_requires_compliance INTEGER NOT NULL DEFAULT 1
    CHECK (certificate_requires_compliance IN (0, 1));
ALTER TABLE organizations ADD COLUMN alert_after_hours INTEGER NOT NULL DEFAULT 24
    CHECK (alert_after_hours BETWEEN 1 AND 720);

-- Summaries for the dashboard's filters and metrics, written when a load is confirmed and
-- simulated (src/summary.ts). Comma-wrapped lists (",unit_slid,anchoring,") so that a filter is
-- one LIKE; '' = none; NULL = not summarized yet (the cron fills those in).
ALTER TABLE inspections ADD COLUMN cargo_types TEXT;
ALTER TABLE inspections ADD COLUMN failure_codes TEXT;

-- The audit trail: who did what to an inspection, and when. `detail_json` holds the facts
-- (the AI reading's model, what the driver changed in the load, the verdict...).
CREATE TABLE inspection_events (
    id            TEXT PRIMARY KEY,
    inspection_id TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    actor_id      TEXT REFERENCES users (id),
    at            TEXT NOT NULL,
    kind          TEXT NOT NULL,
    detail_json   TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX inspection_events_inspection ON inspection_events (inspection_id, at);

-- Load certificates. `content_json` is the canonical record that was certified and
-- `content_hash` its SHA-256: the public verify page recomputes the hash from the stored
-- content, so a changed record no longer verifies.
CREATE TABLE certificates (
    id            TEXT PRIMARY KEY,                 -- e.g. SC-7KQ2-M9XD
    inspection_id TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    org_id        TEXT REFERENCES organizations (id),
    issued_by     TEXT NOT NULL REFERENCES users (id),
    issued_at     TEXT NOT NULL,
    content_json  TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    revoked_at    TEXT
);
CREATE INDEX certificates_inspection ON certificates (inspection_id, issued_at DESC);

-- Back-fill what can be read from the rows already there.
UPDATE inspections SET cargo_types = (
    SELECT ',' || group_concat(DISTINCT json_extract(u.value, '$.cargo')) || ','
    FROM scenarios s, json_each(s.draft_json, '$.units') u
    WHERE s.inspection_id = inspections.id AND s.kind = 'as_loaded'
);
INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
    SELECT 'evt_' || id || '_created', id, author_id, created_at, 'created', '{}' FROM inspections;
INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
    SELECT 'evt_' || id || '_photo', inspection_id, NULL, created_at, 'photo_added',
           json_object('position', position, 'sha256', sha256)
    FROM photos;
INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
    SELECT 'evt_' || s.id || '_confirmed', s.inspection_id, s.created_by, s.created_at, 'load_confirmed',
           json_object('units', json_array_length(s.draft_json, '$.units'))
    FROM scenarios s WHERE s.kind = 'as_loaded';
INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
    SELECT 'evt_' || i.id || '_simulated', i.id, i.author_id,
           (SELECT MIN(r.created_at) FROM results r JOIN scenarios s ON s.id = r.scenario_id
            WHERE r.inspection_id = i.id AND s.kind = 'as_loaded'),
           'simulated',
           json_object('verdict', i.verdict, 'passed', i.situations_passed, 'total', i.situations_total)
    FROM inspections i
    WHERE i.verdict IS NOT NULL AND EXISTS (SELECT 1 FROM results r WHERE r.inspection_id = i.id);
INSERT INTO inspection_events (id, inspection_id, actor_id, at, kind, detail_json)
    SELECT 'evt_' || f.id || '_fixed', f.inspection_id, s.created_by, f.created_at, 'fix_simulated',
           json_object('verdict', i.fixed_verdict, 'changes', json_array_length(f.changes_json))
    FROM fixes f JOIN scenarios s ON s.id = f.to_scenario_id JOIN inspections i ON i.id = f.inspection_id;
