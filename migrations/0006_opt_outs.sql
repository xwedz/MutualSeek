-- 不想出現在候選人列表的玩家（「Don't list me」，見 src/index.ts 的 /api/listing）。
--
-- 本人用 osu! 登入後才能設定，所以只存 osu! 的使用者 id。
-- 設定後立刻從 players 刪除，背景掃描存檔時也會排除這裡的人（見 src/crawler.ts），不會再被列出。
-- 「Delete my data」不會刪除這裡的紀錄：刪掉的話這個人反而會在下一輪被重新列出，跟他的意思相反。

CREATE TABLE opt_outs (
    id INTEGER PRIMARY KEY,
    created_at INTEGER NOT NULL
) WITHOUT ROWID;
