-- Contact form (2026-11-22): the browser sends an idempotency key with each submission; a second
-- request with the same key within 10 minutes is answered "sent" without sending the email again.
-- Only an HMAC of the key is kept; rows older than an hour are deleted by the hourly cron.
CREATE TABLE contact_dedupe (
	key_hash TEXT PRIMARY KEY,
	created_at TEXT NOT NULL
);
