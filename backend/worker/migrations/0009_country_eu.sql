-- EU mode (2026-11-21): an inspection can be checked against the EU's rules too. SQLite cannot
-- change a column's CHECK constraint, so the column is rebuilt: a new column with the wider
-- constraint, filled from the old one, which is then dropped (a column whose only CHECK is its
-- own can be dropped) and the new one renamed. No other table refers to the column.
ALTER TABLE inspections ADD COLUMN rules_country TEXT NOT NULL DEFAULT 'BR' CHECK (rules_country IN ('BR', 'US', 'EU'));
UPDATE inspections SET rules_country = country;
ALTER TABLE inspections DROP COLUMN country;
ALTER TABLE inspections RENAME COLUMN rules_country TO country;
