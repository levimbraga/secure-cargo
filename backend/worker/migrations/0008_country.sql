-- US mode (2026-11-21): whose rules an inspection is checked against. The physics is the same;
-- the verdict and the planner's legal targets follow the country (backend/rules/country.py).
-- Existing inspections are Brazilian.
ALTER TABLE inspections ADD COLUMN country TEXT NOT NULL DEFAULT 'BR' CHECK (country IN ('BR', 'US'));
