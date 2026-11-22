-- Contact form (2026-11-21): a per-IP limit of 5 messages per hour. The Workers rate-limiting
-- binding only counts over 10 or 60 seconds, so the hourly window is counted here. The key is an
-- HMAC of the IP address (never the address itself); rows older than two hours are deleted by the
-- hourly cron. Messages themselves are not stored: they are only emailed.
CREATE TABLE contact_rate (
	ip_hash TEXT NOT NULL,
	window_start TEXT NOT NULL,
	count INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (ip_hash, window_start)
);
