-- The inspection flow (Phase 6): which analysis prefilled an inspection, and whether it was
-- made from one of the sample photos (no API cost, works without login).
ALTER TABLE inspections ADD COLUMN analysis_id TEXT REFERENCES analyses (id);
ALTER TABLE inspections ADD COLUMN sample TEXT;
-- Battery results are stored whole in R2 (results/<inspection>/<kind>.json); this is its key.
ALTER TABLE scenarios ADD COLUMN battery_ref TEXT;
