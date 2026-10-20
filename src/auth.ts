// src/auth.ts
//
// 用 osu! 的 OAuth（Authorization Code 流程）登入，流程和 Higher or Lower 相同：
//   1. /api/auth/login    把使用者導去 osu! 的授權頁
//   2. osu! 導回 /api/auth/callback?code=...&state=...
//   3. 後端拿 code 換 token、呼叫 /me 取得身分，然後簽發自己的 session cookie
//
// 差別：這裡多要了 friends.read 權限，而且 token 會加密存進資料庫，之後才能定期讀好友名單。

import { Hono } from 'hono';
import type { AppEnv } from './env';
import { toBase64Url } from './encoding';
import { apiGet, requestToken, saveAccount, type OsuUserCompact } from './osu';
import { clearCookie, endSession, readSealedCookie, setSealedCookie, startSession } from './session';

const STATE_COOKIE = 'osu_oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

// identify：讀 /me 知道你是誰；friends.read：讀你的好友名單（含 mutual 欄位）。
// 沒有任何「寫入」權限，所以這個工具不可能替你加好友、刪好友或發訊息。
const SCOPES = 'identify friends.read';

// Redirect URI 必須跟 osu! OAuth 應用程式設定裡登記的完全一致。
// 沒有設定 OSU_REDIRECT_URI 時，就用網站自己的網址（部署後前後端同一個網址）。
const redirectUri = (c: { env: AppEnv['Bindings']; req: { url: string } }) =>
    c.env.OSU_REDIRECT_URI || `${new URL(c.req.url).origin}/api/auth/callback`;

const auth = new Hono<AppEnv>();

auth.get('/login', async c => {
    if (!c.env.OSU_CLIENT_ID) {
        return c.json({ error: 'Login is not configured on the server' }, 500);
    }
    // state 是防 CSRF 的隨機值：導去 osu! 前先存在 cookie，導回來時比對，
    // 確保這次授權是我們自己發起的，而不是別人塞給使用者的連結。
    const state = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
    await setSealedCookie(c, STATE_COOKIE, 'state', { state }, STATE_TTL_MS);

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
    const fail = (reason: string) => c.redirect(`${frontend}/?login=${reason}`);

    if (error) return fail('denied'); // 使用者在授權頁按了拒絕
    if (!code || !saved || saved.state !== state) return fail('invalid');

    try {
        const tokens = await requestToken(c.env, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri(c),
        });
        const me = await apiGet<OsuUserCompact>('/me', tokens.access_token);

        await saveAccount(c.env, me, tokens);
        await startSession(c, { osuUserId: me.id, username: me.username, avatarUrl: me.avatar_url ?? null });
        return c.redirect(`${frontend}/`);
    } catch (err) {
        console.error('osu! 登入失敗:', err);
        return fail('error');
    }
});

auth.post('/logout', c => {
    endSession(c);
    return c.json({ ok: true });
});

export default auth;
