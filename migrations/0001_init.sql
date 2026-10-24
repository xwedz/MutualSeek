-- All times are stored as Unix milliseconds (INTEGER), which keeps comparing and sorting simple.
-- last_visit can be null: the player hides their online status.

-- Players seen by the background scanner (where candidates come from).
CREATE TABLE players (
    id INTEGER PRIMARY KEY,               -- osu! user id
    username TEXT NOT NULL,
    avatar_url TEXT,
    country_code TEXT,
    global_rank INTEGER,
    country_rank INTEGER,
    pp REAL,
    last_visit INTEGER,
    pm_friends_only INTEGER NOT NULL DEFAULT 0, -- 1 = only accepts messages from friends, so add them before messaging
    follower_count INTEGER,               -- only available from the full profile
    ranking_seen_at INTEGER NOT NULL,     -- last time the player appeared in the rankings
    scanned_at INTEGER,                   -- last time the profile was scanned; null = never
    scan_due_at INTEGER,                  -- when the next scan is due; null = no need (not online for a long time)
    mutual_level TEXT NOT NULL DEFAULT 'none', -- none | weak | strong | negative (see src/detect.ts)
    mutual_score INTEGER NOT NULL DEFAULT 0,
    mutual_snippet TEXT                   -- the matching part of the profile, so users can see why someone was picked
);

-- Candidate list: only weak / strong, ordered by score.
CREATE INDEX players_candidates ON players (mutual_level, mutual_score);
-- Scan queue: every minute, find the next 15 players that are due.
-- D1 bills by rows read (5 million a day on the free plan); without this index every run would read the whole table.
CREATE INDEX players_scan_queue ON players (scan_due_at);

-- Users who logged in with osu!. Tokens are encrypted with AES-GCM before being stored (see src/tokenCrypto.ts).
CREATE TABLE accounts (
    osu_user_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    is_supporter INTEGER NOT NULL DEFAULT 0, -- determines the friend limit (500 / 1000)
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    last_synced_at INTEGER,               -- null = friend list never synced
    created_at INTEGER NOT NULL
);

-- Each user's current friend list, compared with the latest list from osu! on every sync.
CREATE TABLE friendships (
    account_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    country_code TEXT,
    last_visit INTEGER,
    mutual INTEGER NOT NULL,
    first_seen_at INTEGER,                -- first time seen on the list; null = already a friend before tracking started
    mutual_since INTEGER,                 -- when it became mutual; null may likewise mean before tracking started
    PRIMARY KEY (account_id, target_id)
) WITHOUT ROWID;

-- Friend list changes: who followed back, who removed the user.
CREATE TABLE friend_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    type TEXT NOT NULL,                   -- added | mutual | unmutual | removed
    at INTEGER NOT NULL
);

CREATE INDEX friend_events_account ON friend_events (account_id, at DESC);

-- Small key-value settings: scanner progress, the app's own cached token, etc.
CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
