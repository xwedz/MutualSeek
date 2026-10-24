-- Players who don't want to be on the candidate list ("Don't list me", see /api/listing in src/index.ts).
--
-- Only the player themselves can set it after logging in with osu!, so only their osu! user id is stored.
-- Setting it deletes them from players right away, and the scanner's save statement skips anyone listed here
-- (see src/crawler.ts), so they're never added back.
-- "Delete my data" keeps this record: deleting it would list them again on the next pass, the opposite of what they asked for.

CREATE TABLE opt_outs (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
) WITHOUT ROWID;
