// src/auth.ts
//
// Login with osu! OAuth (authorization code flow):
//   1. /api/auth/login    sends the user to osu!'s authorization page
//   2. osu! redirects back to /api/auth/callback?code=...&state=...
//   3. the backend exchanges the code for tokens, calls /me to see who it is, and issues its own session cookie
//
// The friends.read scope is requested too, and tokens are stored encrypted in the database so friend lists can be
// read later.

import { Hono } from 'hono';
import type { AppEnv } from './env';
import { toBase64Url } from './encoding';
import { apiGet, requestToken, saveAccount, type OsuUserCompact } from './osu';
import { forgetTokens } from './account';
import { clearCookie, endSession, getSessionUser, readSealedCookie, setSealedCookie, startSession } from './session';

const STATE_COOKIE = 'osu_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

// identify: read /me to know who you are; friends.read: read your friend list (including the mutual field).
// There are no write scopes, so this site can't add or remove friends or send messages for you.
const SCOPES = 'identify friends.read';

// The redirect URI must exactly match the one registered in the osu! OAuth application.
// Without OSU_REDIRECT_URI the site's own origin is used (frontend and backend share one URL in production).
const redirectUri = (c: { env: AppEnv['Bindings']; req: { url: string } }) =>
    c.env.OSU_REDIRECT_URI || `${new URL(c.req.url).origin}/api/auth/callback`;

const auth = new Hono<AppEnv>();

// Where to go after logging in (?return=faq). Only values from this list are accepted: accepting any URL would let
// someone craft a login link that looks like MutualSeek but sends people to another site afterwards (an open redirect).
const RETURN_PATHS: Record<string, string> = { faq: '/faq' };

auth.get('/login', async c => {
    if (!c.env.OSU_CLIENT_ID) {
        return c.json({ error: 'Login is not configured on the server' }, 500);
    }
    // state is a random value against CSRF: stored in a cookie before going to osu! and compared on the way back,
    // so the authorization is known to have started here and not from a link someone else planted.
    const state = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    const returnTo = RETURN_PATHS[c.req.query('return') ?? ''] ?? '/';
    await setSealedCookie(c, STATE_COOKIE, 'state', { state, returnTo }, STATE_TTL_MS);

    const params = new URLSearchParams({
        client_id: c.env.OSU_CLIENT_ID,
        redirect_uri: redirectUri(c),
        response_type: 'code',
        scope: SCOPES,
        state,
    });
    return c.redirect(`https://osu.ppy.sh/oauth/authorize?${params}`);
});

auth.get('/callback', async c => {
    const { code, state, error } = c.req.query();
    const saved = await readSealedCookie(c, STATE_COOKIE, 'state');
    clearCookie(c, STATE_COOKIE);

    const frontend = c.env.FRONTEND_URL || '';
    // Checked again: the cookie is signed, but only paths from the list are honoured
    const returnTo = Object.values(RETURN_PATHS).includes(saved?.returnTo as string) ? (saved?.returnTo as string) : '/';
    const fail = (reason: string) => c.redirect(`${frontend}${returnTo}?login=${reason}`);

    if (error) return fail('denied'); // the user declined on the authorization page
    if (!code || !saved || saved.state !== state) return fail('invalid');

    try {
        const tokens = await requestToken(c.env, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri(c),
        });
        const me = await apiGet<OsuUserCompact>('/me', tokens.access_token);

        await saveAccount(c.env, me, tokens);
        await startSession(c, {
            osuUserId: me.id,
            username: me.username,
            avatarUrl: me.avatar_url ?? null,
            countryCode: me.country_code ?? null,
        });
        return c.redirect(`${frontend}${returnTo}`);
    } catch (err) {
        console.error('osu! login failed:', err);
        return fail('error');
    }
});

// Logout: besides clearing the cookie, the token is revoked on osu! and cleared from the database (the friend
// snapshot and history are kept). POST rather than GET: the cookie is SameSite=Lax, so other sites can't send a
// cross-site POST on the user's behalf to log them out.
auth.post('/logout', async c => {
    const user = await getSessionUser(c);
    if (user) await forgetTokens(c.env, user.osuUserId);
    endSession(c);
    return c.json({ ok: true });
});

export default auth;
