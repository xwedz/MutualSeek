// Who may see the candidate list: only logged-in users who accepted the guidelines (src/index.ts)
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { seal } from '../src/session';
import { addPlayers, api, DAY, logIn, resetDatabase, sessionCookie } from './helpers';

const ME = 1001;

beforeEach(async () => {
    await resetDatabase();
    await addPlayers([{ id: 1, shuffleKey: 1 }]);
});

describe('test setup', () => {
    it('uses the test secrets, not the ones in .dev.vars', () => {
        // Compared as a boolean so a failure never prints a real secret
        expect(env.SESSION_SECRET === 'test-session-secret').toBe(true);
    });
});

describe('GET /api/candidates', () => {
    it('refuses requests without a session', async () => {
        expect((await api('/api/candidates')).status).toBe(401);
    });

    it('refuses a tampered session cookie', async () => {
        await logIn(ME);
        const cookie = await sessionCookie(ME);
        const tampered = cookie.slice(0, -2) + (cookie.endsWith('AA') ? 'BB' : 'AA');
        expect((await api('/api/candidates', { cookie: tampered })).status).toBe(401);
    });

    it('refuses a cookie signed with a different secret', async () => {
        await logIn(ME);
        const forged = await seal('not-the-secret', 'session', { osuUserId: ME, username: 'someone' }, DAY);
        expect((await api('/api/candidates', { cookie: `mutual_session=${forged}` })).status).toBe(401);
    });

    it('refuses a valid session whose account no longer exists (e.g. after Delete my data)', async () => {
        expect((await api('/api/candidates', { cookie: await sessionCookie(ME) })).status).toBe(401);
    });

    it('refuses logged-in users until they accept the guidelines', async () => {
        const cookie = await logIn(ME, { acceptGuidelines: false });
        expect((await api('/api/candidates', { cookie })).status).toBe(403);

        expect((await api('/api/guidelines', { cookie, method: 'POST' })).status).toBe(200);
        expect((await api('/api/candidates', { cookie })).status).toBe(200);
    });
});

describe('POST /api/guidelines', () => {
    it('requires a session', async () => {
        expect((await api('/api/guidelines', { method: 'POST' })).status).toBe(401);
    });
});

describe('GET /api/me', () => {
    it('reports no user when logged out', async () => {
        expect(await (await api('/api/me')).json()).toEqual({ user: null });
    });

    it('reports whether the guidelines were accepted', async () => {
        const cookie = await logIn(ME, { acceptGuidelines: false });
        const before = (await (await api('/api/me', { cookie })).json()) as { user: { osuUserId: number }; account: { guidelinesAccepted: boolean }; optedOut: boolean };
        expect(before.user.osuUserId).toBe(ME);
        expect(before.account.guidelinesAccepted).toBe(false);
        expect(before.optedOut).toBe(false);

        await api('/api/guidelines', { cookie, method: 'POST' });
        const after = (await (await api('/api/me', { cookie })).json()) as { account: { guidelinesAccepted: boolean } };
        expect(after.account.guidelinesAccepted).toBe(true);
    });
});
