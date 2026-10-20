// src/crawler.ts —— 背景掃描（由 Cron Trigger 每分鐘呼叫一次）。
//
// 每次執行只做一小批，原因有三個：
//   1. osu! API 要求每分鐘不超過 60 個請求；我們每次最多約 17 個，而且每個請求間隔 1 秒。
//   2. Workers 免費方案每次執行最多 50 個對外請求、CPU 時間 10 毫秒；
//      個人頁面的 JSON 不小，一次解析太多份可能超過 CPU 限制。
//   3. D1 免費方案每次執行最多 50 個查詢，而且每天寫入上限 10 萬列。
//
// 流程：
//   A. 排行榜：每天從第 1 頁走到最後一頁（國家排行榜最多 10,000 名、每頁 50 人），
//      每次執行走 2 頁，把玩家基本資料寫進 players。最後上線太久的人不排進掃描佇列。
//   B. 個人頁面：從佇列取出到期的 15 人，逐一抓個人頁面、判斷有沒有在找 mutual。
//      掃過的人 14 天後再重掃一次（個人頁面可能改了）。
//
// 寫入資料庫時，整批資料打包成「一個 JSON 參數」，在 SQL 裡用 json_each 展開。
// 這樣不管幾筆都只算一個查詢，也不會碰到「每個查詢最多 100 個參數」的限制。

import { detectMutualIntent, type MutualLevel } from './detect';
import type { Env } from './env';
import { apiGet, getAppToken, OsuApiError, parseTime, type OsuUser, type RankingResponse } from './osu';

const SCAN_BATCH = 15;
const RANKING_PAGES_PER_RUN = 2;
const RANKING_PAGE_SIZE = 50; // osu-web 的 Model::PER_PAGE
const REQUEST_GAP_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANKING_REFRESH_MS = DAY_MS;
const RESCAN_AFTER_MS = 14 * DAY_MS;
const ACTIVE_WITHIN_MS = 60 * DAY_MS; // 超過 60 天沒上線的人不掃，加了也不太可能回
const STATS_REFRESH_MS = 60 * 60 * 1000;

const STATE_KEY = 'crawler:state';
const STATS_KEY = 'crawler:stats';

interface CrawlerState {
    nextPage: number | null; // null = 這一輪排行榜走完了，等 nextPassAt
    nextPassAt: number;
    statsUpdatedAt: number;
}

export interface CrawlerStats {
    players: number;
    scanned: number;
    strong: number;
    weak: number;
    updatedAt: number;
}

interface RankingRow {
    id: number;
    username: string;
    avatarUrl: string;
    countryCode: string;
    globalRank: number | null;
    countryRank: number;
    pp: number | null;
    lastVisit: number | null;
    pmFriendsOnly: boolean;
    active: boolean;
}

interface ScanRow {
    id: number;
    followerCount: number | null;
    lastVisit: number | null;
    pmFriendsOnly: boolean | null;
    level: MutualLevel;
    score: number;
    snippet: string | null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readKv<T>(db: D1Database, key: string): Promise<T | null> {
    const row = await db.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first<{ value: string }>();
    return row ? (JSON.parse(row.value) as T) : null;
}

function writeKv(db: D1Database, key: string, value: unknown) {
    return db
        .prepare('INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2')
        .bind(key, JSON.stringify(value));
}

export async function runCrawler(env: Env): Promise<string> {
    const db = env.DB;
    const now = Date.now();
    const state = (await readKv<CrawlerState>(db, STATE_KEY)) ?? { nextPage: 1, nextPassAt: 0, statsUpdatedAt: 0 };
    const token = await getAppToken(env);

    let requests = 0;
    const throttle = async () => {
        if (requests++ > 0) await sleep(REQUEST_GAP_MS);
    };

    // ---------- A. 排行榜 ----------
    if (state.nextPage === null && now >= state.nextPassAt) state.nextPage = 1;

    const rankingRows: RankingRow[] = [];
    let stopped: unknown = null;

    try {
        for (let i = 0; i < RANKING_PAGES_PER_RUN && state.nextPage !== null; i++) {
            await throttle();
            const page = state.nextPage;
            const res = await apiGet<RankingResponse>(
                `/rankings/${env.SCAN_MODE}/performance?country=${env.SCAN_COUNTRY}&page=${page}`,
                token,
            );
            res.ranking.forEach((entry, index) => {
                const lastVisit = parseTime(entry.user.last_visit);
                rankingRows.push({
                    id: entry.user.id,
                    username: entry.user.username,
                    avatarUrl: entry.user.avatar_url,
                    countryCode: entry.user.country_code,
                    globalRank: entry.global_rank,
                    countryRank: (page - 1) * RANKING_PAGE_SIZE + index + 1,
                    pp: entry.pp,
                    lastVisit,
                    pmFriendsOnly: entry.user.pm_friends_only,
                    // 隱藏上線狀態（null）的人無法判斷，先當作活躍
                    active: lastVisit === null || lastVisit >= now - ACTIVE_WITHIN_MS,
                });
            });
            state.nextPage = res.cursor?.page ?? null;
            if (state.nextPage === null) state.nextPassAt = now + RANKING_REFRESH_MS;
        }
    } catch (err) {
        stopped = err;
    }

    if (rankingRows.length > 0) {
        // scan_due_at 的規則：
        //   - 不活躍 → null（移出佇列）
        //   - 活躍且原本不在佇列（新玩家、或重新變活躍）→ 立刻到期
        //   - 活躍且已經排好下次掃描時間 → 保持不變
        // "WHERE true" 是 SQLite 的語法要求：INSERT ... SELECT 搭配 ON CONFLICT 時，避免解析歧義。
        await db
            .prepare(
                `INSERT INTO players (id, username, avatar_url, country_code, global_rank, country_rank, pp,
                                      last_visit, pm_friends_only, ranking_seen_at, scan_due_at)
                 SELECT r.value ->> 'id', r.value ->> 'username', r.value ->> 'avatarUrl', r.value ->> 'countryCode',
                        r.value ->> 'globalRank', r.value ->> 'countryRank', r.value ->> 'pp', r.value ->> 'lastVisit',
                        r.value ->> 'pmFriendsOnly', ?2,
                        CASE WHEN r.value ->> 'active' THEN ?2 END
                 FROM json_each(?1) AS r WHERE true
                 ON CONFLICT (id) DO UPDATE SET
                     username = excluded.username,
                     avatar_url = excluded.avatar_url,
                     country_code = excluded.country_code,
                     global_rank = excluded.global_rank,
                     country_rank = excluded.country_rank,
                     pp = excluded.pp,
                     last_visit = excluded.last_visit,
                     pm_friends_only = excluded.pm_friends_only,
                     ranking_seen_at = excluded.ranking_seen_at,
                     scan_due_at = CASE WHEN excluded.scan_due_at IS NULL THEN NULL
                                        ELSE COALESCE(players.scan_due_at, excluded.scan_due_at) END`,
            )
            .bind(JSON.stringify(rankingRows), now)
            .run();
    }

    // ---------- B. 掃描個人頁面 ----------
    const scanRows: ScanRow[] = [];

    if (!stopped) {
        const { results: due } = await db
            .prepare('SELECT id FROM players WHERE scan_due_at <= ?1 ORDER BY scan_due_at LIMIT ?2')
            .bind(now, SCAN_BATCH)
            .all<{ id: number }>();

        for (const { id } of due) {
            try {
                await throttle();
                const user = await apiGet<OsuUser>(`/users/${id}/${env.SCAN_MODE}?key=id`, token);
                const detection = detectMutualIntent(user.page?.raw ?? '');
                scanRows.push({
                    id,
                    followerCount: user.follower_count ?? null,
                    lastVisit: parseTime(user.last_visit),
                    pmFriendsOnly: user.pm_friends_only,
                    level: detection.level,
                    score: detection.score,
                    snippet: detection.snippet,
                });
            } catch (err) {
                if (err instanceof OsuApiError && err.status === 404) {
                    // 帳號被停權或刪除：記成掃過、沒有訊號，14 天後再看一次
                    scanRows.push({ id, followerCount: null, lastVisit: null, pmFriendsOnly: null, level: 'none', score: 0, snippet: null });
                    continue;
                }
                stopped = err; // 429（太頻繁）或 osu! 掛了：這輪先停，下一分鐘再試
                break;
            }
        }
    }

    if (scanRows.length > 0) {
        // COALESCE：API 沒給的值（null）就保留資料庫裡原本的值
        await db
            .prepare(
                `UPDATE players SET
                     follower_count = COALESCE(s.value ->> 'followerCount', follower_count),
                     last_visit = COALESCE(s.value ->> 'lastVisit', last_visit),
                     pm_friends_only = COALESCE(s.value ->> 'pmFriendsOnly', pm_friends_only),
                     mutual_level = s.value ->> 'level',
                     mutual_score = s.value ->> 'score',
                     mutual_snippet = s.value ->> 'snippet',
                     scanned_at = ?2,
                     scan_due_at = ?3
                 FROM json_each(?1) AS s
                 WHERE players.id = s.value ->> 'id'`,
            )
            .bind(JSON.stringify(scanRows), now, now + RESCAN_AFTER_MS)
            .run();
    }

    // ---------- 統計（每小時算一次，避免每分鐘都把整張表讀一遍） ----------
    if (now - state.statsUpdatedAt >= STATS_REFRESH_MS) {
        const stats = await db
            .prepare(
                `SELECT COUNT(*) AS players,
                        COUNT(scanned_at) AS scanned,
                        COALESCE(SUM(mutual_level = 'strong'), 0) AS strong,
                        COALESCE(SUM(mutual_level = 'weak'), 0) AS weak
                 FROM players`,
            )
            .first<Omit<CrawlerStats, 'updatedAt'>>();
        await writeKv(db, STATS_KEY, { ...stats, updatedAt: now }).run();
        state.statsUpdatedAt = now;
    }

    await writeKv(db, STATE_KEY, state).run();

    const summary = `排行榜 ${rankingRows.length} 人、掃描 ${scanRows.length} 人、下一頁 ${state.nextPage ?? '（本輪完成）'}`;
    if (stopped) {
        console.error(`掃描中斷（${summary}）:`, stopped);
    }
    return summary;
}

export async function getCrawlerProgress(db: D1Database) {
    const [state, stats] = await Promise.all([readKv<CrawlerState>(db, STATE_KEY), readKv<CrawlerStats>(db, STATS_KEY)]);
    return { rankingNextPage: state?.nextPage ?? 1, stats };
}
