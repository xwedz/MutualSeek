// src/index.ts — Cloudflare Worker entry point (Hono)
//
// fetch: handles /api/* (run_worker_first in wrangler.jsonc); the frontend is served by Cloudflare directly.
// scheduled: called by the Cron Trigger once a minute to run the background scanner.

import { Hono, type Context } from 'hono';
import { deleteAccountData } from './account';
import auth from './auth';
import { getCountryInFirstScan, getCrawlerProgress, runCrawler } from './crawler';
import type { Snippet } from './detect';
import type { AppEnv, Env } from './env';
import { syncFriends, type FriendRow } from './friends';
import { endSession, getSessionUser, type SessionUser } from './session';
import { ringStart, SHUFFLE_RANGE } from './shuffle';

const app = new Hono<AppEnv>();

const SYNC_COOLDOWN_MS = 60 * 1000; // pressing sync again within a minute just returns the current data
// Players per page: every card has an excerpt to read, and five fit on about one screen
const PAGE_SIZE = 5;
// osu! friend limits (per the official supporter page, supporter raises it from 500 to 1000)
const FRIEND_LIMIT = { normal: 500, supporter: 1000 };
// The "Before you start" guidelines shown before Find people. Raise this after an important change to the text so
// everyone sees it again (migration 0007).
const GUIDELINES_VERSION = 1;

// Rate limit per client IP; blocked requests get a 429 before touching the database.
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
    guidelines_version: number;
}

async function loadAccount(c: Context<AppEnv>, user: SessionUser) {
    return c.env.DB.prepare('SELECT is_supporter, last_synced_at, guidelines_version FROM accounts WHERE osu_user_id = ?')
        .bind(user.osuUserId)
        .first<AccountRow>();
}

const accountJson = (row: AccountRow) => ({
    lastSyncedAt: row.last_synced_at,
    friendLimit: row.is_supporter ? FRIEND_LIMIT.supporter : FRIEND_LIMIT.normal,
    guidelinesAccepted: row.guidelines_version >= GUIDELINES_VERSION,
});

async function isOptedOut(c: Context<AppEnv>, osuUserId: number) {
    return Boolean(await c.env.DB.prepare('SELECT 1 FROM opt_outs WHERE id = ?').bind(osuUserId).first());
}

/** The logged-in user (null if not logged in). A session without an account in the database also counts as logged out. */
app.get('/api/me', async c => {
    const user = await getSessionUser(c);
    const account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ user: null });
    return c.json({ user, account: accountJson(account), optedOut: await isOptedOut(c, user.osuUserId) });
});

/** The user clicked "I understand" on the "Before you start" guidelines */
app.post('/api/guidelines', async c => {
    const user = await getSessionUser(c);
    if (!user) return c.json({ error: 'Please log in first.' }, 401);
    await c.env.DB.prepare('UPDATE accounts SET guidelines_version = ?1 WHERE osu_user_id = ?2').bind(GUIDELINES_VERSION, user.osuUserId).run();
    return c.json({ guidelinesAccepted: true });
});

/**
 * "Don't list me": { listed: false } removes the user from the list right away and keeps future scans from storing
 * them; { listed: true } undoes it. Undoing doesn't bring them back immediately: they're listed again once the next
 * scan reaches them (there's no profile data here to restore).
 */
app.post('/api/listing', async c => {
    const user = await getSessionUser(c);
    if (!user) return c.json({ error: 'Please log in first.' }, 401);
    const body = await c.req.json<{ listed?: unknown }>().catch(() => ({}) as { listed?: unknown });
    if (typeof body.listed !== 'boolean') return c.json({ error: 'Invalid request.' }, 400);

    if (body.listed) {
        await c.env.DB.prepare('DELETE FROM opt_outs WHERE id = ?').bind(user.osuUserId).run();
    } else {
        await c.env.DB.batch([
            c.env.DB.prepare('INSERT INTO opt_outs (id, created_at) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING').bind(
                user.osuUserId,
                Date.now(),
            ),
            c.env.DB.prepare('DELETE FROM players WHERE id = ?').bind(user.osuUserId),
        ]);
    }
    return c.json({ optedOut: !body.listed });
});

/**
 * Candidates: players whose profile mentions mutuals (whether they actually want them is for the user to judge from
 * the excerpt). The players table only holds active players (see crawler.ts), so there's no last-visit filter here.
 * Requires login and accepted guidelines. Players already on your friend list (as of your last sync) and you yourself are excluded.
 * Order: shuffled, starting at the user's own point on the ring for today (see src/shuffle.ts).
 * country=TW limits the list to one country (using the country-first index); missing or malformed = all countries
 * active=1 only keeps players seen online in the last 7 days (players who hide their online status are left out)
 * The country the first pass is still scanning is left out until it's done (see getCountryInFirstScan).
 */
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

app.get('/api/candidates', async c => {
    // The list is only for logged-in users who accepted the guidelines, so it can't be browsed or collected anonymously.
    // The frontend already waits for both; checking here as well keeps the API itself from handing the list out.
    const user = await getSessionUser(c);
    const account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ error: 'Please log in first.' }, 401);
    if (account.guidelines_version < GUIDELINES_VERSION) return c.json({ error: 'Please accept the guidelines first.' }, 403);

    // page starts at 1; anything malformed means page 1. The upper bound only guards against absurd numbers
    const page = Math.min(Math.max(Math.floor(Number(c.req.query('page'))) || 1, 1), 100_000);
    const offset = (page - 1) * PAGE_SIZE;
    const country = c.req.query('country')?.toUpperCase() ?? '';
    const byCountry = /^[A-Z]{2}$/.test(country);
    const activeOnly = c.req.query('active') === '1';
    const hiddenCountry = await getCountryInFirstScan(c.env.DB);
    const me = user.osuUserId;
    const now = Date.now();
    const start = ringStart(me, now);
    // One extra row is fetched: if row PAGE_SIZE + 1 exists, there's a next page
    const limit = PAGE_SIZE + 1;

    // The ring is read in two halves: keys from the start point to the end, then from the beginning up to the start
    // point. Each half is a range scan along the index, capped at the rows this page could need (offset + limit), so
    // a page reads at most twice that many rows; the outer ORDER BY then only sorts those few. (A single
    // "ORDER BY part, shuffle_key" over both halves is correct too, but SQLite reads and sorts every listed player for it.)
    function half(part: 0 | 1, comparison: '>=' | '<') {
        const params: (string | number)[] = [me];
        let filters = '';
        if (byCountry) {
            filters += ' AND p.country_code = ?';
            params.push(country);
        }
        if (activeOnly) {
            filters += ' AND p.last_visit >= ?';
            params.push(now - ACTIVE_WINDOW_MS);
        }
        if (hiddenCountry) {
            filters += ' AND p.country_code != ?';
            params.push(hiddenCountry);
        }
        params.push(me, start, offset + limit);
        const sql = `SELECT * FROM (
                SELECT p.id, p.username, p.avatar_url, p.country_code, p.global_rank, p.country_rank, p.pp, p.last_visit,
                       p.pm_friends_only, p.follower_count, p.mutual_snippet, p.shuffle_key, ${part} AS part
                FROM players AS p
                LEFT JOIN friendships AS f ON f.account_id = ? AND f.target_id = p.id
                WHERE p.mutual_level = 'mention'${filters}
                  AND f.target_id IS NULL
                  AND p.id != ?
                  AND p.shuffle_key ${comparison} ?
                ORDER BY p.shuffle_key, p.id
                LIMIT ?)`;
        return { sql, params };
    }
    const first = half(0, '>=');
    const second = half(1, '<');

    const { results } = await c.env.DB.prepare(
        `${first.sql} UNION ALL ${second.sql} ORDER BY part, shuffle_key, id LIMIT ? OFFSET ?`,
    )
        .bind(...first.params, ...second.params, limit, offset)
        .all<Record<string, unknown> & { mutual_snippet: string | null }>();

    // part and shuffle_key are only for ordering
    const candidates = results.slice(0, PAGE_SIZE).map(({ mutual_snippet, part, shuffle_key, ...row }) => ({
        ...row,
        snippets: parseSnippets(mutual_snippet),
    }));
    return c.json({ candidates, hasMore: results.length > PAGE_SIZE });
});

/**
 * Find people before logging in: a few real excerpts, so visitors can see what the site finds before deciding to log
 * in. Only each player's country and first excerpt are sent; who they are (name, avatar, profile link) and the full
 * list stay behind the login. Each request starts at a random point on the shuffle ring, so the preview isn't always
 * the same few players.
 */
const PREVIEW_SIZE = 5;

app.get('/api/preview', async c => {
    const hiddenCountry = await getCountryInFirstScan(c.env.DB);
    const start = Math.floor(Math.random() * SHUFFLE_RANGE);
    // Read like /api/candidates: from the start point to the end of the ring, then wrap around to the beginning
    function half(part: 0 | 1, comparison: '>=' | '<') {
        const params: (string | number)[] = [];
        let filters = '';
        if (hiddenCountry) {
            filters += ' AND country_code != ?';
            params.push(hiddenCountry);
        }
        params.push(start, PREVIEW_SIZE);
        const sql = `SELECT * FROM (
                SELECT country_code, mutual_snippet, shuffle_key, ${part} AS part
                FROM players
                WHERE mutual_level = 'mention'${filters} AND shuffle_key ${comparison} ?
                ORDER BY shuffle_key
                LIMIT ?)`;
        return { sql, params };
    }
    const first = half(0, '>=');
    const second = half(1, '<');
    const { results } = await c.env.DB.prepare(`${first.sql} UNION ALL ${second.sql} ORDER BY part, shuffle_key LIMIT ?`)
        .bind(...first.params, ...second.params, PREVIEW_SIZE)
        .all<{ country_code: string | null; mutual_snippet: string | null }>();

    const players = results
        .map(row => ({ country_code: row.country_code, snippet: parseSnippets(row.mutual_snippet)[0] }))
        .filter(p => p.snippet !== undefined);
    return c.json({ players });
});

/** Excerpts are stored as JSON; anything else (e.g. plain text from an older version) becomes one unmarked snippet. */
function parseSnippets(value: string | null): Snippet[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed as Snippet[];
    } catch {
        // not JSON: handled below
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

/** Your friend list (with mutual status) and recent changes. */
app.get('/api/friends', async c => {
    const user = await getSessionUser(c);
    const account = user && (await loadAccount(c, user));
    if (!user || !account) return c.json({ error: 'Please log in first.' }, 401);
    return c.json(await friendsResponse(c, user, account));
});

/** Reads the latest friend list from osu!, compares it with the last one, and returns the result and updated list. */
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

/** Delete my data: revoke tokens, delete the account and friend history, then log out. Can't be undone (the frontend asks first). */
app.post('/api/account/delete', async c => {
    const user = await getSessionUser(c);
    if (!user) return c.json({ error: 'Please log in first.' }, 401);
    await deleteAccountData(c.env, user.osuUserId);
    endSession(c);
    return c.json({ ok: true });
});

/** Background scanner progress (shown in the footer). */
app.get('/api/stats', async c => {
    return c.json({ countries: c.env.SCAN_COUNTRIES, mode: c.env.SCAN_MODE, ...(await getCrawlerProgress(c.env.DB)) });
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
                err => console.error('[crawler] failed:', err),
            ),
        );
    },
} satisfies ExportedHandler<Env>;
