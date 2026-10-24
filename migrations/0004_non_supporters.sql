-- Players who never had osu!supporter, ids only (see splitRankingPage in src/crawler.ts).
--
-- osu! only lets someone create a profile page ("me!") if they have or have had supporter (osu-web's checkUserPageEdit),
-- so these players can't have written one. From the second pass on, if the rankings show they still aren't
-- supporters, their profile doesn't need to be fetched.
--
-- Why it has to be recorded here: "has ever had supporter" (has_supported) only comes with the single-user API;
-- the rankings only include is_supporter (supporter right now), so it can only be noted while scanning profiles.
-- Players who buy supporter later show is_supporter = true in the rankings, get scanned as usual, and are removed
-- from this table at that point.

CREATE TABLE non_supporters (
    id INTEGER PRIMARY KEY
) WITHOUT ROWID;
