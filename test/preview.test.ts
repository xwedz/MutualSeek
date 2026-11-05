// Find people before logging in: a few excerpts without names (GET /api/preview in src/index.ts)
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHUFFLE_RANGE } from '../src/shuffle';
import { addPlayers, api, resetDatabase, type PlayerSeed } from './helpers';

interface Preview {
    players: { country_code: string | null; snippet: { text: string; hit: boolean }[] }[];
}

const snippet = (id: number) => [[{ text: `excerpt of ${id} `, hit: false }, { text: 'mutual', hit: true }]];

/** Players 1..n with keys spread evenly around the ring, each with two excerpts */
const spread = (n: number, extra: Partial<PlayerSeed> = {}): PlayerSeed[] =>
    Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        shuffleKey: i * (SHUFFLE_RANGE / n),
        snippets: [...snippet(i + 1), [{ text: 'second excerpt', hit: false }]],
        ...extra,
    }));

async function preview() {
    const res = await api('/api/preview');
    expect(res.status).toBe(200);
    return (await res.json()) as Preview;
}

beforeEach(async () => {
    await resetDatabase();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('GET /api/preview', () => {
    it('works without logging in and shows five players', async () => {
        await addPlayers(spread(12));
        expect((await preview()).players).toHaveLength(5);
    });

    it("only sends the country and the first excerpt, never who they are", async () => {
        await addPlayers(spread(3));
        const { players } = await preview();
        for (const p of players) expect(Object.keys(p).sort()).toEqual(['country_code', 'snippet']);
        expect(players.map(p => p.snippet[0]?.text)).toEqual(expect.arrayContaining(['excerpt of 1 ']));
        expect(JSON.stringify(players)).not.toMatch(/player\d|second excerpt/);
    });

    it('wraps around the end of the ring', async () => {
        await addPlayers(spread(10));
        vi.spyOn(Math, 'random').mockReturnValue(0.85); // starts between the last two keys
        const texts = (await preview()).players.map(p => p.snippet[0]?.text);
        expect(texts).toEqual(['excerpt of 10 ', 'excerpt of 1 ', 'excerpt of 2 ', 'excerpt of 3 ', 'excerpt of 4 ']);
    });

    it('starts somewhere else on the next request', async () => {
        await addPlayers(spread(10));
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.5);
        const first = (await preview()).players.map(p => p.snippet[0]?.text);
        const second = (await preview()).players.map(p => p.snippet[0]?.text);
        expect(first[0]).toBe('excerpt of 1 ');
        expect(second[0]).toBe('excerpt of 6 ');
    });

    it('leaves out the country the first pass is still scanning', async () => {
        await addPlayers([...spread(3, { country: 'TW' }), { id: 10, shuffleKey: 5, country: 'KR', snippets: snippet(10) }]);
        const state = { countries: ['TW', 'KR'], countryIndex: 1, nextPage: 2, pending: [], lastPassScanned: null };
        await env.DB.prepare("INSERT INTO kv (key, value) VALUES ('crawler:state', ?)").bind(JSON.stringify(state)).run();
        expect((await preview()).players.map(p => p.country_code)).toEqual(['TW', 'TW', 'TW']);
    });

    it('skips players without an excerpt and returns an empty list when there is no one', async () => {
        expect((await preview()).players).toEqual([]);
        await addPlayers([{ id: 1, shuffleKey: 1, snippets: [] }]);
        expect((await preview()).players).toEqual([]);
    });
});
