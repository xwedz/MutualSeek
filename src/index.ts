// src/index.ts —— Cloudflare Worker 入口（Hono）
//
// fetch：處理 /api/*（wrangler.jsonc 的 run_worker_first）；前端頁面由 Cloudflare 直接提供。
// scheduled：Cron Trigger 每分鐘呼叫一次，執行背景掃描。

import { Hono, type Context } from 'hono';
import auth from './auth';
import { getCrawlerProgress, runCrawler } from './crawler';
import type { Snippet } from './detect';
import type { AppEnv, Env } from './env';
import { syncFriends, type FriendRow } from './friends';
import { getSessionUser, type SessionUser } from './session';

const app = new Hono<AppEnv>();

const SYNC_COOLDOWN_MS = 60 * 1000; // 同一個人一分鐘內重複按「同步」，直接回傳現有資料
const PAGE_SIZE = 30;
// osu! 好友上限（官方 supporter 頁面：supporter 從 500 提高到 1000）
const FRIEND_LIMIT = { normal: 500, supporter: 1000 };

// 頻率限制：依來源 IP 計算，被擋下的請求在碰到資料庫之前就回 429。
app.use('/api/*', async (c, next) => {
    if (c.env.API_LIMITER) {
        const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
        const { success } = await c.env.API_LIMITER.limit({ key: ip });
        if (!success) return c.json({ error: 'Too many requests, please slow down.' }, 429);
    }
    await next();
});

app.route('/api/auth', auth);

interface AccountRow {
    is_supporter: number;
    last_synced_at: number | null;
}

async function loadAccount(c: Context<AppEnv>, user: SessionUser) {
    return c.env.DB.prepare('SELECT is_supporter, last_synced_at FROM accounts WHERE osu_user_id = ?')
        .bind(user.osuUserId)
        .first<AccountRow>();
}

const accountJson = (row: AccountRow) => ({
    lastSyncedAt: row.last_synced_at,
    friendLimit: row.is_supporter ? FRIEND_LIMIT.supporter : FRIEND_LIMIT.normal,
});

/** 目前登入的使用者（沒登入回傳 null）。資料庫裡找不到帳號時也當作沒登入。 */
app.get('/api/me', async c => {
    const user = await getSessionUser(c);
    const account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ user: null });
    return c.json({ user, account: accountJson(account) });
});

/**
 * 候選人列表：個人頁面有提到 mutual 的玩家（是否真的想要 mutual，由使用者讀摘錄後自己判斷）。
 * players 表裡只有活躍的玩家（見 crawler.ts），所以這裡不用再篩選最後上線時間。
 * 登入後會排除「已經在你好友名單裡」的人（以最近一次同步為準）與你自己。
 * 排序：最近上線的優先（SQLite 的 DESC 會把 null 排在最後，也就是隱藏上線狀態的人）。
 */
app.get('/api/candidates', async c => {
    const user = await getSessionUser(c);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);

    const { results } = await c.env.DB.prepare(
        `SELECT p.id, p.username, p.avatar_url, p.global_rank, p.country_rank, p.pp, p.last_visit,
                p.pm_friends_only, p.follower_count, p.mutual_snippet
         FROM players AS p
         LEFT JOIN friendships AS f ON f.account_id = ?1 AND f.target_id = p.id
         WHERE p.mutual_level = 'mention'
           AND f.target_id IS NULL
           AND p.id != ?1
         ORDER BY p.last_visit DESC
         LIMIT ?2 OFFSET ?3`,
    )
        .bind(user?.osuUserId ?? 0, PAGE_SIZE + 1, offset)
        .all<Record<string, unknown> & { mutual_snippet: string | null }>();

    // 多查一筆：查得到第 PAGE_SIZE + 1 筆，就代表還有下一頁
    const candidates = results.slice(0, PAGE_SIZE).map(({ mutual_snippet, ...row }) => ({
        ...row,
        snippets: parseSnippets(mutual_snippet),
    }));
    return c.json({ candidates, hasMore: results.length > PAGE_SIZE });
});

/** 資料庫裡的摘錄是 JSON；萬一格式不對（例如舊版存的純文字），就當成一段沒有標記的文字。 */
function parseSnippets(value: string | null): Snippet[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed as Snippet[];
    } catch {
        // 不是 JSON：落到下面的處理
    }
    return [[{ text: value, hit: false }]];
}

async function friendsResponse(c: Context<AppEnv>, user: SessionUser, account: AccountRow) {
    const [friends, events] = await c.env.DB.batch([
        c.env.DB.prepare('SELECT * FROM friendships WHERE account_id = ? ORDER BY username COLLATE NOCASE').bind(user.osuUserId),
        c.env.DB.prepare('SELECT target_id, username, type, at FROM friend_events WHERE account_id = ? ORDER BY at DESC, id DESC LIMIT 100').bind(
            user.osuUserId,
        ),
    ]);
    return {
        account: accountJson(account),
        friends: (friends?.results ?? []) as unknown as FriendRow[],
        events: events?.results ?? [],
    };
}

/** 你的好友名單（含 mutual 狀態）與最近的變動紀錄。 */
app.get('/api/friends', async c => {
    const user = await getSessionUser(c);
    const account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ error: 'Please log in first.' }, 401);
    return c.json(await friendsResponse(c, user, account));
});

/** 從 osu! 讀取最新的好友名單並比對差異，回傳同步結果與更新後的名單。 */
app.post('/api/friends/sync', async c => {
    const user = await getSessionUser(c);
    let account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ error: 'Please log in first.' }, 401);

    let result = null;
    if (!account.last_synced_at || Date.now() - account.last_synced_at >= SYNC_COOLDOWN_MS) {
        result = await syncFriends(c.env, user.osuUserId);
        if (result === 'relogin') {
            return c.json({ error: 'Your osu! authorization has expired. Please log in again.', relogin: true }, 401);
        }
        account = (await loadAccount(c, user)) ?? account;
    }
    return c.json({ result, ...(await friendsResponse(c, user, account)) });
});

/** 背景掃描的進度（顯示在頁尾）。 */
app.get('/api/stats', async c => {
    return c.json({ country: c.env.SCAN_COUNTRY, mode: c.env.SCAN_MODE, ...(await getCrawlerProgress(c.env.DB)) });
});

app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
});

export default {
    fetch: app.fetch,
    async scheduled(_controller, env, ctx) {
        ctx.waitUntil(
            runCrawler(env).then(
                summary => console.log(`[crawler] ${summary}`),
                err => console.error('[crawler] 失敗:', err),
            ),
        );
    },
} satisfies ExportedHandler<Env>;
