// "Don't list me": removing yourself from the list and undoing it (POST /api/listing in src/index.ts)
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { addPlayers, api, logIn, pageThrough, resetDatabase } from './helpers';

const ME = 1001;
const VIEWER = 2001;

const isOptedOut = async (cookie: string) => ((await (await api('/api/me', { cookie })).json()) as { optedOut: boolean }).optedOut;
const optOutRow = () => env.DB.prepare('SELECT id FROM opt_outs WHERE id = ?').bind(ME).first();

beforeEach(async () => {
    await resetDatabase();
});

describe('POST /api/listing', () => {
    it('requires a session', async () => {
        expect((await api('/api/listing', { method: 'POST', body: { listed: false } })).status).toBe(401);
    });

    it('rejects a request without a true/false "listed"', async () => {
        const cookie = await logIn(ME);
        for (const body of [{}, { listed: 'false' }, { listed: 0 }]) {
            expect((await api('/api/listing', { cookie, method: 'POST', body })).status).toBe(400);
        }
    });

    it('removes you from the list right away and remembers the choice', async () => {
        await addPlayers([{ id: ME, shuffleKey: 1 }, { id: 2, shuffleKey: 2 }]);
        const cookie = await logIn(ME);
        const viewer = await logIn(VIEWER);
        expect((await pageThrough('', viewer)).ids).toContain(ME);

        const res = await api('/api/listing', { cookie, method: 'POST', body: { listed: false } });
        expect(await res.json()).toEqual({ optedOut: true });
        expect(await isOptedOut(cookie)).toBe(true);
        expect(await optOutRow()).not.toBeNull();
        expect((await pageThrough('', viewer)).ids).toEqual([2]);
    });

    it('can be done twice without an error', async () => {
        const cookie = await logIn(ME);
        for (let i = 0; i < 2; i++) expect((await api('/api/listing', { cookie, method: 'POST', body: { listed: false } })).status).toBe(200);
    });

    it('undoing it clears the choice (you return once the next scan finds you)', async () => {
        await addPlayers([{ id: ME, shuffleKey: 1 }]);
        const cookie = await logIn(ME);
        await api('/api/listing', { cookie, method: 'POST', body: { listed: false } });

        const res = await api('/api/listing', { cookie, method: 'POST', body: { listed: true } });
        expect(await res.json()).toEqual({ optedOut: false });
        expect(await isOptedOut(cookie)).toBe(false);
        expect(await optOutRow()).toBeNull();
        // The profile data was deleted, so the player only comes back after the scanner reaches them again
        expect(await env.DB.prepare('SELECT id FROM players WHERE id = ?').bind(ME).first()).toBeNull();
    });
});
