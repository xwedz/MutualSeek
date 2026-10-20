-- 資料庫改成「只存有提到 mutual 的玩家」（見 src/crawler.ts 開頭的說明）。
--
-- 原因：擴大到所有國家後，排行榜上的活躍玩家約 37.5 萬人。把每個人都存進來，
-- 第一輪掃描時每天要寫入約 24 萬列，超過 D1 免費方案每天 10 萬列的上限。
-- 改成邊讀排行榜邊掃描，只保留提到 mutual 的人（約 9%），資料量和寫入量都降到十分之一以下。
--
-- 注意：0001_init.sql 已經套用過，所以不修改它，而是用這個新的 migration 調整。

-- 1. 刪除沒提到 mutual 的玩家（新設計不再保存他們）
DELETE FROM players WHERE mutual_level != 'mention';

-- 2. 掃描佇列不再需要：拿掉索引和欄位（欄位有索引時不能刪，所以先刪索引）
DROP INDEX players_scan_queue;
ALTER TABLE players DROP COLUMN scan_due_at;
ALTER TABLE players DROP COLUMN ranking_seen_at;

-- 3. 候選人列表的索引：舊的 (mutual_level, mutual_score) 是給「依分數排序」用的，已經對不上。
--    新索引本身就依最後上線時間排好序，查詢沿著索引讀到需要的 30 筆就停，不用全部讀出來排序
--    （D1 依「讀了幾列」計費）。
--    WHERE 讓它成為「部分索引」：只收錄提到 mutual 的人，查詢也必須帶相同條件才會用到它。
DROP INDEX players_candidates;
CREATE INDEX players_mentions ON players (last_visit) WHERE mutual_level = 'mention';
