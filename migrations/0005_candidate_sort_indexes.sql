-- Sort options for the candidate list: by rank (pp, highest first) and by followers (most first),
-- see /api/candidates in src/index.ts.
--
-- Like the "recently online" indexes in 0002 and 0003, each order needs its own index so a query can read along it
-- and stop after the rows it needs. Without one, every page of "All countries" would read and sort every player who
-- mentions mutuals (D1 bills by rows read). Filtering by country uses the country-first versions, which jump
-- straight to that country.
--
-- pp stands in for global_rank: both give the same order, but sorting high-to-low puts missing values last,
-- so players without a rank don't end up at the top.
--
-- Also partial indexes holding only players who mention mutuals. players.id is the rowid, which every index
-- implicitly ends with, so stable orders such as "pp DESC, id DESC" can use them directly.

CREATE INDEX players_mentions_pp ON players (pp) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_country_pp ON players (country_code, pp) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_followers ON players (follower_count) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_country_followers ON players (country_code, follower_count) WHERE mutual_level = 'mention';
