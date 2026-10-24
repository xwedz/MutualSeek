-- The candidate list is now shown in a shuffled order instead of being sorted by last visit, rank or followers
-- (see src/shuffle.ts and /api/candidates in src/index.ts).
--
-- Why: with five players per page and a fixed order, everyone who opened the same country saw the same five players
-- first, so a few players (often the highest ranked or most followed) would get most of the messages. Each user now
-- starts reading a random ring at their own point, which spreads attention across everyone listed.
--
-- shuffle_key is set once when a player is first stored and kept on later scans, so the ring doesn't change.
-- Existing players get one here.

ALTER TABLE players ADD COLUMN shuffle_key INTEGER NOT NULL DEFAULT 0;
UPDATE players SET shuffle_key = abs(random() % 1000000000);

-- The old sort orders are gone, so their indexes are dropped: every index costs an extra write each time the scanner
-- saves a player. (0002, 0003 and 0005)
DROP INDEX players_mentions;
DROP INDEX players_mentions_country;
DROP INDEX players_mentions_pp;
DROP INDEX players_mentions_country_pp;
DROP INDEX players_mentions_followers;
DROP INDEX players_mentions_country_followers;

-- Reading the ring: each half of the ring is a range scan along shuffle_key, so a page only reads the rows it needs.
-- The country-first version also serves the scanner's per-country cleanup and the hourly per-country counts, which
-- used players_mentions_country before. Partial indexes holding only players who mention mutuals, like before;
-- players.id is the rowid, which every index implicitly ends with, so "ORDER BY shuffle_key, id" can use them directly.
CREATE INDEX players_mentions_shuffle ON players (shuffle_key) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_country_shuffle ON players (country_code, shuffle_key) WHERE mutual_level = 'mention';
