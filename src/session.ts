// src/session.ts
//
// The login state lives in a signed cookie: the content is plain text, and an HMAC signature prevents tampering.
// It uses Web Crypto (crypto.subtle), so Node compatibility mode isn't needed.
//
// The cookie only holds public information (osu! id, name, avatar); osu! tokens are stored encrypted in the database.

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
    countryCode: string | null; // the country menu defaults to this; null for older sessions without the field
}

function hmacKey(secret: string): Promise<CryptoKey> {
    if (!secret) throw new Error('SESSION_SECRET is missing');
    return crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// The purpose is part of the signature, so a value signed for one use (session, OAuth state) can't be reused for another.
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
        // crypto.subtle.verify compares in constant time, so how far a guess matches doesn't leak through timing.
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
    // Lax: the browser sends the cookie when osu! redirects back (a top-level GET navigation),
    // but not on cross-site POSTs started by other sites, which also blocks CSRF.
    sameSite: 'Lax' as const,
    // Secure only over https (local development uses http).
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000), // Hono uses seconds
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

/** The logged-in user, or null if not logged in (or the cookie is invalid or expired). */
export async function getSessionUser(c: Ctx): Promise<SessionUser | null> {
    const payload = await readSealedCookie(c, SESSION_COOKIE, 'session');
    if (!payload || !Number.isInteger(payload.osuUserId) || typeof payload.username !== 'string') return null;
    return {
        osuUserId: payload.osuUserId as number,
        username: payload.username,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null,
        countryCode: typeof payload.countryCode === 'string' ? payload.countryCode : null,
    };
}
