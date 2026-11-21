-- Sign-in tickets for the demo accounts, minted ahead of time so that "Enter as demo driver /
-- insurer" does not wait for Clerk. Each ticket is handed out once (DELETE ... RETURNING) and
-- the pool is refilled in the background. A ticket only signs in a public demo account.
CREATE TABLE demo_tickets (
    id         TEXT PRIMARY KEY,
    role       TEXT NOT NULL CHECK (role IN ('driver', 'insurer')),
    token      TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX demo_tickets_role ON demo_tickets (role, expires_at);
