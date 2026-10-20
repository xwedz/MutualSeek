-- 候選人列表加上「國家」篩選（見 src/index.ts 的 /api/candidates）。
--
-- 只有 players_mentions (last_visit) 的話，依國家篩選時資料庫必須沿著索引一路讀下去，
-- 把其他國家的人也讀過一遍才找得到 30 個同國家的人（全球規模約 3 萬多列，D1 依讀取列數計費）。
-- 這個索引先依國家分組、組內再依最後上線排序，查詢可以直接跳到該國家、讀到 30 筆就停。
--
-- 同樣是部分索引：只收錄提到 mutual 的人，寫入成本很小。

CREATE INDEX players_mentions_country ON players (country_code, last_visit) WHERE mutual_level = 'mention';
