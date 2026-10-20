// src/session.ts
//
// 登入狀態存在「簽章 cookie」裡，做法和 Higher or Lower 相同：內容是明文，靠 HMAC 簽章防竄改。
// 差別是這裡改用 Web Crypto（crypto.subtle），不需要開啟 Node 相容模式。
//
// cookie 只放公開資訊（osu! id、名字、頭像），osu! 的 token 加密存在資料庫，不放在 cookie。

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from './env';
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from './encoding';

const SESSION_COOKIE = 'mutual_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Ctx = Context<AppEnv>;

export interface SessionUser {
    osuUserId: number;
    username: string;
    avatarUrl: string | null;
}

function hmacKey(secret: string): Promise<CryptoKey> {
    if (!secret) throw new Error('缺少 SESSION_SECRET');
    return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// purpose 一起放進簽章：不同用途（登入狀態、OAuth state）的值不能互相冒用。
export async function seal(secret: string, purpose: string, payload: object, ttlMs: number): Promise<string> {
    const body = toBase64Url(utf8(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })));
    const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), utf8(`${purpose}.${body}`));
    return `${body}.${toBase64Url(signature)}`;
}

export async function unseal(secret: string, purpose: string, value: string | undefined): Promise<Record<string, unknown> | null> {
    if (typeof value !== 'string') return null;
    const [body, signature, extra] = value.split('.');
    if (!body || !signature || extra !== undefined) return null;

    try {
        // crypto.subtle.verify 內部是固定時間比較，不會因為比對到第幾個字元才失敗而洩漏資訊。
        const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64Url(signature), utf8(`${purpose}.${body}`));
        if (!valid) return null;

        const payload = JSON.parse(fromUtf8(fromBase64Url(body)));
        if (typeof payload?.exp !== 'number' || payload.exp < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

const cookieOptions = (c: Ctx, ttlMs: number) => ({
    httpOnly: true,
    // Lax：從 osu! 授權頁導回來（頂層 GET 導覽）時瀏覽器會帶上 cookie，
    // 但其他網站發起的跨站 POST 不會帶，等於順便擋掉 CSRF。
    sameSite: 'Lax' as const,
    // 只有走 https 時才加 Secure（本機開發是 http）。
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000), // Hono 的單位是秒
});

export async function setSealedCookie(c: Ctx, name: string, purpose: string, payload: object, ttlMs: number) {
    setCookie(c, name, await seal(c.env.SESSION_SECRET, purpose, payload, ttlMs), cookieOptions(c, ttlMs));
}

export function readSealedCookie(c: Ctx, name: string, purpose: string) {
    return unseal(c.env.SESSION_SECRET, purpose, getCookie(c, name));
}

export function clearCookie(c: Ctx, name: string) {
    deleteCookie(c, name, { path: '/' });
}

export function startSession(c: Ctx, user: SessionUser) {
    return setSealedCookie(c, SESSION_COOKIE, 'session', user, SESSION_TTL_MS);
}

export function endSession(c: Ctx) {
    clearCookie(c, SESSION_COOKIE);
}

/** 目前登入的使用者，沒登入（或 cookie 無效、過期）就是 null。 */
export async function getSessionUser(c: Ctx): Promise<SessionUser | null> {
    const payload = await readSealedCookie(c, SESSION_COOKIE, 'session');
    if (!payload || !Number.isInteger(payload.osuUserId) || typeof payload.username !== 'string') return null;
    return {
        osuUserId: payload.osuUserId as number,
        username: payload.username,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null,
    };
}
