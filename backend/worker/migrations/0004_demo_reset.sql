-- Demo reset: inspections made with demo accounts are deleted 24 h after creation by the
-- Worker's cron (src/purge.ts); the seeded ones (seed/demo.ts) are marked and kept.
ALTER TABLE inspections ADD COLUMN seeded INTEGER NOT NULL DEFAULT 0 CHECK (seeded IN (0, 1));
UPDATE inspections SET seeded = 1 WHERE id LIKE 'insp_demo_%';
