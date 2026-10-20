-- 時間欄位一律存 Unix 毫秒（INTEGER），比較與排序都簡單；
-- last_visit 可能是 null：對方隱藏了上線狀態。

-- 背景掃描過的玩家（候選人來源）。
CREATE TABLE players (
    id INTEGER PRIMARY KEY,               -- osu! user id
    username TEXT NOT NULL,
    avatar_url TEXT,
    country_code TEXT,
    global_rank INTEGER,
    country_rank INTEGER,
    pp REAL,
    last_visit INTEGER,
    pm_friends_only INTEGER NOT NULL DEFAULT 0, -- 1 = 只收好友私訊，要先加好友才能私訊
    follower_count INTEGER,               -- 抓個人頁面時才拿得到
    ranking_seen_at INTEGER NOT NULL,     -- 最後一次出現在排行榜的時間
    scanned_at INTEGER,                   -- 最後一次掃描個人頁面的時間，null = 還沒掃過
    scan_due_at INTEGER,                  -- 下次該掃描的時間；null = 不用掃（很久沒上線）
    mutual_level TEXT NOT NULL DEFAULT 'none', -- none | weak | strong | negative（見 src/detect.ts）
    mutual_score INTEGER NOT NULL DEFAULT 0,
    mutual_snippet TEXT                   -- 個人頁面中命中的那一小段文字，讓使用者知道為什麼被選中
);

-- 候選人列表：只會查 weak / strong，再依分數排序。
CREATE INDEX players_candidates ON players (mutual_level, mutual_score);
-- 掃描佇列：每分鐘找「到期的前 15 個人」。
-- D1 依「讀了幾列」計費（免費每天 500 萬列），有這個索引才不用每分鐘把整張表讀一遍。
CREATE INDEX players_scan_queue ON players (scan_due_at);

-- 用 osu! 登入過的使用者。token 以 AES-GCM 加密後才存（見 src/tokenCrypto.ts）。
CREATE TABLE accounts (
    osu_user_id INTEGER PRIMARY KEY,
    username TEXT NOT NULL,
    is_supporter INTEGER NOT NULL DEFAULT 0, -- 決定好友上限（500 / 1000）
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    last_synced_at INTEGER,               -- null = 還沒同步過好友名單
    created_at INTEGER NOT NULL
);

-- 每位使用者「目前」的好友名單，同步時拿來跟 osu! 的最新名單比對差異。
CREATE TABLE friendships (
    account_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    avatar_url TEXT,
    country_code TEXT,
    last_visit INTEGER,
    mutual INTEGER NOT NULL,
    first_seen_at INTEGER,                -- 第一次在名單裡看到的時間；null = 開始追蹤前就是好友
    mutual_since INTEGER,                 -- 什麼時候開始是 mutual；同上，null 可能代表開始追蹤前就是
    PRIMARY KEY (account_id, target_id)
) WITHOUT ROWID;

-- 好友名單的變動紀錄：誰回加了、誰取消了 mutual。
CREATE TABLE friend_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    type TEXT NOT NULL,                   -- added | mutual | unmutual | removed
    at INTEGER NOT NULL
);

CREATE INDEX friend_events_account ON friend_events (account_id, at DESC);

-- 小型的鍵值設定：掃描進度、App 自己的 token 快取等。
CREATE TABLE kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
