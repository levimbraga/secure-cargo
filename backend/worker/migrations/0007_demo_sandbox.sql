-- Demo visitors get Worker-issued sessions (no Clerk account), each with its own sandbox: they see
-- the seeded demo inspections plus only what their own sandbox made (src/demo.ts, src/authz.ts).
ALTER TABLE inspections ADD COLUMN sandbox_id TEXT;
CREATE INDEX inspections_sandbox ON inspections (sandbox_id) WHERE sandbox_id IS NOT NULL;
ALTER TABLE trucks ADD COLUMN sandbox_id TEXT;
-- The pre-minted Clerk sign-in tickets of the old demo accounts.
DROP TABLE IF EXISTS demo_tickets;
