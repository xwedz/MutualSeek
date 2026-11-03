// A fake osu! API for scanner tests: every fetch to osu.ppy.sh is answered from an in-memory list of players, and
// every request is recorded so tests can check what the scanner asked for. The scanner runs in the same isolate as
// the tests, so replacing the global fetch reaches its requests too.
import { vi } from 'vitest';
import { RELAY_MARKER } from '../src/osu';

export interface FakePlayer {
    id: number;
    country: string;
    /** Online in the last 30 days (the ranking greys out inactive players) */
    active?: boolean;
    /** Has supporter right now (shown in the ranking) */
    supporter?: boolean;
    /** Has ever had supporter (only on the profile); without it there's no profile page */
    hasSupported?: boolean;
    /** The profile page's BBCode */
    page?: string;
    username?: string;
    pmFriendsOnly?: boolean;
    /** Answer the profile request with this status instead (e.g. 404 for a deleted account) */
    profileStatus?: number;
}

export interface FakeOsu {
    /** Ranking order per country is the order players were added; edit freely between runs */
    players: FakePlayer[];
    /** Every request the scanner sent, e.g. "GET /api/v2/users/5/osu?key=id" */
    requests: string[];
    /** Delays the scanner waited between requests (the 1 second gaps), in milliseconds */
    gaps: number[];
    /** Status to return for the next profile request of this player only, e.g. 500 once */
    failOnce: Map<number, number>;
    /** Answer API requests with 401 until a new token is requested */
    rejectToken: boolean;
    /** Answer every request with 429, as an HTML page without rate limit headers (like the one seen in production) */
    rateLimited: boolean;
    /** Send this Retry-After (seconds) with the 429 */
    retryAfter: number | null;
    /** Whether the relay at RELAY_URL answers; when it doesn't, Cloudflare's error page comes back instead */
    relayUp: boolean;
    /** When the relay is down, fail the request outright (a network error) instead of returning an error page */
    relayUnreachable: boolean;
    /** Requests that reached the relay, whether or not it was up */
    relayAttempts: number;
    /** Requests the relay forwarded to osu! (they're in `requests` too) */
    relayed: string[];
    /** The X-Relay-Secret header of each forwarded request */
    relaySecrets: (string | null)[];
}

/** Where tests point OSU_RELAY_URL */
export const RELAY_URL = 'https://relay.test';

const PAGE_SIZE = 50;
const REQUEST_GAP_MS = 1000; // src/crawler.ts
const RATE_LIMIT = 1200;

export function installFakeOsu(players: FakePlayer[] = []): FakeOsu {
    const osu: FakeOsu = {
        players,
        requests: [],
        gaps: [],
        failOnce: new Map(),
        rejectToken: false,
        rateLimited: false,
        retryAfter: null,
        relayUp: true,
        relayUnreachable: false,
        relayAttempts: 0,
        relayed: [],
        relaySecrets: [],
    };
    let tokenCount = 0;
    // Like the real API, every JSON answer says how many requests are left
    const json = (body: unknown, status = 200) =>
        Response.json(body, {
            status,
            headers: { 'X-RateLimit-Limit': String(RATE_LIMIT), 'X-RateLimit-Remaining': String(RATE_LIMIT - osu.requests.length) },
        });

    // The 1 second gaps would make every scanner run take 8 seconds; they're recorded and skipped instead.
    // Other timers (e.g. Vitest's own test timeout) keep their real delay.
    const realSetTimeout = globalThis.setTimeout as (handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => number;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
        if (ms === REQUEST_GAP_MS) {
            osu.gaps.push(ms);
            return realSetTimeout(handler, 0, ...args);
        }
        return realSetTimeout(handler, ms, ...args);
    }) as typeof setTimeout);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.origin === RELAY_URL) {
            osu.relayAttempts++;
            if (!osu.relayUp) {
                if (osu.relayUnreachable) throw new TypeError('Network connection lost.');
                // Like Cloudflare answering for a tunnel whose machine is off: an error page without the relay's marker
                return new Response('error code: 1033', { status: 530 });
            }
            osu.relaySecrets.push(request.headers.get('X-Relay-Secret'));
            osu.relayed.push(`${request.method} ${url.pathname}${url.search}`);
            const res = await answer(request, url);
            const marked = new Response(res.body, res);
            marked.headers.set(RELAY_MARKER, '1');
            return marked;
        }
        if (url.hostname !== 'osu.ppy.sh') throw new Error(`unexpected request to ${url.href}`);
        return answer(request, url);
    });

    // osu! itself: the same answers whether a request came directly or through the relay
    async function answer(request: Request, url: URL): Promise<Response> {
        osu.requests.push(`${request.method} ${url.pathname}${url.search}`);

        if (osu.rateLimited) {
            const headers: Record<string, string> = { 'Content-Type': 'text/html' };
            if (osu.retryAfter !== null) headers['Retry-After'] = String(osu.retryAfter);
            return new Response('<html>\n<head><title>429 Too Many Requests</title></head>\n</html>', { status: 429, headers });
        }

        if (url.pathname === '/oauth/token') {
            osu.rejectToken = false;
            return json({ access_token: `token-${++tokenCount}`, expires_in: 86400 });
        }
        if (osu.rejectToken) return json({ authentication: 'basic' }, 401);

        const countryRanking = url.pathname.match(/^\/api\/v2\/rankings\/osu\/country$/);
        if (countryRanking) {
            const counts = new Map<string, number>();
            for (const p of osu.players) if (p.active !== false) counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
            return json({ ranking: [...counts].map(([code, active_users]) => ({ code, active_users })), cursor: null });
        }

        if (url.pathname === '/api/v2/rankings/osu/performance') {
            const country = url.searchParams.get('country');
            const page = Number(url.searchParams.get('page') ?? 1);
            const inCountry = osu.players.filter(p => p.country === country);
            const slice = inCountry.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
            return json({
                ranking: slice.map(p => ({ user: compact(p), global_rank: null, pp: null })),
                cursor: page * PAGE_SIZE < inCountry.length ? { page: page + 1 } : null,
                total: inCountry.length,
            });
        }

        const profile = url.pathname.match(/^\/api\/v2\/users\/(\d+)\/osu$/);
        if (profile) {
            const id = Number(profile[1]);
            const failure = osu.failOnce.get(id);
            if (failure) {
                osu.failOnce.delete(id);
                return json({ error: 'temporary failure' }, failure);
            }
            const player = osu.players.find(p => p.id === id);
            if (!player || player.profileStatus === 404) return json({ error: null }, 404);
            if (player.profileStatus) return json({ error: 'failure' }, player.profileStatus);
            return json({
                ...compact(player),
                follower_count: 10,
                has_supported: player.hasSupported ?? true,
                page: { html: '', raw: player.page ?? '' },
                statistics: { global_rank: 1000 + id, country_rank: id, pp: 5000 },
            });
        }

        throw new Error(`the fake osu! API doesn't handle ${url.pathname}`);
    }

    return osu;
}

function compact(p: FakePlayer) {
    return {
        id: p.id,
        username: p.username ?? `player${p.id}`,
        avatar_url: `https://a.ppy.sh/${p.id}`,
        country_code: p.country,
        is_active: p.active ?? true,
        is_bot: false,
        is_deleted: false,
        is_supporter: p.supporter ?? false,
        last_visit: '2026-10-25T00:00:00Z',
        pm_friends_only: p.pmFriendsOnly ?? false,
    };
}

/** Only the osu! API calls, without the token requests */
export const apiRequests = (requests: string[]) => requests.filter(r => r.includes('/api/v2/'));
