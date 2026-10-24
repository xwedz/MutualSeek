-- Adds a country filter to the candidate list (see /api/candidates in src/index.ts).
--
-- With only players_mentions (last_visit), filtering by country would read along that index through players from
-- every other country before finding enough from one country (tens of thousands of rows worldwide; D1 bills by rows read).
-- This index groups by country first and orders by last visit within it, so a query jumps straight to the country
-- and stops once it has enough rows.
--
-- Also a partial index: it only holds players who mention mutuals, so it costs very few writes.

CREATE INDEX players_mentions_country ON players (country_code, last_visit) WHERE mutual_level = 'mention';
