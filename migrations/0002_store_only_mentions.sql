-- The database now only keeps players who mention mutuals (see the notes at the top of src/crawler.ts).
--
-- Why: once every country is scanned, there are about 375,000 active players in the rankings. Storing all of them
-- would mean about 240,000 rows written a day during the first pass, over D1 Free's 100,000 a day.
-- Scanning while reading the rankings and keeping only those who mention mutuals (~9%) cuts storage and writes
-- to under a tenth.
--
-- Note: 0001_init.sql has already been applied, so it isn't edited; this migration adjusts it instead.

-- 1. Delete players who don't mention mutuals (the new design doesn't keep them)
DELETE FROM players WHERE mutual_level != 'mention';

-- 2. The scan queue is gone: drop its index and columns (an indexed column can't be dropped, so the index goes first)
DROP INDEX players_scan_queue;
ALTER TABLE players DROP COLUMN scan_due_at;
ALTER TABLE players DROP COLUMN ranking_seen_at;

-- 3. Candidate index: the old (mutual_level, mutual_score) served score ordering and no longer fits.
--    The new index is already ordered by last visit, so a query reads along it and stops after the rows it needs
--    instead of reading and sorting everything (D1 bills by rows read).
--    The WHERE makes it a partial index: it only holds players who mention mutuals, and queries must use the
--    same condition to use it.
DROP INDEX players_candidates;
CREATE INDEX players_mentions ON players (last_visit) WHERE mutual_level = 'mention';
