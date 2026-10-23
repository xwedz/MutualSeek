-- 候選人列表的排序選單：依排名（pp 由高到低）、依粉絲數（由多到少），見 src/index.ts 的 /api/candidates。
--
-- 跟 0002、0003 的「最近上線」索引一樣，每種排序都要有自己的索引，查詢才能沿著索引讀到需要的那幾筆就停；
-- 沒有索引的話，選「All countries」時每看一頁都要把所有提到 mutual 的人讀一遍再排序（D1 依讀取列數計費）。
-- 依國家篩選時用「國家在前」的版本，可以直接跳到該國家。
--
-- 用 pp 而不是 global_rank 代表排名：兩者順序相同，但由大到小排序時空值會落在最後，
-- 不用另外處理「沒有排名的人被排到最前面」的問題。
--
-- 同樣是部分索引：只收錄提到 mutual 的人。players.id 就是 rowid，每個索引最後都隱含 id，
-- 所以「pp DESC, id DESC」這種加上 id 的穩定排序也能直接走索引。

CREATE INDEX players_mentions_pp ON players (pp) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_country_pp ON players (country_code, pp) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_followers ON players (follower_count) WHERE mutual_level = 'mention';
CREATE INDEX players_mentions_country_followers ON players (country_code, follower_count) WHERE mutual_level = 'mention';
