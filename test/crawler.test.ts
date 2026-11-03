// The background scanner (src/crawler.ts) against a fake osu! API (test/fake-osu.ts).
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runCrawler } from '../src/crawler';
import type { Env } from '../src/env';
import { apiRequests, installFakeOsu, type FakeOsu, type FakePlayer } from './fake-osu';
import { DAY, resetDatabase } from './helpers';

const NOW = Date.UTC(2026, 9, 25, 12);
const MENTION = 'Feel free to add me for mutuals!';

// Scan one country unless a test says otherwise; never paused
const scanEnv = (overrides: Partial<Env> = {}): Env => ({ ...env, SCAN_COUNTRIES: 'TW', SCAN_PAUSE: '', ...overrides });

interface ScanState {
    countries: string[];
    pending: number[];
    passScanned: number;
    passSkipped: number;
}
const readState = async () => {
    const row = await env.DB.prepare("SELECT value FROM kv WHERE key = 'crawler:state'").first<{ value: string }>();
    return row ? (JSON.parse(row.value) as ScanState) : null;
};
const storedIds = async () => (await env.DB.prepare('SELECT id FROM players ORDER BY id').all<{ id: number }>()).results.map(r => r.id);
const nonSupporterIds = async () => (await env.DB.prepare('SELECT id FROM non_supporters ORDER BY id').all<{ id: number }>()).results.map(r => r.id);

/** One scanner run (one Cron Trigger); returns the API requests it sent */
async function runOnce(osu: FakeOsu, overrides: Partial<Env> = {}) {
    const before = osu.requests.length;
    await runCrawler(scanEnv(overrides));
    return apiRequests(osu.requests.slice(before));
}

/** Runs until the current pass is over (every country read and the queue empty); returns the requests of each run */
async function runPass(osu: FakeOsu, overrides: Partial<Env> = {}) {
    const runs: string[][] = [];
    for (let i = 0; i < 100; i++) {
        runs.push(await runOnce(osu, overrides));
        const state = await readState();
        if (state && state.countries.length === 0 && state.pending.length === 0) return runs;
    }
    throw new Error('the pass did not finish within 100 runs');
}

const profileRequests = (requests: string[]) => requests.filter(r => r.includes('/users/')).map(r => Number(r.match(/users\/(\d+)/)![1]));

/** n players in one country, by default active supporters who mention mutuals */
const many = (n: number, from = 1, extra: Partial<FakePlayer> = {}): FakePlayer[] =>
    Array.from({ length: n }, (_, i) => ({ id: from + i, country: 'TW', page: MENTION, ...extra }));

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetDatabase();
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('request volume (the rate promised to the osu! team)', () => {
    it('sends at most 9 API requests per run, one second apart', async () => {
        const osu = installFakeOsu(many(120)); // three ranking pages
        const runs = await runPass(osu);

        expect(runs.length).toBeGreaterThan(10);
        for (const requests of runs) expect(requests.length).toBeLessThanOrEqual(9);
        // 120 profiles + 3 ranking pages, nothing requested twice
        expect(runs.flat()).toHaveLength(123);
        // Between n requests in a run there are n - 1 waits of one second
        expect(osu.gaps).toHaveLength(runs.reduce((sum, r) => sum + Math.max(r.length - 1, 0), 0));
    });

    it('reuses the app token instead of requesting one every run', async () => {
        const osu = installFakeOsu(many(30));
        await runPass(osu);
        expect(osu.requests.filter(r => r.includes('/oauth/token'))).toHaveLength(1);
    });

    it('makes no requests while paused with SCAN_PAUSE = "now"', async () => {
        const osu = installFakeOsu(many(10));
        expect(await runCrawler(scanEnv({ SCAN_PAUSE: 'now' }))).toMatch(/^paused/);
        expect(osu.requests).toEqual([]);
    });

    it('waits 30 days after a pass started before starting the next one', async () => {
        const osu = installFakeOsu(many(5));
        await runPass(osu);

        vi.setSystemTime(NOW + 29 * DAY);
        expect(await runOnce(osu)).toEqual([]);

        vi.setSystemTime(NOW + 30 * DAY);
        expect((await runOnce(osu)).length).toBeGreaterThan(0);
    });
});

describe('what gets stored', () => {
    it('stores only active players who mention mutuals, and never fetches inactive profiles', async () => {
        const osu = installFakeOsu([
            { id: 1, country: 'TW', page: MENTION },
            { id: 2, country: 'TW', page: 'I like farming pp' },
            { id: 3, country: 'TW', page: MENTION, active: false },
        ]);
        const requests = (await runPass(osu)).flat();

        expect(await storedIds()).toEqual([1]);
        expect(profileRequests(requests)).not.toContain(3);
        const row = await env.DB.prepare('SELECT country_code, mutual_snippet FROM players WHERE id = 1').first<{ country_code: string; mutual_snippet: string }>();
        expect(row?.country_code).toBe('TW');
        expect(row?.mutual_snippet).toContain('mutuals');
    });

    it("doesn't store players who chose Don't list me", async () => {
        await env.DB.prepare('INSERT INTO opt_outs (id, created_at) VALUES (2, 0)').run();
        const osu = installFakeOsu(many(3));
        await runPass(osu);
        expect(await storedIds()).toEqual([1, 3]);
    });

    it('keeps the shuffle key on later passes while updating the profile', async () => {
        const osu = installFakeOsu(many(1));
        await runPass(osu);
        const first = await env.DB.prepare('SELECT shuffle_key FROM players WHERE id = 1').first<{ shuffle_key: number }>();

        osu.players[0]!.username = 'renamed';
        vi.setSystemTime(NOW + 31 * DAY);
        await runPass(osu);
        const second = await env.DB.prepare('SELECT username, shuffle_key FROM players WHERE id = 1').first<{ username: string; shuffle_key: number }>();
        expect(second?.username).toBe('renamed');
        expect(second?.shuffle_key).toBe(first?.shuffle_key);
    });

    it('drops a stored player who removed the mention, went inactive, or left the rankings', async () => {
        const osu = installFakeOsu(many(4));
        await runPass(osu);
        expect(await storedIds()).toEqual([1, 2, 3, 4]);

        // 1 edits the text so the keyword is gone ("no mutuals" would still be listed: only the word is checked)
        osu.players[0]!.page = 'Just here to farm pp';
        osu.players[1]!.active = false; // 2 stops playing
        osu.players.splice(2, 1); // 3 drops out of the top 10,000
        vi.setSystemTime(NOW + 31 * DAY);
        await runPass(osu);
        expect(await storedIds()).toEqual([4]);
    });
});

describe('players who never had supporter', () => {
    it('are remembered and skipped in the next pass', async () => {
        const osu = installFakeOsu([...many(2), { id: 3, country: 'TW', hasSupported: false }]);
        await runPass(osu);
        expect(await nonSupporterIds()).toEqual([3]);

        vi.setSystemTime(NOW + 31 * DAY);
        const secondPass = (await runPass(osu)).flat();
        expect(profileRequests(secondPass)).not.toContain(3);
        expect((await readState())?.passSkipped).toBe(1);
    });

    it('are scanned again once they buy supporter, and forgotten', async () => {
        const osu = installFakeOsu([{ id: 3, country: 'TW', hasSupported: false }]);
        await runPass(osu);
        expect(await nonSupporterIds()).toEqual([3]);

        Object.assign(osu.players[0]!, { supporter: true, hasSupported: true, page: MENTION });
        vi.setSystemTime(NOW + 31 * DAY);
        const secondPass = (await runPass(osu)).flat();
        expect(profileRequests(secondPass)).toContain(3);
        expect(await nonSupporterIds()).toEqual([]);
        expect(await storedIds()).toEqual([3]);
    });
});

describe('osu! API errors', () => {
    it('treats a missing profile (404) as gone and removes the stored player', async () => {
        const osu = installFakeOsu(many(2));
        await runPass(osu);

        osu.players[0]!.profileStatus = 404; // restricted or deleted
        vi.setSystemTime(NOW + 31 * DAY);
        await runPass(osu);
        expect(await storedIds()).toEqual([2]);
    });

    it('stops the run on other errors and picks the player up again next run', async () => {
        const osu = installFakeOsu(many(3));
        osu.failOnce.set(2, 500);

        const firstRun = await runOnce(osu);
        expect(profileRequests(firstRun)).toEqual([1, 2]); // stopped at the failure
        expect((await readState())?.pending).toEqual([2, 3]); // 2 is still queued
        expect(await storedIds()).toEqual([1]); // work done before the error is kept

        await runPass(osu);
        expect(await storedIds()).toEqual([1, 2, 3]);
    });

    it('gets a new token and retries once when the cached one is rejected (401)', async () => {
        const osu = installFakeOsu(many(1));
        await runOnce(osu); // caches the first token
        osu.rejectToken = true;
        vi.setSystemTime(NOW + 31 * DAY);
        await runPass(osu);
        expect(osu.requests.filter(r => r.includes('/oauth/token'))).toHaveLength(2);
        expect(await storedIds()).toEqual([1]);
    });
});

describe('429 from osu! (too many requests)', () => {
    const MINUTE = 60 * 1000;

    /** One run; how many requests it sent to osu!, token requests included */
    async function countRequests(osu: FakeOsu) {
        const before = osu.requests.length;
        await runCrawler(scanEnv());
        return osu.requests.length - before;
    }

    let errorLog: MockInstance<typeof console.error>;
    beforeEach(() => {
        errorLog = vi.spyOn(console, 'error').mockImplementation(() => {}); // each 429 is logged as "scan stopped"
    });

    it('sends nothing for 15 minutes, then waits twice as long each time, up to a day', async () => {
        const osu = installFakeOsu(many(30));
        osu.rateLimited = true;
        expect(await countRequests(osu)).toBe(1); // stops at the first 429

        let at = NOW;
        for (const wait of [15, 30, 60, 120, 240, 480, 960, 1440, 1440]) {
            vi.setSystemTime(at + (wait - 1) * MINUTE);
            expect(await countRequests(osu)).toBe(0);
            at += wait * MINUTE;
            vi.setSystemTime(at);
            expect(await countRequests(osu)).toBe(1); // tries once, gets 429 again
        }
    });

    it('goes back to 15 minutes after a run without a 429', async () => {
        const osu = installFakeOsu(many(30));
        osu.rateLimited = true;
        await countRequests(osu); // 429: wait 15 minutes
        vi.setSystemTime(NOW + 15 * MINUTE);
        await countRequests(osu); // 429 again: wait 30 minutes

        vi.setSystemTime(NOW + 45 * MINUTE);
        osu.rateLimited = false;
        expect(await countRequests(osu)).toBeGreaterThan(1); // scanning normally

        osu.rateLimited = true;
        await countRequests(osu); // 429: 15 minutes again, not 60
        vi.setSystemTime(NOW + 59 * MINUTE);
        expect(await countRequests(osu)).toBe(0);
        vi.setSystemTime(NOW + 60 * MINUTE);
        expect(await countRequests(osu)).toBe(1);
    });

    it('waits longer when osu! asks for it with Retry-After', async () => {
        const osu = installFakeOsu(many(30));
        osu.rateLimited = true;
        osu.retryAfter = 60 * 60;
        await countRequests(osu);
        vi.setSystemTime(NOW + 59 * MINUTE);
        expect(await countRequests(osu)).toBe(0);
        vi.setSystemTime(NOW + 60 * MINUTE);
        expect(await countRequests(osu)).toBe(1);
    });

    it('picks up where it stopped once osu! answers again', async () => {
        const osu = installFakeOsu(many(3));
        osu.rateLimited = true;
        await countRequests(osu);
        osu.rateLimited = false;
        vi.setSystemTime(NOW + 15 * MINUTE);
        await runPass(osu);
        expect(await storedIds()).toEqual([1, 2, 3]);
    });

    it("logs the rate limit headers of the last successful response, even when the run ends in a 429", async () => {
        const osu = installFakeOsu(many(30));
        expect(await runCrawler(scanEnv())).toMatch(/osu! rate limit \(last OK response\): remaining \d+\/1200$/);

        // A few profiles answer, then a 429. The fake counts down with every request, so the 429 itself (one request
        // later) would say one less: the summary must show the last successful one
        osu.failOnce.set(12, 429);
        const summary = await runCrawler(scanEnv());
        const remaining = 1200 - osu.requests.length + 1;
        expect(summary).toMatch(new RegExp(`osu! rate limit \\(last OK response\\): remaining ${remaining}/1200, waiting 15 min after a 429$`));
    });

    it('says so when a 429 comes without rate limit headers', async () => {
        const osu = installFakeOsu(many(30));
        await runCrawler(scanEnv());

        osu.rateLimited = true;
        osu.retryAfter = 60;
        // Nothing succeeded in this run, so the summary has no rate limit part; the error has the 429's own headers
        expect(await runCrawler(scanEnv())).toMatch(/queued: \d+, waiting 15 min after a 429$/);
        expect(String(errorLog.mock.calls[0])).toContain('failed (429; retry-after 60s): <html> <head>');

        osu.retryAfter = null;
        vi.setSystemTime(NOW + 15 * 60 * 1000);
        await runCrawler(scanEnv());
        expect(String(errorLog.mock.calls[1])).toContain('failed (429; no rate limit headers)');
    });
});

describe('countries', () => {
    it('with SCAN_COUNTRIES = "all", scans countries with the most active players first', async () => {
        const osu = installFakeOsu([...many(1, 1, { country: 'JP' }), ...many(3, 10, { country: 'US' }), ...many(2, 20, { country: 'BR' })]);
        const requests = (await runPass(osu, { SCAN_COUNTRIES: 'all' })).flat();
        const order = requests.filter(r => r.includes('/rankings/osu/performance')).map(r => new URL(`https://x${r.slice(4)}`).searchParams.get('country'));
        expect(order).toEqual(['US', 'BR', 'JP']);
        expect(await storedIds()).toEqual([1, 10, 11, 12, 20, 21]);
    });
});
