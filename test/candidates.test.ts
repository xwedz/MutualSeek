// The candidate list itself: paging, the shuffled order, filters and who is left out (src/index.ts, src/shuffle.ts)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ringStart } from '../src/shuffle';
import { addFriend, addPlayers, api, DAY, logIn, pageThrough, resetDatabase, type PlayerSeed } from './helpers';

const ME = 1001;
// A fixed clock: the shuffled order depends on the date, so tests shouldn't depend on when they run
const NOW = Date.UTC(2026, 9, 25, 12);

/** Players 1..n with keys spread evenly around the ring (0, 50M, 100M, ...) */
const spread = (n: number, extra: Partial<PlayerSeed> = {}): PlayerSeed[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, shuffleKey: i * 50_000_000, ...extra }));

/** The order a user should see: by key, starting at the first key at or after their start point, wrapping around */
function expectedOrder(players: PlayerSeed[], userId: number, now: number) {
    const start = ringStart(userId, now);
    const sorted = [...players].sort((a, b) => a.shuffleKey - b.shuffleKey || a.id - b.id);
    const firstIndex = sorted.findIndex(p => p.shuffleKey >= start);
    const rotated = firstIndex === -1 ? sorted : [...sorted.slice(firstIndex), ...sorted.slice(0, firstIndex)];
    return rotated.map(p => p.id);
}

let cookie: string;

beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    await resetDatabase();
    cookie = await logIn(ME);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('paging', () => {
    it('returns every player exactly once, five per page', async () => {
        await addPlayers(spread(12));
        const { ids, pageSizes } = await pageThrough('', cookie);
        expect(pageSizes).toEqual([5, 5, 2]);
        expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    });

    it('ends exactly on a full page without an empty extra page', async () => {
        await addPlayers(spread(10));
        expect((await pageThrough('', cookie)).pageSizes).toEqual([5, 5]);
    });

    it('treats a malformed page number as page 1', async () => {
        await addPlayers(spread(7));
        const first = await (await api('/api/candidates?page=1', { cookie })).json();
        for (const page of ['abc', '-3', '0', '1.7']) {
            expect(await (await api(`/api/candidates?page=${page}`, { cookie })).json()).toEqual(first);
        }
    });

    it('only sends the fields the cards need (no ordering internals)', async () => {
        await addPlayers(spread(1));
        const { candidates } = (await (await api('/api/candidates', { cookie })).json()) as { candidates: Record<string, unknown>[] };
        expect(candidates[0]).not.toHaveProperty('shuffle_key');
        expect(candidates[0]).not.toHaveProperty('part');
        expect(candidates[0]).not.toHaveProperty('mutual_snippet');
        expect(candidates[0]?.snippets).toEqual([]);
    });
});

describe('shuffled order', () => {
    it("starts at the user's point on the ring and wraps around", async () => {
        const players = spread(20);
        await addPlayers(players);
        expect((await pageThrough('', cookie)).ids).toEqual(expectedOrder(players, ME, NOW));
    });

    it('gives different users different starting points', async () => {
        const players = spread(20);
        await addPlayers(players);
        // Pick another user whose start point lands in a different gap, so their first player differs from mine
        const mine = expectedOrder(players, ME, NOW)[0];
        let other = 2001;
        while (expectedOrder(players, other, NOW)[0] === mine) other++;
        const otherCookie = await logIn(other);

        const otherIds = (await pageThrough('', otherCookie)).ids;
        expect(otherIds).toEqual(expectedOrder(players, other, NOW));
        expect(otherIds[0]).not.toBe(mine);
    });

    it('stays the same during the day and moves the next day', async () => {
        const players = spread(20);
        await addPlayers(players);
        const morning = (await pageThrough('', cookie)).ids;

        vi.setSystemTime(NOW + 6 * 60 * 60 * 1000); // later the same UTC day
        expect((await pageThrough('', cookie)).ids).toEqual(morning);

        vi.setSystemTime(NOW + DAY);
        const nextDay = (await pageThrough('', cookie)).ids;
        expect(nextDay).toEqual(expectedOrder(players, ME, NOW + DAY));
        // Checked without ringStart too, so this still fails if ringStart itself stopped using the date
        expect(nextDay).not.toEqual(morning);
    });
});

describe('filters', () => {
    it('limits the list to one country', async () => {
        await addPlayers([...spread(4, { country: 'TW' }), { id: 50, shuffleKey: 7, country: 'JP' }, { id: 51, shuffleKey: 8, country: 'JP' }]);
        const { ids } = await pageThrough('&country=JP', cookie);
        expect([...ids].sort()).toEqual([50, 51]);
    });

    it('ignores a malformed country and shows all countries', async () => {
        await addPlayers([{ id: 1, shuffleKey: 1, country: 'TW' }, { id: 2, shuffleKey: 2, country: 'JP' }]);
        expect((await pageThrough("&country=x' OR 1=1", cookie)).ids).toHaveLength(2);
    });

    it('"Online in the past week" keeps players seen in the last 7 days only', async () => {
        await addPlayers([
            { id: 1, shuffleKey: 1, lastVisit: NOW - DAY },
            { id: 2, shuffleKey: 2, lastVisit: NOW - 6 * DAY },
            { id: 3, shuffleKey: 3, lastVisit: NOW - 8 * DAY },
            { id: 4, shuffleKey: 4, lastVisit: null }, // hides their online status
        ]);
        expect([...(await pageThrough('&active=1', cookie)).ids].sort()).toEqual([1, 2]);
        expect((await pageThrough('', cookie)).ids).toHaveLength(4);
    });
});

describe('who is left out', () => {
    it('hides players already on your friend list', async () => {
        await addPlayers(spread(3));
        await addFriend(ME, 2);
        expect([...(await pageThrough('', cookie)).ids].sort()).toEqual([1, 3]);
    });

    it("doesn't list you to yourself", async () => {
        await addPlayers([...spread(2), { id: ME, shuffleKey: 123 }]);
        expect((await pageThrough('', cookie)).ids).not.toContain(ME);
    });

    it('only hides your own friends, not other users\' friends', async () => {
        await addPlayers(spread(3));
        await addFriend(9999, 2); // someone else's friend list
        expect((await pageThrough('', cookie)).ids).toHaveLength(3);
    });
});
