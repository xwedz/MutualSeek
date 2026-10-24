// src/index.ts — Cloudflare Worker entry point (Hono)
//
// fetch: handles /api/* (run_worker_first in wrangler.jsonc); the frontend is served by Cloudflare directly.
// scheduled: called by the Cron Trigger once a minute to run the background scanner.

import { Hono, type Context } from 'hono';
import { deleteAccountData } from './account';
import auth from './auth';
import { getCrawlerProgress, runCrawler } from './crawler';
import type { Snippet } from './detect';
import type { AppEnv, Env } from './env';
import { syncFriends, type FriendRow } from './friends';
import { endSession, getSessionUser, type SessionUser } from './session';

const app = new Hono<AppEnv>();

const SYNC_COOLDOWN_MS = 60 * 1000; // pressing sync again within a minute just returns the current data
// Players per page: every card has an excerpt to read, and five fit on about one screen
const PAGE_SIZE = 5;
// osu! friend limits (per the official supporter page, supporter raises it from 500 to 1000)
const FRIEND_LIMIT = { normal: 500, supporter: 1000 };

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
 * When logged in, players already on your friend list (as of your last sync) and you yourself are excluded.
 * Sort (sort=): each order has a matching index (migrations 0002, 0003, 0005); DESC puts nulls last.
 *   Every order ends with id so ties (e.g. equal follower counts) keep a fixed order and pages never repeat or skip anyone.
 *   recent    most recently online first (default; players who hide their online status come last)
 *   rank      best rank first (pp, highest first, which gives the same order as rank)
 *   followers most followers first
 * country=TW limits the list to one country (using the country-first indexes); missing or malformed = all countries
 */
const CANDIDATE_ORDER = {
    recent: 'p.last_visit DESC, p.id DESC',
    rank: 'p.pp DESC, p.id DESC',
    followers: 'p.follower_count DESC, p.id DESC',
} as const;

app.get('/api/candidates', async c => {
    const user = await getSessionUser(c);
    // page starts at 1; anything malformed means page 1. The upper bound only guards against absurd numbers
    const page = Math.min(Math.max(Math.floor(Number(c.req.query('page'))) || 1, 1), 100_000);
    const offset = (page - 1) * PAGE_SIZE;
    const country = c.req.query('country')?.toUpperCase() ?? '';
    const byCountry = /^[A-Z]{2}$/.test(country);
    // Only values from the list are accepted (ORDER BY can't be parameterised, so user input must never be spliced in)
    const sortParam = c.req.query('sort') ?? '';
    // Object.hasOwn rather than `in`: `in` also matches inherited properties (e.g. sort=constructor)
    const order = Object.hasOwn(CANDIDATE_ORDER, sortParam)
        ? CANDIDATE_ORDER[sortParam as keyof typeof CANDIDATE_ORDER]
        : CANDIDATE_ORDER.recent;

    const { results } = await c.env.DB.prepare(
        `SELECT p.id, p.username, p.avatar_url, p.country_code, p.global_rank, p.country_rank, p.pp, p.last_visit,
                p.pm_friends_only, p.follower_count, p.mutual_snippet
         FROM players AS p
         LEFT JOIN friendships AS f ON f.account_id = ?1 AND f.target_id = p.id
         WHERE p.mutual_level = 'mention'
           ${byCountry ? 'AND p.country_code = ?4' : ''}
           AND f.target_id IS NULL
           AND p.id != ?1
         ORDER BY ${order}
         LIMIT ?2 OFFSET ?3`,
    )
        // ?4 only exists in the SQL when filtering by country, so the fourth parameter is only bound then
        .bind(...([user?.osuUserId ?? 0, PAGE_SIZE + 1, offset, ...(byCountry ? [country] : [])] as const))
        .all<Record<string, unknown> & { mutual_snippet: string | null }>();

    // One extra row is fetched: if row PAGE_SIZE + 1 exists, there's a next page
    const candidates = results.slice(0, PAGE_SIZE).map(({ mutual_snippet, ...row }) => ({
        ...row,
        snippets: parseSnippets(mutual_snippet),
    }));
    return c.json({ candidates, hasMore: results.length > PAGE_SIZE });
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
