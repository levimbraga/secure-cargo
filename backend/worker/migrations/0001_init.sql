-- SecureCargo records (Cloudflare D1 = SQLite).
--
-- Identities, organizations, org roles and invitations live in Clerk; the rows below mirror the
-- ids Clerk issues (`user_...`, `org_...`) so that every record can be scoped by author and
-- organization. Authorization is enforced by the Worker on every endpoint (src/authz.ts).
-- Timestamps are ISO 8601 UTC strings. Money is US dollars.

CREATE TABLE organizations (
    id                   TEXT PRIMARY KEY,                -- Clerk organization id
    name                 TEXT NOT NULL,
    type                 TEXT NOT NULL CHECK (type IN ('insurer', 'carrier')),
    daily_analysis_quota INTEGER CHECK (daily_analysis_quota >= 0), -- NULL: platform default
    is_demo              INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at           TEXT NOT NULL
);

CREATE TABLE users (
    id                   TEXT PRIMARY KEY,                -- Clerk user id
    email                TEXT,
    name                 TEXT,
    is_demo              INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    blocked              INTEGER NOT NULL DEFAULT 0 CHECK (blocked IN (0, 1)),
    daily_analysis_quota INTEGER CHECK (daily_analysis_quota >= 0), -- NULL: org or platform default
    created_at           TEXT NOT NULL,
    last_seen_at         TEXT
);
CREATE INDEX users_email ON users (email);

-- Mirror of the Clerk memberships seen in session tokens (Clerk stays the source of truth).
CREATE TABLE memberships (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    org_id     TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('member', 'org_admin')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, org_id)
);
CREATE INDEX memberships_org ON memberships (org_id);

CREATE TABLE inspections (
    id                 TEXT PRIMARY KEY,
    org_id             TEXT REFERENCES organizations (id), -- NULL: a personal inspection
    author_id          TEXT NOT NULL REFERENCES users (id),
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'analyzed', 'confirmed', 'simulated')),
    title              TEXT NOT NULL DEFAULT '',
    truck_body         TEXT CHECK (truck_body IN ('flatbed', 'box_truck', 'curtain_sider')),
    truck_size         TEXT CHECK (truck_size IN ('vuc', 'toco', 'truck', 'semi')),
    cargo_weight_kg    REAL CHECK (cargo_weight_kg > 0),
    notes              TEXT NOT NULL DEFAULT '',
    plate              TEXT,                               -- optional; the UI hides it by default
    -- Summary of the latest battery, for lists: "passes 4 of 7".
    situations_passed  INTEGER,
    situations_total   INTEGER,
    verdict            TEXT CHECK (verdict IN ('pass', 'warning', 'fail')),
    fixed_verdict      TEXT CHECK (fixed_verdict IN ('pass', 'warning', 'fail'))
);
CREATE INDEX inspections_author ON inspections (author_id, created_at DESC);
CREATE INDEX inspections_org ON inspections (org_id, created_at DESC);

CREATE TABLE photos (
    id             TEXT PRIMARY KEY,
    inspection_id  TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    position       TEXT NOT NULL CHECK (position IN ('front', 'left', 'right', 'rear', 'other')),
    r2_key         TEXT NOT NULL,                          -- private bucket; or a public sample path
    sha256         TEXT NOT NULL,
    content_type   TEXT NOT NULL,
    bytes          INTEGER NOT NULL,
    exif_stripped  INTEGER NOT NULL DEFAULT 0 CHECK (exif_stripped IN (0, 1)),
    created_at     TEXT NOT NULL
);
CREATE INDEX photos_inspection ON photos (inspection_id);
CREATE INDEX photos_sha256 ON photos (sha256);

-- Photo analyses are cached by (photo hash, model, prompt version): a repeated photo is never re-billed.
CREATE TABLE analyses (
    id             TEXT PRIMARY KEY,
    photo_sha256   TEXT NOT NULL,
    model          TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    output_json    TEXT NOT NULL,
    input_tokens   INTEGER NOT NULL,
    output_tokens  INTEGER NOT NULL,
    cost_usd       REAL NOT NULL,
    created_at     TEXT NOT NULL,
    UNIQUE (photo_sha256, model, prompt_version)
);

-- The user-confirmed load draft (the explorer's draft) of an inspection; versioned.
CREATE TABLE scenarios (
    id             TEXT PRIMARY KEY,
    inspection_id  TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('as_loaded', 'fixed')),
    draft_json     TEXT NOT NULL,
    created_by     TEXT NOT NULL REFERENCES users (id),
    created_at     TEXT NOT NULL
);
CREATE INDEX scenarios_inspection ON scenarios (inspection_id, created_at);

-- One row per simulated situation of a scenario.
CREATE TABLE results (
    id             TEXT PRIMARY KEY,
    inspection_id  TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    scenario_id    TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    situation      TEXT NOT NULL,                          -- e.g. emergency_braking
    verdict        TEXT NOT NULL CHECK (verdict IN ('pass', 'warning', 'fail')),
    metrics_json   TEXT NOT NULL DEFAULT '{}',
    keyframes_ref  TEXT,                                   -- R2 key or a static /demo/ path
    created_at     TEXT NOT NULL
);
CREATE INDEX results_inspection ON results (inspection_id);

CREATE TABLE fixes (
    id                TEXT PRIMARY KEY,
    inspection_id     TEXT NOT NULL REFERENCES inspections (id) ON DELETE CASCADE,
    from_scenario_id  TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    to_scenario_id    TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
    changes_json      TEXT NOT NULL DEFAULT '[]',
    passes            INTEGER NOT NULL CHECK (passes IN (0, 1)),
    created_at        TEXT NOT NULL
);
CREATE INDEX fixes_inspection ON fixes (inspection_id);

-- Every call that may cost money, with its estimated cost (the monthly cap is computed from here).
CREATE TABLE usage (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users (id),
    org_id         TEXT,
    kind           TEXT NOT NULL CHECK (kind IN ('photo_analysis')),
    model          TEXT,
    input_tokens   INTEGER NOT NULL DEFAULT 0,
    output_tokens  INTEGER NOT NULL DEFAULT 0,
    cost_usd       REAL NOT NULL DEFAULT 0,
    cached         INTEGER NOT NULL DEFAULT 0 CHECK (cached IN (0, 1)),
    is_demo        INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
    created_at     TEXT NOT NULL
);
CREATE INDEX usage_user ON usage (user_id, created_at);
CREATE INDEX usage_created ON usage (created_at);

-- Platform settings: kill switch, monthly cap, default quotas.
CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
INSERT INTO settings (key, value, updated_at) VALUES
    ('kill_switch', 'false', '2026-11-20T00:00:00.000Z'),
    ('monthly_cap_usd', '80', '2026-11-20T00:00:00.000Z'),
    ('default_daily_quota', '5', '2026-11-20T00:00:00.000Z'),
    ('demo_shared_daily_quota', '10', '2026-11-20T00:00:00.000Z');
