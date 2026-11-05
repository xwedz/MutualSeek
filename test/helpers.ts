// Shared helpers for the API tests: requests to the Worker, logging in, and seeding the test database.
import { env, exports } from 'cloudflare:workers';
import { seal } from '../src/session';

export const DAY = 24 * 60 * 60 * 1000;

/** Empties every table, so each test starts from a known state (the schema stays) */
export async function resetDatabase() {
    await env.DB.batch(
        ['players', 'friendships', 'friend_events', 'accounts', 'opt_outs', 'non_supporters', 'kv'].map(table => env.DB.prepare(`DELETE FROM ${table}`)),
    );
}

interface RequestOptions {
    cookie?: string;
    method?: string;
    body?: unknown;
}

/** Sends a request straight to the Worker's fetch handler, like the browser would */
export function api(path: string, { cookie, method = 'GET', body }: RequestOptions = {}) {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return exports.default.fetch(
        new Request(`https://mutualseek.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    );
}

/** A session cookie signed the same way the login flow does it (src/session.ts) */
export async function sessionCookie(osuUserId: number) {
    const value = await seal(env.SESSION_SECRET, 'session', { osuUserId, username: `user${osuUserId}`, avatarUrl: null, countryCode: null }, DAY);
    return `mutual_session=${value}`;
}

/**
 * Creates the account row the login flow would create and returns a session cookie for it.
 * acceptGuidelines goes through the real POST /api/guidelines.
 */
export async function logIn(osuUserId: number, { acceptGuidelines = true } = {}) {
    await env.DB.prepare(
        `INSERT INTO accounts (osu_user_id, username, access_token, refresh_token, token_expires_at, created_at)
         VALUES (?1, ?2, '', '', 0, ?3)`,
    )
        .bind(osuUserId, `user${osuUserId}`, Date.now())
        .run();
    const cookie = await sessionCookie(osuUserId);
    if (acceptGuidelines) {
        const res = await api('/api/guidelines', { cookie, method: 'POST' });
        if (res.status !== 200) throw new Error(`accepting the guidelines failed: ${res.status}`);
    }
    return cookie;
}

export interface PlayerSeed {
    id: number;
    shuffleKey: number;
    country?: string;
    lastVisit?: number | null;
    snippets?: { text: string; hit: boolean }[][];
}

/** Inserts listed players (players who mention mutuals) with chosen shuffle keys, so the expected order is known */
export async function addPlayers(players: PlayerSeed[]) {
    await env.DB.batch(
        players.map(p =>
            env.DB.prepare(
                `INSERT INTO players (id, username, country_code, last_visit, pm_friends_only, scanned_at, mutual_level, mutual_score, mutual_snippet, shuffle_key)
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, 'mention', 1, ?7, ?6)`,
            ).bind(
                p.id,
                `player${p.id}`,
                p.country ?? 'TW',
                p.lastVisit === undefined ? Date.now() : p.lastVisit,
                Date.now(),
                p.shuffleKey,
                JSON.stringify(p.snippets ?? []),
            ),
        ),
    );
}

/** Puts target on account's friend list, as a friend list sync would */
export async function addFriend(accountId: number, targetId: number) {
    await env.DB.prepare(`INSERT INTO friendships (account_id, target_id, username, mutual) VALUES (?1, ?2, ?3, 0)`)
        .bind(accountId, targetId, `player${targetId}`)
        .run();
}

interface CandidatesPage {
    candidates: Record<string, unknown>[];
    hasMore: boolean;
}

/** Follows the pages from 1 until hasMore is false; returns every candidate id in order and the size of each page */
export async function pageThrough(query: string, cookie: string) {
    const ids: number[] = [];
    const pageSizes: number[] = [];
    for (let page = 1; page <= 100; page++) {
        const res = await api(`/api/candidates?page=${page}${query}`, { cookie });
        if (res.status !== 200) throw new Error(`page ${page}: HTTP ${res.status}`);
        const data = (await res.json()) as CandidatesPage;
        ids.push(...data.candidates.map(c => c.id as number));
        pageSizes.push(data.candidates.length);
        if (!data.hasMore) return { ids, pageSizes };
    }
    throw new Error('more than 100 pages');
}
