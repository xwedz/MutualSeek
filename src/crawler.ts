// src/crawler.ts — the background scanner (called by the Cron Trigger once a minute).
//
// It reads the rankings and scans profiles as it goes, and only stores players who mention mutuals.
//
//   A pass = every country's ranking (top 10,000, 50 per page), countries ordered by active players, most first.
//   For each ranking page:
//     - inactive players (is_active = false, shown greyed out on the osu! website) are skipped, and deleted if stored
//     - players who never had supporter and still don't (see the non_supporters table) are skipped: they can't have a profile page
//     - everyone else is queued and their profile is fetched one by one:
//         mentions mutuals → stored (or updated)
//         doesn't          → not stored; deleted if stored before (they removed the text)
//   A country is done → delete that country's players this pass didn't see again (dropped out of the top 10,000, etc.)
//   Every country is done → the pass ends; the next one starts at least 30 days after this one started
//
// Why not store every player: there are about 375,000 active players in the rankings worldwide. Storing only the
// ~6% who mention mutuals keeps writes and storage far smaller. The trade-off is that every pass rescans active
// players (except those who never had supporter).
//
// Request volume: following the osu! API usage guidelines, and as described to the osu! team, one pass a month at
// about 9 requests per minute on average (~375,000 profiles + ~13,600 ranking pages ≈ 389,000 requests ÷ 30 days).
// Do not raise either number.
//
// Per-run limits:
//   - at most 9 requests per run, one second apart (the osu! API limit is 60 per minute)
//   - after a 429 (too many requests), no requests at all for 2 minutes, doubling each time it happens again
//     (up to an hour, or longer if osu! asks for it with Retry-After); a run without a 429 resets it.
//     Short at first so a one-off 429 costs little; capped at an hour so scanning picks up soon after a long block ends.
//   - Workers Free: at most 50 subrequests per run (D1 queries included) and 10 ms of CPU time
//   - D1 Free: at most 50 queries per run, so each batch is sent as one JSON parameter and expanded with json_each

import { detectMutualMention } from './detect';
import type { Env } from './env';
import { NEW_SHUFFLE_KEY_SQL } from './shuffle';
import {
    apiGet,
    formatRateLimit,
    getAppToken,
    OsuApiError,
    parseTime,
    type CountryRankingResponse,
    type OsuUser,
    type RankingResponse,
    type RateLimitInfo,
} from './osu';

const MAX_REQUESTS_PER_RUN = 9;
const REQUEST_GAP_MS = 1000;
// Stop sending new requests after this long: a run starts every minute, so a slow one would overlap the next
const RUN_DEADLINE_MS = 50 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Exponential backoff after a 429, as the osu! API guidelines suggest
const BACKOFF_START_MS = 2 * MINUTE_MS;
const BACKOFF_MAX_MS = 60 * MINUTE_MS;
const MIN_PASS_INTERVAL_MS = 30 * DAY_MS;
// Stats (including per-country counts for the country menu) are recomputed hourly. They only read players who
// mention mutuals (a few tens of thousands worldwide), about 800,000 rows read a day, 16% of the free allowance
const STATS_REFRESH_MS = 60 * 60 * 1000;

const STATE_KEY = 'crawler:state';
const STATS_KEY = 'crawler:stats';

interface CrawlerState {
    countries: string[]; // countries in this pass, ordered by active players; empty = not in a pass
    countryIndex: number;
    nextPage: number;
    countryStartedAt: number; // when the current country started; used to find players this pass didn't see
    pending: number[]; // active players read from the rankings but not scanned yet
    passStartedAt: number;
    passScanned: number; // profiles scanned this pass
    passSkipped: number; // players skipped this pass because they never had supporter (requests saved)
    lastPassScanned: number | null; // profiles scanned in the previous pass (recorded when a pass ends)
    statsUpdatedAt: number;
    backoffMs: number; // the current wait after a 429; 0 = no recent 429
    backoffUntil: number; // no requests before this time
}

export interface CrawlerStats {
    mentioned: number;
    byCountry: { code: string; count: number }[]; // largest first
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
    passSkipped: 0,
    lastPassScanned: null,
    statsUpdatedAt: 0,
    backoffMs: 0,
    backoffUntil: 0,
});

/**
 * Splits a ranking page into three groups:
 *   inactive: not active, skipped (and deleted if stored)
 *   skipped : never had supporter (in knownNonSupporters) and the ranking shows they still aren't → can't have a
 *             profile page, skipped
 *   toScan  : everyone else; their profile gets fetched
 * If a field is missing (e.g. the API changed), the player is scanned: better to spend a request than miss someone.
 */
export function splitRankingPage(entries: RankingResponse['ranking'], knownNonSupporters: ReadonlySet<number>) {
    const toScan: number[] = [];
    const inactive: number[] = [];
    let skipped = 0;
    for (const { user } of entries) {
        if (user.is_active === false) inactive.push(user.id);
        else if (user.is_supporter === false && knownNonSupporters.has(user.id)) skipped++;
        else toScan.push(user.id);
    }
    return { toScan, inactive, skipped };
}

/** Which of these players are known to have never had supporter */
async function loadNonSupporters(db: D1Database, ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const { results } = await db
        .prepare('SELECT id FROM non_supporters WHERE id IN (SELECT value FROM json_each(?1))')
        .bind(JSON.stringify(ids))
        .all<{ id: number }>();
    return new Set(results.map(r => r.id));
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

type ApiGet = <T>(path: string) => Promise<T>;

/** Countries for this pass: with "all", read the country ranking and order by active players, most first. */
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

/** Paused when SCAN_PAUSE = "now", or when the given country is done this pass and its last page has been scanned */
function isPaused(env: Env, state: CrawlerState): boolean {
    const code = env.SCAN_PAUSE?.trim().toUpperCase();
    if (!code) return false;
    if (code === 'NOW') return true;
    const index = state.countries.indexOf(code);
    return index !== -1 && index < state.countryIndex && state.pending.length === 0;
}

export async function runCrawler(env: Env): Promise<string> {
    const db = env.DB;
    const startedAt = Date.now();
    // Older versions stored a different state shape (no countries field); treat that as a fresh start
    const saved = await readKv<Partial<CrawlerState>>(db, STATE_KEY);
    const state: CrawlerState = saved && Array.isArray(saved.countries) ? { ...initialState(), ...saved } : initialState();
    if (isPaused(env, state)) return `paused (SCAN_PAUSE = ${env.SCAN_PAUSE})`;
    if (startedAt < state.backoffUntil) {
        return `waiting until ${new Date(state.backoffUntil).toISOString()} after a 429 from osu! (backoff ${state.backoffMs / MINUTE_MS} min)`;
    }

    // The token is only read (or requested) once a request is needed, so a token request that fails is handled
    // like any other API error below
    let token: string | null = null;
    let tokenRenewed = false;
    // From the latest successful osu! response, logged with the summary. Not overwritten by an error, so a run that
    // ends in a 429 still shows how much of the API's own limit was left just before it
    let rateLimit: RateLimitInfo | null = null;
    const onRateLimit = (info: RateLimitInfo) => {
        rateLimit = info;
    };

    // Every API call goes through here. A 401 means the cached token stopped working before it expired (e.g. the
    // OAuth app was replaced), so get a new one and retry once. Only once: if the new token also gets a 401
    // (e.g. a wrong secret), the error is thrown instead of retrying forever.
    const get: ApiGet = async <T>(path: string) => {
        token ??= await getAppToken(env);
        try {
            return await apiGet<T>(path, token, { onRateLimit });
        } catch (err) {
            if (tokenRenewed || !(err instanceof OsuApiError && err.status === 401)) throw err;
            tokenRenewed = true;
            console.warn('[crawler] app token rejected (401), requesting a new one and retrying');
            token = await getAppToken(env, true);
            return apiGet<T>(path, token, { onRateLimit });
        }
    };

    let requests = 0;
    const canRequest = () => requests < MAX_REQUESTS_PER_RUN && Date.now() - startedAt < RUN_DEADLINE_MS;
    const request = async () => {
        if (requests++ > 0) await sleep(REQUEST_GAP_MS);
    };

    const upserts: PlayerRow[] = [];
    const removals: number[] = []; // inactive, no mention, or the account no longer exists
    const finishedCountries: { code: string; startedAt: number }[] = [];
    const nonSupporters: number[] = []; // scanned this run, never had supporter
    const supporters: number[] = []; // scanned this run, has had supporter
    let pagesRead = 0;
    let scanned = 0;
    let skipped = 0;
    let stopped: unknown = null;

    try {
        // ---------- Start a new pass (once the previous queue is empty, and at least 30 days after the last pass started) ----------
        if (state.countries.length === 0 && state.pending.length === 0 && startedAt - state.passStartedAt >= MIN_PASS_INTERVAL_MS) {
            state.countries = await loadCountries(env, get, request);
            Object.assign(state, {
                countryIndex: 0,
                nextPage: 1,
                countryStartedAt: startedAt,
                passStartedAt: startedAt,
                passScanned: 0,
                passSkipped: 0,
            });
        }

        // Keep going while there are countries left or players queued (right after a pass ends, the last page is still queued)
        while (canRequest() && (state.countries.length > 0 || state.pending.length > 0) && !isPaused(env, state)) {
            // ---------- Queue is empty: read the next ranking page ----------
            if (state.pending.length === 0) {
                const country = state.countries[state.countryIndex]!;
                await request();
                const res = await get<RankingResponse>(`/rankings/${env.SCAN_MODE}/performance?country=${country}&page=${state.nextPage}`);
                pagesRead++;
                // Only active players who aren't supporters right now need to be looked up in non_supporters
                const candidates = res.ranking.filter(e => e.user.is_active !== false && e.user.is_supporter === false).map(e => e.user.id);
                const page = splitRankingPage(res.ranking, await loadNonSupporters(db, candidates));
                state.pending.push(...page.toScan);
                removals.push(...page.inactive);
                state.passSkipped += page.skipped;
                skipped += page.skipped;

                if (res.cursor?.page) {
                    state.nextPage = res.cursor.page;
                } else {
                    // This country is done (the rest of this page is still queued and will be scanned)
                    finishedCountries.push({ code: country, startedAt: state.countryStartedAt });
                    state.countryIndex++;
                    state.nextPage = 1;
                    state.countryStartedAt = Date.now();
                    if (state.countryIndex >= state.countries.length) {
                        state.lastPassScanned = state.passScanned + state.pending.length;
                        state.countries = []; // the pass is over (the queue is still scanned to the end)
                    }
                }
                continue;
            }

            // ---------- Scan one player's profile ----------
            const id = state.pending[0]!;
            await request();
            try {
                const user = await get<OsuUser>(`/users/${id}/${env.SCAN_MODE}?key=id`);
                // Remember players who never had supporter so the next pass can skip them; remove anyone who has
                // (e.g. bought supporter in the meantime)
                if (user.has_supported === false) nonSupporters.push(id);
                else supporters.push(id);
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
                // 404: the account was restricted or deleted, treated as no mention. Any other error (429, osu! is
                // down) stops this run; the player stays queued for the next one
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

    // ---------- 429: wait before the next request, twice as long as last time; any other outcome resets the wait ----------
    const tooManyRequests = stopped instanceof OsuApiError && stopped.status === 429 ? stopped : null;
    if (tooManyRequests) {
        state.backoffMs = Math.min(state.backoffMs > 0 ? state.backoffMs * 2 : BACKOFF_START_MS, BACKOFF_MAX_MS);
        // If osu! asks for a longer wait, that wins
        state.backoffUntil = Date.now() + Math.max(state.backoffMs, (tooManyRequests.rateLimit.retryAfterSeconds ?? 0) * 1000);
    } else if (requests > 0) {
        state.backoffMs = 0;
    }

    // ---------- Write to the database: everything in one batch (a transaction), so nothing is half-written ----------
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];

    if (removals.length > 0) {
        // Deleting players that were never stored costs no writes
        statements.push(db.prepare('DELETE FROM players WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(removals)));
    }

    if (upserts.length > 0) {
        statements.push(
            db
                .prepare(
                    // shuffle_key is only set on insert (it's not in the UPDATE list below), so a player keeps their place in the shuffled order
                    `INSERT INTO players (id, username, avatar_url, country_code, global_rank, country_rank, pp, follower_count,
                                          last_visit, pm_friends_only, scanned_at, mutual_level, mutual_score, mutual_snippet, shuffle_key)
                     SELECT p.value ->> 'id', p.value ->> 'username', p.value ->> 'avatarUrl', p.value ->> 'countryCode',
                            p.value ->> 'globalRank', p.value ->> 'countryRank', p.value ->> 'pp', p.value ->> 'followerCount',
                            p.value ->> 'lastVisit', p.value ->> 'pmFriendsOnly', ?2, 'mention', p.value ->> 'count', p.value ->> 'snippets',
                            ${NEW_SHUFFLE_KEY_SQL}
                     FROM json_each(?1) AS p
                     -- Players who chose "Don't list me" are not stored (this WHERE also satisfies SQLite's parsing rule for INSERT…SELECT…ON CONFLICT)
                     WHERE (p.value ->> 'id') NOT IN (SELECT id FROM opt_outs)
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

    if (nonSupporters.length > 0) {
        statements.push(
            db
                .prepare('INSERT INTO non_supporters (id) SELECT value FROM json_each(?1) WHERE true ON CONFLICT (id) DO NOTHING')
                .bind(JSON.stringify(nonSupporters)),
        );
    }

    if (supporters.length > 0) {
        // Deleting ids that aren't in the table costs no writes
        statements.push(db.prepare('DELETE FROM non_supporters WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(supporters)));
    }

    for (const { code, startedAt: countryStartedAt } of finishedCountries) {
        // Players of this country that this pass didn't see again: dropped out of the top 10,000, changed country, etc.
        // Players still in the queue count as seen and must not be deleted (they're scanned later).
        // mutual_level = 'mention' doesn't change the result (the table only holds such players), but without it SQLite
        // can't use the partial index and reads the whole table. Near the end of a pass, over a hundred small countries
        // finish in a day, which could approach the 5 million rows read per day limit.
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

    // ---------- Stats (hourly; only counts players who mention mutuals, using the partial index) ----------
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

    const where = state.countries.length > 0 ? `${state.countries[state.countryIndex]} page ${state.nextPage}` : 'pass finished, waiting for the next one';
    let summary = `read ${pagesRead} ranking pages, scanned ${scanned} (${upserts.length} mention mutuals), skipped ${skipped} non-supporters, removed ${removals.length}, at: ${where}, queued: ${state.pending.length}`;
    if (rateLimit) summary += `, osu! rate limit (last OK response): ${formatRateLimit(rateLimit)}`;
    if (tooManyRequests) summary += `, waiting ${Math.round((state.backoffUntil - Date.now()) / MINUTE_MS)} min after a 429`;
    if (stopped) console.error(`scan stopped (${summary}):`, stopped);
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
