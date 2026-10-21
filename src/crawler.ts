// src/crawler.ts —— 背景掃描（由 Cron Trigger 每分鐘呼叫一次）。
//
// 流程：邊讀排行榜、邊掃描個人頁面，資料庫只保存「有提到 mutual 的人」。
//
//   一輪（pass）= 依活躍玩家數從多到少，逐國讀完排行榜（每國最多 10,000 名、每頁 50 人）。
//   每讀一頁：
//     - 不活躍的人（is_active = false，官方網站上名字變暗）直接跳過；如果資料庫裡有，就刪除
//     - 活躍的人放進待掃清單，逐一抓個人頁面：
//         有提到 mutual → 存進資料庫（或更新）
//         沒提到        → 不存；如果資料庫裡有（他把相關文字拿掉了），就刪除
//   一個國家讀完 → 刪除這個國家「這一輪沒再看到」的人（排名掉出前 1 萬名等）
//   所有國家讀完 → 這一輪結束；距離這一輪開始至少 7 天後，才開始下一輪
//
// 為什麼不把所有玩家都存起來：全世界排行榜上的活躍玩家約 37.5 萬人，全部存的話，
// 第一輪每天要寫入約 24 萬列，超過 D1 免費方案每天 10 萬列的上限。只存約 9% 提到 mutual 的人，
// 寫入量和資料量都降到十分之一以下。代價是每一輪都要重新掃描所有活躍玩家（沒有紀錄可以跳過）。
//
// 每次執行的限制：
//   - osu! API 要求每分鐘不超過 60 個請求：每次最多 32 個，間隔 1 秒
//   - Workers 免費方案每次執行最多 50 個對外請求、CPU 時間 10 毫秒
//   - D1 免費方案每次執行最多 50 個查詢：整批資料打包成一個 JSON 參數，用 json_each 展開，不管幾筆都只算一個查詢

import { detectMutualMention } from './detect';
import type { Env } from './env';
import {
    apiGet,
    getAppToken,
    OsuApiError,
    parseTime,
    type CountryRankingResponse,
    type OsuUser,
    type RankingResponse,
} from './osu';

const MAX_REQUESTS_PER_RUN = 32;
const REQUEST_GAP_MS = 1000;
// 超過這個時間就不再發新請求：每分鐘都會執行一次，拖太久會跟下一次重疊
const RUN_DEADLINE_MS = 50 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PASS_INTERVAL_MS = 7 * DAY_MS;
// 統計（含各國人數，給網站的國家選單用）每小時算一次：
// 只讀提到 mutual 的人（全球規模約 3 萬多列），每天約 80 萬列讀取，是免費額度的 16%
const STATS_REFRESH_MS = 60 * 60 * 1000;

const STATE_KEY = 'crawler:state';
const STATS_KEY = 'crawler:stats';

interface CrawlerState {
    countries: string[]; // 這一輪要走的國家，依活躍玩家數排序；空陣列 = 目前不在任何一輪中
    countryIndex: number;
    nextPage: number;
    countryStartedAt: number; // 目前這個國家從什麼時候開始讀，讀完時用來找出「這一輪沒再看到的人」
    pending: number[]; // 已經從排行榜讀到、還沒掃描的活躍玩家
    passStartedAt: number;
    passScanned: number; // 這一輪掃過幾份個人頁面
    lastPassScanned: number | null; // 上一輪總共掃了幾份（一輪結束時記下）
    statsUpdatedAt: number;
}

export interface CrawlerStats {
    mentioned: number;
    byCountry: { code: string; count: number }[]; // 依人數由多到少
    updatedAt: number;
}

interface PlayerRow {
    id: number;
    username: string;
    avatarUrl: string;
    countryCode: string;
    globalRank: number | null;
    countryRank: number | null;
    pp: number | null;
    followerCount: number;
    lastVisit: number | null;
    pmFriendsOnly: boolean;
    count: number;
    snippets: string;
}

const initialState = (): CrawlerState => ({
    countries: [],
    countryIndex: 0,
    nextPage: 1,
    countryStartedAt: 0,
    pending: [],
    passStartedAt: 0,
    passScanned: 0,
    lastPassScanned: null,
    statsUpdatedAt: 0,
});

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

type ApiGet = <T>(path: string) => Promise<T>;

/** 這一輪要掃的國家：設定為 "all" 時讀國家排行榜，依活躍玩家數從多到少排序。 */
async function loadCountries(env: Env, get: ApiGet, request: () => Promise<void>): Promise<string[]> {
    if (env.SCAN_COUNTRIES.trim().toLowerCase() !== 'all') {
        return env.SCAN_COUNTRIES.split(',').map(code => code.trim().toUpperCase()).filter(Boolean);
    }
    const entries: CountryRankingResponse['ranking'] = [];
    for (let page: number | null = 1; page !== null; ) {
        await request();
        const res: CountryRankingResponse = await get<CountryRankingResponse>(`/rankings/${env.SCAN_MODE}/country?page=${page}`);
        entries.push(...res.ranking);
        page = res.cursor?.page ?? null;
    }
    return entries
        .filter(e => e.active_users > 0)
        .sort((a, b) => b.active_users - a.active_users)
        .map(e => e.code);
}

export async function runCrawler(env: Env): Promise<string> {
    const db = env.DB;
    const startedAt = Date.now();
    // 舊版的狀態格式不同（沒有 countries 欄位），直接當作重新開始
    const saved = await readKv<Partial<CrawlerState>>(db, STATE_KEY);
    const state: CrawlerState = saved && Array.isArray(saved.countries) ? { ...initialState(), ...saved } : initialState();
    let token = await getAppToken(env);
    let tokenRenewed = false;

    // 所有 API 呼叫都經過這裡：收到 401 代表快取的 token 在過期前就失效了（例如換了 OAuth 應用程式），
    // 就重新申請一個、重試一次。只重試一次：新 token 也 401（例如 secret 填錯）就往外丟，不會一直重打。
    const get: ApiGet = async <T>(path: string) => {
        try {
            return await apiGet<T>(path, token);
        } catch (err) {
            if (tokenRenewed || !(err instanceof OsuApiError && err.status === 401)) throw err;
            tokenRenewed = true;
            console.warn('[crawler] App token 被拒絕（401），重新申請後重試');
            token = await getAppToken(env, true);
            return apiGet<T>(path, token);
        }
    };

    let requests = 0;
    const canRequest = () => requests < MAX_REQUESTS_PER_RUN && Date.now() - startedAt < RUN_DEADLINE_MS;
    const request = async () => {
        if (requests++ > 0) await sleep(REQUEST_GAP_MS);
    };

    const upserts: PlayerRow[] = [];
    const removals: number[] = []; // 不活躍、沒提到 mutual、或帳號已不存在的人
    const finishedCountries: { code: string; startedAt: number }[] = [];
    let pagesRead = 0;
    let scanned = 0;
    let stopped: unknown = null;

    try {
        // ---------- 開始新的一輪（上一輪的待掃清單要先掃完；而且距離上一輪開始至少 7 天） ----------
        if (state.countries.length === 0 && state.pending.length === 0 && startedAt - state.passStartedAt >= MIN_PASS_INTERVAL_MS) {
            state.countries = await loadCountries(env, get, request);
            Object.assign(state, { countryIndex: 0, nextPage: 1, countryStartedAt: startedAt, passStartedAt: startedAt, passScanned: 0 });
        }

        // 還有國家要讀、或待掃清單還有人，就繼續（一輪剛結束時，最後一頁的人還在待掃清單裡）
        while (canRequest() && (state.countries.length > 0 || state.pending.length > 0)) {
            // ---------- 待掃清單空了：讀下一頁排行榜 ----------
            if (state.pending.length === 0) {
                const country = state.countries[state.countryIndex]!;
                await request();
                const res = await get<RankingResponse>(`/rankings/${env.SCAN_MODE}/performance?country=${country}&page=${state.nextPage}`);
                pagesRead++;
                for (const entry of res.ranking) {
                    if (entry.user.is_active) state.pending.push(entry.user.id);
                    else removals.push(entry.user.id);
                }

                if (res.cursor?.page) {
                    state.nextPage = res.cursor.page;
                } else {
                    // 這個國家讀完了（這一頁剩下的人還在待掃清單，會繼續掃完）
                    finishedCountries.push({ code: country, startedAt: state.countryStartedAt });
                    state.countryIndex++;
                    state.nextPage = 1;
                    state.countryStartedAt = Date.now();
                    if (state.countryIndex >= state.countries.length) {
                        state.lastPassScanned = state.passScanned + state.pending.length;
                        state.countries = []; // 一輪結束（待掃清單仍會繼續掃完）
                    }
                }
                continue;
            }

            // ---------- 掃描一個人的個人頁面 ----------
            const id = state.pending[0]!;
            await request();
            try {
                const user = await get<OsuUser>(`/users/${id}/${env.SCAN_MODE}?key=id`);
                const detection = detectMutualMention(user.page?.raw ?? '');
                if (user.is_active && detection.mentioned) {
                    upserts.push({
                        id,
                        username: user.username,
                        avatarUrl: user.avatar_url,
                        countryCode: user.country_code,
                        globalRank: user.statistics?.global_rank ?? null,
                        countryRank: user.statistics?.country_rank ?? null,
                        pp: user.statistics?.pp ?? null,
                        followerCount: user.follower_count,
                        lastVisit: parseTime(user.last_visit),
                        pmFriendsOnly: user.pm_friends_only,
                        count: detection.count,
                        snippets: JSON.stringify(detection.snippets),
                    });
                } else {
                    removals.push(id);
                }
            } catch (err) {
                // 404：帳號被停權或刪除，當作沒提到；其他錯誤（429、osu! 掛了）先停，這個人留在清單下次再掃
                if (!(err instanceof OsuApiError && err.status === 404)) throw err;
                removals.push(id);
            }
            state.pending.shift();
            state.passScanned++;
            scanned++;
        }
    } catch (err) {
        stopped = err;
    }

    // ---------- 寫入資料庫：全部放在同一個 batch（交易），避免只寫了一半 ----------
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];

    if (removals.length > 0) {
        // 沒存過的人刪了也不會產生寫入
        statements.push(db.prepare('DELETE FROM players WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(removals)));
    }

    if (upserts.length > 0) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO players (id, username, avatar_url, country_code, global_rank, country_rank, pp, follower_count,
                                          last_visit, pm_friends_only, scanned_at, mutual_level, mutual_score, mutual_snippet)
                     SELECT p.value ->> 'id', p.value ->> 'username', p.value ->> 'avatarUrl', p.value ->> 'countryCode',
                            p.value ->> 'globalRank', p.value ->> 'countryRank', p.value ->> 'pp', p.value ->> 'followerCount',
                            p.value ->> 'lastVisit', p.value ->> 'pmFriendsOnly', ?2, 'mention', p.value ->> 'count', p.value ->> 'snippets'
                     FROM json_each(?1) AS p WHERE true
                     ON CONFLICT (id) DO UPDATE SET
                         username = excluded.username,
                         avatar_url = excluded.avatar_url,
                         country_code = excluded.country_code,
                         global_rank = excluded.global_rank,
                         country_rank = excluded.country_rank,
                         pp = excluded.pp,
                         follower_count = excluded.follower_count,
                         last_visit = excluded.last_visit,
                         pm_friends_only = excluded.pm_friends_only,
                         scanned_at = excluded.scanned_at,
                         mutual_level = excluded.mutual_level,
                         mutual_score = excluded.mutual_score,
                         mutual_snippet = excluded.mutual_snippet`,
                )
                .bind(JSON.stringify(upserts), now),
        );
    }

    for (const { code, startedAt: countryStartedAt } of finishedCountries) {
        // 這個國家這一輪沒再掃到的人：排名掉出前 1 萬名、換了國家等。
        // 還在待掃清單裡的人也算「看到了」，不能刪（他們稍後才會掃）。
        // mutual_level = 'mention' 不會改變結果（表裡只有這種人），但少了它 SQLite 無法使用部分索引，
        // 會整張表從頭讀到尾；一輪最後幾天一天要讀完上百個小國家，可能逼近每天 500 萬列的讀取上限。
        statements.push(
            db
                .prepare(
                    `DELETE FROM players
                     WHERE mutual_level = 'mention' AND country_code = ?1 AND scanned_at < ?2
                       AND id NOT IN (SELECT value FROM json_each(?3))`,
                )
                .bind(code, countryStartedAt, JSON.stringify(state.pending)),
        );
    }

    statements.push(writeKv(db, STATE_KEY, state));
    await db.batch(statements);

    // ---------- 統計（每小時算一次：只數提到 mutual 的人，走部分索引） ----------
    if (now - state.statsUpdatedAt >= STATS_REFRESH_MS) {
        const { results } = await db
            .prepare(
                `SELECT country_code AS code, COUNT(*) AS count FROM players
                 WHERE mutual_level = 'mention' AND country_code IS NOT NULL
                 GROUP BY country_code ORDER BY count DESC`,
            )
            .all<{ code: string; count: number }>();
        const stats: CrawlerStats = { mentioned: results.reduce((sum, r) => sum + r.count, 0), byCountry: results, updatedAt: now };
        state.statsUpdatedAt = now;
        await db.batch([writeKv(db, STATS_KEY, stats), writeKv(db, STATE_KEY, state)]);
    }

    const where = state.countries.length > 0 ? `${state.countries[state.countryIndex]} 第 ${state.nextPage} 頁` : '本輪完成，等待下一輪';
    const summary = `讀排行榜 ${pagesRead} 頁、掃描 ${scanned} 人（提到 mutual ${upserts.length} 人）、移除 ${removals.length} 筆、目前進度：${where}、待掃 ${state.pending.length} 人`;
    if (stopped) console.error(`掃描中斷（${summary}）:`, stopped);
    return summary;
}

export async function getCrawlerProgress(db: D1Database) {
    const [state, stats] = await Promise.all([readKv<Partial<CrawlerState>>(db, STATE_KEY), readKv<CrawlerStats>(db, STATS_KEY)]);
    const countries = state?.countries ?? [];
    return {
        countriesInPass: countries.length,
        currentCountry: countries[state?.countryIndex ?? 0] ?? null,
        passScanned: state?.passScanned ?? 0,
        lastPassScanned: state?.lastPassScanned ?? null,
        mentioned: stats?.mentioned ?? null,
        byCountry: stats?.byCountry ?? [],
    };
}
